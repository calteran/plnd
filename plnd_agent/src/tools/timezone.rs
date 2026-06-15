use std::sync::Arc;

use chrono::{NaiveDate, NaiveTime};
use chrono_tz::Tz;
use plnd_data::{models::TimezoneSource, repository::TimezoneAnchorRepository};
use uuid::Uuid;

use crate::tools::{Tool, ToolContext, ToolError, ToolRegistry};

// ── Helper: map plnd_data::Error → ToolError ─────────────────────────────────

fn db_err(tool: &str, e: plnd_data::Error) -> ToolError {
    ToolError::Execution {
        tool: tool.to_string(),
        reason: e.to_string(),
    }
}

// ── InferTimezoneChangeTool ───────────────────────────────────────────────────

pub struct InferTimezoneChangeTool(pub Arc<dyn TimezoneAnchorRepository>);

#[async_trait::async_trait]
impl Tool for InferTimezoneChangeTool {
    fn name(&self) -> &str {
        "infer_timezone_change"
    }

    fn description(&self) -> &str {
        "Record an upcoming timezone change implied by a travel task. \
         ONLY call this when the task EXPLICITLY indicates travel that changes \
         the user's timezone — a flight, a hotel/lodging booking, or a clearly \
         stated destination with a date. Do NOT call it for a passing mention of \
         a city, a phone/video call to another zone, shipping, or vague/aspirational \
         travel. For a known round trip, provide the return_* fields so both the \
         departure and return are recorded together. When in doubt, do not call \
         this tool — the user's device remains the source of truth and corrects \
         any guess."
    }

    fn schema(&self) -> serde_json::Value {
        infer_timezone_change_schema()
    }

    async fn execute(
        &self,
        ctx: &ToolContext,
        input: serde_json::Value,
    ) -> Result<serde_json::Value, ToolError> {
        let name = self.name();

        // ── Required: destination_zone ────────────────────────────────────────
        let dest_zone_str = input
            .get("destination_zone")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::InvalidInput {
                tool: name.to_string(),
                reason: "missing required field 'destination_zone'".to_string(),
            })?;

        let dest_zone = dest_zone_str
            .parse::<Tz>()
            .map_err(|_| ToolError::InvalidInput {
                tool: name.to_string(),
                reason: format!("'destination_zone' is not a valid IANA timezone: {dest_zone_str}"),
            })?;

        // ── Required: effective_date ──────────────────────────────────────────
        let effective_date_str = input
            .get("effective_date")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::InvalidInput {
                tool: name.to_string(),
                reason: "missing required field 'effective_date'".to_string(),
            })?;

        let effective_date = effective_date_str
            .parse::<NaiveDate>()
            .map_err(|_| ToolError::InvalidInput {
                tool: name.to_string(),
                reason: format!(
                    "'effective_date' is not a valid ISO 8601 date (YYYY-MM-DD): {effective_date_str}"
                ),
            })?;

        // ── Optional: effective_time ──────────────────────────────────────────
        let effective_time: Option<NaiveTime> =
            match input.get("effective_time").and_then(|v| v.as_str()) {
                Some(s) => Some(
                    NaiveTime::parse_from_str(s, "%H:%M")
                        .or_else(|_| NaiveTime::parse_from_str(s, "%H:%M:%S"))
                        .map_err(|_| ToolError::InvalidInput {
                            tool: name.to_string(),
                            reason: format!("'effective_time' is not a valid HH:MM time: {s}"),
                        })?,
                ),
                None => None,
            };

        // ── Optional: source_task_id ──────────────────────────────────────────
        let source_ref: Option<Uuid> = match input.get("source_task_id").and_then(|v| v.as_str()) {
            Some(s) => Some(s.parse::<Uuid>().map_err(|_| ToolError::InvalidInput {
                tool: name.to_string(),
                reason: format!("'source_task_id' is not a valid UUID: {s}"),
            })?),
            None => None,
        };

        // ── Optional round-trip fields ────────────────────────────────────────
        let return_zone_str = input.get("return_zone").and_then(|v| v.as_str());

        let (return_zone, return_date, return_time) = if let Some(rzs) = return_zone_str {
            let rz = rzs.parse::<Tz>().map_err(|_| ToolError::InvalidInput {
                tool: name.to_string(),
                reason: format!("'return_zone' is not a valid IANA timezone: {rzs}"),
            })?;

            // return_date is required when return_zone is present
            let return_date_str = input
                .get("return_date")
                .and_then(|v| v.as_str())
                .ok_or_else(|| ToolError::InvalidInput {
                    tool: name.to_string(),
                    reason: "'return_date' is required when 'return_zone' is provided".to_string(),
                })?;

            let rd = return_date_str
                .parse::<NaiveDate>()
                .map_err(|_| ToolError::InvalidInput {
                    tool: name.to_string(),
                    reason: format!(
                        "'return_date' is not a valid ISO 8601 date (YYYY-MM-DD): {return_date_str}"
                    ),
                })?;

            let rt: Option<NaiveTime> = match input.get("return_time").and_then(|v| v.as_str()) {
                Some(s) => Some(
                    NaiveTime::parse_from_str(s, "%H:%M")
                        .or_else(|_| NaiveTime::parse_from_str(s, "%H:%M:%S"))
                        .map_err(|_| ToolError::InvalidInput {
                            tool: name.to_string(),
                            reason: format!("'return_time' is not a valid HH:MM time: {s}"),
                        })?,
                ),
                None => None,
            };

            (Some(rz), Some(rd), rt)
        } else {
            (None, None, None)
        };

        // ── One inference_group for the entire batch ──────────────────────────
        let group = Uuid::new_v4();

        // ── Write departure anchor ────────────────────────────────────────────
        self.0
            .add(
                ctx.user_id,
                effective_date,
                effective_time,
                dest_zone,
                TimezoneSource::Inferred,
                source_ref,
                Some(group),
            )
            .await
            .map_err(|e| db_err(name, e))?;

        let mut created: u32 = 1;

        // ── Write return anchor (round trip) ──────────────────────────────────
        if let (Some(rz), Some(rd)) = (return_zone, return_date) {
            self.0
                .add(
                    ctx.user_id,
                    rd,
                    return_time,
                    rz,
                    TimezoneSource::Inferred,
                    source_ref,
                    Some(group),
                )
                .await
                .map_err(|e| db_err(name, e))?;
            created = 2;
        }

        Ok(serde_json::json!({
            "inference_group": group.to_string(),
            "anchors_created": created
        }))
    }
}

// ── Registration ──────────────────────────────────────────────────────────────

/// Register timezone inference tools into `registry`.
pub fn register_timezone_inference_tools(
    registry: &mut ToolRegistry,
    anchor_repo: Arc<dyn TimezoneAnchorRepository>,
) {
    registry.register(Arc::new(InferTimezoneChangeTool(anchor_repo)));
}

// ── Schema constructor ────────────────────────────────────────────────────────

fn infer_timezone_change_schema() -> serde_json::Value {
    serde_json::json!({
        "type": "object",
        "required": ["destination_zone", "effective_date"],
        "properties": {
            "destination_zone": {
                "type": "string",
                "description": "IANA zone at the destination, e.g. \"America/Denver\"."
            },
            "effective_date": {
                "type": "string",
                "format": "date",
                "description": "Date the destination timezone takes effect (arrival), YYYY-MM-DD."
            },
            "effective_time": {
                "type": "string",
                "description": "Optional local wall-clock time of the switch, HH:MM."
            },
            "return_zone": {
                "type": "string",
                "description": "For a round trip, the IANA zone on return (often the origin)."
            },
            "return_date": {
                "type": "string",
                "format": "date",
                "description": "Required if return_zone is given: the return date, YYYY-MM-DD."
            },
            "return_time": {
                "type": "string",
                "description": "Optional return switch time, HH:MM."
            },
            "source_task_id": {
                "type": "string",
                "format": "uuid",
                "description": "ID of the task this travel was inferred from, if known."
            }
        }
    })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use chrono::{NaiveDate, NaiveTime};
    use chrono_tz::Tz;
    use plnd_data::{
        models::{TimezoneAnchor, TimezoneSource},
        repository::TimezoneAnchorRepository,
    };
    use uuid::Uuid;

    use super::*;
    use crate::tools::ToolContext;

    // ── Captured add() call ───────────────────────────────────────────────────

    #[derive(Debug, Clone)]
    #[allow(dead_code)] // fields are stored for completeness; tests assert on subset
    struct CapturedAdd {
        user_id: Uuid,
        effective_date: NaiveDate,
        effective_time: Option<NaiveTime>,
        zone: Tz,
        source: TimezoneSource,
        source_ref: Option<Uuid>,
        inference_group: Option<Uuid>,
    }

    // ── Stub repository ───────────────────────────────────────────────────────

    struct StubTimezoneAnchorRepo {
        calls: Mutex<Vec<CapturedAdd>>,
    }

    impl StubTimezoneAnchorRepo {
        fn new() -> Self {
            Self {
                calls: Mutex::new(vec![]),
            }
        }

        fn captured(&self) -> Vec<CapturedAdd> {
            self.calls.lock().unwrap().clone()
        }
    }

    #[async_trait::async_trait]
    impl TimezoneAnchorRepository for StubTimezoneAnchorRepo {
        async fn list_through(
            &self,
            _user_id: Uuid,
            _through: NaiveDate,
        ) -> Result<Vec<TimezoneAnchor>, plnd_data::Error> {
            unimplemented!("stub")
        }

        async fn add(
            &self,
            user_id: Uuid,
            effective_date: NaiveDate,
            effective_time: Option<NaiveTime>,
            zone: Tz,
            source: TimezoneSource,
            source_ref: Option<Uuid>,
            inference_group: Option<Uuid>,
        ) -> Result<TimezoneAnchor, plnd_data::Error> {
            self.calls.lock().unwrap().push(CapturedAdd {
                user_id,
                effective_date,
                effective_time,
                zone,
                source,
                source_ref,
                inference_group,
            });
            // Return a minimal anchor — only the fields callers inspect matter.
            Ok(TimezoneAnchor {
                id: Uuid::new_v4(),
                user_id,
                effective_date,
                effective_time,
                zone,
                source,
                source_ref,
                inference_group,
                created_at: chrono::Utc::now(),
                updated_at: chrono::Utc::now(),
            })
        }

        async fn delete(&self, _id: Uuid, _user_id: Uuid) -> Result<bool, plnd_data::Error> {
            unimplemented!("stub")
        }

        async fn delete_group(
            &self,
            _user_id: Uuid,
            _inference_group: Uuid,
        ) -> Result<u64, plnd_data::Error> {
            unimplemented!("stub")
        }
    }

    fn tool_with_stub() -> (InferTimezoneChangeTool, Arc<StubTimezoneAnchorRepo>) {
        let stub = Arc::new(StubTimezoneAnchorRepo::new());
        let tool = InferTimezoneChangeTool(Arc::clone(&stub) as Arc<dyn TimezoneAnchorRepository>);
        (tool, stub)
    }

    fn ctx() -> ToolContext {
        ToolContext {
            user_id: Uuid::new_v4(),
        }
    }

    // ── Schema tests ──────────────────────────────────────────────────────────

    #[test]
    fn schema_has_no_user_id() {
        let schema = infer_timezone_change_schema();
        assert!(
            schema
                .get("properties")
                .and_then(|p| p.get("user_id"))
                .is_none(),
            "schema must not expose user_id property"
        );
        let required = schema
            .get("required")
            .and_then(|r| r.as_array())
            .map(|arr| arr.iter().any(|v| v.as_str() == Some("user_id")))
            .unwrap_or(false);
        assert!(!required, "schema must not require user_id");
    }

    #[test]
    fn schema_requires_destination_and_date() {
        let schema = infer_timezone_change_schema();
        let required: Vec<&str> = schema
            .get("required")
            .and_then(|r| r.as_array())
            .unwrap()
            .iter()
            .filter_map(|v| v.as_str())
            .collect();
        assert!(required.contains(&"destination_zone"));
        assert!(required.contains(&"effective_date"));
    }

    // ── Behaviour tests ───────────────────────────────────────────────────────

    #[tokio::test]
    async fn oneway_creates_single_anchor_with_group() {
        let (tool, stub) = tool_with_stub();
        let input = serde_json::json!({
            "destination_zone": "America/Denver",
            "effective_date": "2026-07-01"
        });
        let result = tool.execute(&ctx(), input).await.unwrap();

        let calls = stub.captured();
        assert_eq!(calls.len(), 1, "expected exactly 1 add call");
        assert_eq!(calls[0].source, TimezoneSource::Inferred);
        assert!(calls[0].inference_group.is_some());

        // Result carries the same group UUID.
        let group_str = result["inference_group"].as_str().unwrap();
        let group = group_str.parse::<Uuid>().unwrap();
        assert_eq!(calls[0].inference_group, Some(group));
        assert_eq!(result["anchors_created"].as_u64(), Some(1));
    }

    #[tokio::test]
    async fn roundtrip_creates_pair_sharing_group() {
        let (tool, stub) = tool_with_stub();
        let task_id = Uuid::new_v4();
        let input = serde_json::json!({
            "destination_zone": "America/Los_Angeles",
            "effective_date": "2026-08-10",
            "return_zone": "America/New_York",
            "return_date": "2026-08-17",
            "source_task_id": task_id.to_string()
        });
        let result = tool.execute(&ctx(), input).await.unwrap();

        let calls = stub.captured();
        assert_eq!(calls.len(), 2, "expected 2 add calls for a round trip");

        // Both share the same inference_group.
        assert_eq!(calls[0].inference_group, calls[1].inference_group);
        assert!(calls[0].inference_group.is_some());

        // Both carry the same source_ref.
        assert_eq!(calls[0].source_ref, Some(task_id));
        assert_eq!(calls[1].source_ref, Some(task_id));

        assert_eq!(result["anchors_created"].as_u64(), Some(2));
    }

    #[tokio::test]
    async fn invalid_destination_zone_is_rejected() {
        let (tool, stub) = tool_with_stub();
        let input = serde_json::json!({
            "destination_zone": "Not/AZone",
            "effective_date": "2026-07-01"
        });
        let err = tool.execute(&ctx(), input).await.unwrap_err();
        assert!(
            matches!(err, ToolError::InvalidInput { .. }),
            "expected InvalidInput, got {err:?}"
        );
        assert_eq!(stub.captured().len(), 0, "no add calls should be made");
    }

    #[tokio::test]
    async fn return_zone_without_return_date_is_rejected() {
        let (tool, stub) = tool_with_stub();
        let input = serde_json::json!({
            "destination_zone": "America/Denver",
            "effective_date": "2026-07-01",
            "return_zone": "America/New_York"
            // return_date intentionally omitted
        });
        let err = tool.execute(&ctx(), input).await.unwrap_err();
        assert!(
            matches!(err, ToolError::InvalidInput { .. }),
            "expected InvalidInput, got {err:?}"
        );
        assert_eq!(stub.captured().len(), 0, "no add calls should be made");
    }

    #[test]
    fn tool_is_non_terminal() {
        let stub = Arc::new(StubTimezoneAnchorRepo::new());
        let tool = InferTimezoneChangeTool(Arc::clone(&stub) as Arc<dyn TimezoneAnchorRepository>);
        assert!(
            !tool.is_terminal(),
            "infer_timezone_change must not be terminal"
        );
    }
}
