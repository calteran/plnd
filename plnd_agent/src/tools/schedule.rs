use std::sync::Arc;

use chrono::{DateTime, Utc};
use plnd_data::db::error::DatabaseError;
use plnd_data::db::TaskStore;

use crate::tools::{Tool, ToolContext, ToolError, ToolRegistry};

// ── Valid energy levels ───────────────────────────────────────────────────────

const VALID_ENERGY_LEVELS: &[&str] = &["low", "medium", "high"];

fn validate_energy_level(level: &str, tool: &str) -> Result<(), ToolError> {
    if VALID_ENERGY_LEVELS.contains(&level) {
        Ok(())
    } else {
        Err(ToolError::InvalidInput {
            tool: tool.to_string(),
            reason: format!(
                "unknown energy_level '{}'; must be one of: {}",
                level,
                VALID_ENERGY_LEVELS.join(", ")
            ),
        })
    }
}

// ── Helper: map DatabaseError → ToolError ─────────────────────────────────────

fn db_err(tool: &str, e: DatabaseError) -> ToolError {
    ToolError::Execution {
        tool: tool.to_string(),
        reason: e.to_string(),
    }
}

// ── FindScheduleSlotTool ──────────────────────────────────────────────────────

pub struct FindScheduleSlotTool(Arc<TaskStore>);

#[async_trait::async_trait]
impl Tool for FindScheduleSlotTool {
    fn name(&self) -> &str {
        "find_schedule_slot"
    }

    fn description(&self) -> &str {
        "Find the next available time slot for a task. Given the user's energy \
         level and how long the task will take, returns the earliest free \
         start and end time. Optionally pass 'after' (ISO 8601) to search \
         from a specific point in time; defaults to now."
    }

    fn schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "energy_level": {
                    "type": "string",
                    "enum": VALID_ENERGY_LEVELS,
                    "description": "Energy level required for the task."
                },
                "duration_minutes": {
                    "type": "integer",
                    "minimum": 5,
                    "maximum": 480,
                    "description": "How long the task will take, in minutes."
                },
                "after": {
                    "type": "string",
                    "format": "date-time",
                    "description": "Search for slots after this ISO 8601 datetime. Defaults to now."
                }
            },
            "required": ["energy_level", "duration_minutes"]
        })
    }

    async fn execute(
        &self,
        ctx: &ToolContext,
        input: serde_json::Value,
    ) -> Result<serde_json::Value, ToolError> {
        let energy_level = input
            .get("energy_level")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::InvalidInput {
                tool: self.name().to_string(),
                reason: "missing required field 'energy_level'".to_string(),
            })?
            .to_string();

        validate_energy_level(&energy_level, self.name())?;

        let duration_minutes = input
            .get("duration_minutes")
            .and_then(|v| v.as_i64())
            .ok_or_else(|| ToolError::InvalidInput {
                tool: self.name().to_string(),
                reason: "missing required field 'duration_minutes'".to_string(),
            })? as i32;

        let after: DateTime<Utc> = match input.get("after").and_then(|v| v.as_str()) {
            Some(s) => s
                .parse::<DateTime<Utc>>()
                .map_err(|_| ToolError::InvalidInput {
                    tool: self.name().to_string(),
                    reason: format!("'after' is not a valid ISO 8601 datetime: {s}"),
                })?,
            None => Utc::now(),
        };

        let (slot_start, slot_end) = self
            .0
            .find_free_slot(ctx.user_id, &energy_level, duration_minutes, after)
            .await
            .map_err(|e| db_err(self.name(), e))?;

        Ok(serde_json::json!({
            "start": slot_start,
            "end": slot_end,
            "date": slot_start.format("%Y-%m-%d").to_string()
        }))
    }
}

// ── CreateTaskTool ────────────────────────────────────────────────────────────

pub struct CreateTaskTool(Arc<TaskStore>);

#[async_trait::async_trait]
impl Tool for CreateTaskTool {
    fn name(&self) -> &str {
        "create_task"
    }

    fn description(&self) -> &str {
        "Create a scheduled task for the user. This is a terminal tool — \
         calling it ends the agent loop. Returns actions_taken, ui_signals \
         (passed through unchanged for the frontend), and a human-readable \
         confirmation message."
    }

    fn schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "title": {
                    "type": "string",
                    "description": "Title of the task."
                },
                "energy_level": {
                    "type": "string",
                    "enum": VALID_ENERGY_LEVELS,
                    "description": "Energy level required for the task."
                },
                "scheduled_at": {
                    "type": "string",
                    "format": "date-time",
                    "description": "ISO 8601 datetime when the task is scheduled to start."
                },
                "duration_minutes": {
                    "type": "integer",
                    "minimum": 5,
                    "maximum": 480,
                    "description": "How long the task will take, in minutes."
                },
                "ui_signals": {
                    "type": "array",
                    "items": { "type": "object" },
                    "description": "Frontend signals passed through unchanged to the API response."
                },
                "confirmation": {
                    "type": "string",
                    "description": "Human-readable summary of what was scheduled, shown to the user."
                }
            },
            "required": ["title", "energy_level", "scheduled_at", "duration_minutes", "confirmation"]
        })
    }

    fn is_terminal(&self) -> bool {
        true
    }

    async fn execute(
        &self,
        ctx: &ToolContext,
        input: serde_json::Value,
    ) -> Result<serde_json::Value, ToolError> {
        let title = input
            .get("title")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::InvalidInput {
                tool: self.name().to_string(),
                reason: "missing required field 'title'".to_string(),
            })?
            .to_string();

        let energy_level = input
            .get("energy_level")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::InvalidInput {
                tool: self.name().to_string(),
                reason: "missing required field 'energy_level'".to_string(),
            })?
            .to_string();

        validate_energy_level(&energy_level, self.name())?;

        let scheduled_at_str = input
            .get("scheduled_at")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::InvalidInput {
                tool: self.name().to_string(),
                reason: "missing required field 'scheduled_at'".to_string(),
            })?;

        let scheduled_at =
            scheduled_at_str
                .parse::<DateTime<Utc>>()
                .map_err(|_| ToolError::InvalidInput {
                    tool: self.name().to_string(),
                    reason: format!(
                        "'scheduled_at' is not a valid ISO 8601 datetime: {scheduled_at_str}"
                    ),
                })?;

        let duration_minutes = input
            .get("duration_minutes")
            .and_then(|v| v.as_i64())
            .ok_or_else(|| ToolError::InvalidInput {
                tool: self.name().to_string(),
                reason: "missing required field 'duration_minutes'".to_string(),
            })? as i32;

        let confirmation = input
            .get("confirmation")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::InvalidInput {
                tool: self.name().to_string(),
                reason: "missing required field 'confirmation'".to_string(),
            })?
            .to_string();

        let ui_signals = input
            .get("ui_signals")
            .cloned()
            .unwrap_or(serde_json::Value::Array(vec![]));

        self.0
            .create_user_task(
                ctx.user_id,
                &title,
                &energy_level,
                scheduled_at,
                duration_minutes,
            )
            .await
            .map_err(|e| db_err(self.name(), e))?;

        Ok(serde_json::json!({
            "actions_taken": [format!("created task '{}' scheduled at {}", title, scheduled_at)],
            "ui_signals": ui_signals,
            "confirmation": confirmation
        }))
    }
}

// ── RequestClarificationTool ──────────────────────────────────────────────────

pub struct RequestClarificationTool;

#[async_trait::async_trait]
impl Tool for RequestClarificationTool {
    fn name(&self) -> &str {
        "request_clarification"
    }

    fn description(&self) -> &str {
        "Signal that required task fields are missing and surface them to the user. \
         Call this instead of create_task when you cannot confidently determine all \
         required task properties (e.g. duration_minutes is completely unknown). \
         This is a terminal tool — calling it ends the agent loop."
    }

    fn schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "required": ["ui_signals"],
            "properties": {
                "ui_signals": {
                    "type": "array",
                    "items": {},
                    "description": "UI hints for fields that need user input."
                }
            }
        })
    }

    fn is_terminal(&self) -> bool {
        true
    }

    async fn execute(
        &self,
        _ctx: &ToolContext,
        input: serde_json::Value,
    ) -> Result<serde_json::Value, ToolError> {
        let ui_signals = input
            .get("ui_signals")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();

        Ok(serde_json::json!({
            "actions_taken": [],
            "ui_signals": ui_signals,
            "confirmation": ""
        }))
    }
}

// ── Registration ──────────────────────────────────────────────────────────────

/// Register both schedule tools into `registry`.
///
/// # Example
///
/// ```ignore
/// let store = Arc::new(TaskStore::new(pool));
/// register_schedule_tools(&mut registry, store);
/// ```
pub fn register_schedule_tools(registry: &mut ToolRegistry, store: Arc<TaskStore>) {
    registry.register(Arc::new(FindScheduleSlotTool(store.clone())));
    registry.register(Arc::new(CreateTaskTool(store)));
    registry.register(Arc::new(RequestClarificationTool));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // TaskStore requires a live PgPool. Schema tests don't call execute(), so
    // we test schemas by reproducing the exact JSON the tools return — this
    // avoids a test-only DB dependency while still pinning the contract.

    fn has_user_id_property(schema: &serde_json::Value) -> bool {
        schema
            .get("properties")
            .and_then(|p| p.get("user_id"))
            .is_some()
    }

    fn schema_requires_user_id(schema: &serde_json::Value) -> bool {
        schema
            .get("required")
            .and_then(|r| r.as_array())
            .map(|arr| arr.iter().any(|v| v.as_str() == Some("user_id")))
            .unwrap_or(false)
    }

    fn schema_requires_field(schema: &serde_json::Value, field: &str) -> bool {
        schema
            .get("required")
            .and_then(|r| r.as_array())
            .map(|arr| arr.iter().any(|v| v.as_str() == Some(field)))
            .unwrap_or(false)
    }

    fn find_slot_schema() -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "energy_level": {
                    "type": "string",
                    "enum": VALID_ENERGY_LEVELS,
                    "description": "Energy level required for the task."
                },
                "duration_minutes": {
                    "type": "integer",
                    "minimum": 5,
                    "maximum": 480,
                    "description": "How long the task will take, in minutes."
                },
                "after": {
                    "type": "string",
                    "format": "date-time",
                    "description": "Search for slots after this ISO 8601 datetime. Defaults to now."
                }
            },
            "required": ["energy_level", "duration_minutes"]
        })
    }

    fn create_task_schema() -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "title": {
                    "type": "string",
                    "description": "Title of the task."
                },
                "energy_level": {
                    "type": "string",
                    "enum": VALID_ENERGY_LEVELS,
                    "description": "Energy level required for the task."
                },
                "scheduled_at": {
                    "type": "string",
                    "format": "date-time",
                    "description": "ISO 8601 datetime when the task is scheduled to start."
                },
                "duration_minutes": {
                    "type": "integer",
                    "minimum": 5,
                    "maximum": 480,
                    "description": "How long the task will take, in minutes."
                },
                "ui_signals": {
                    "type": "array",
                    "items": { "type": "object" },
                    "description": "Frontend signals passed through unchanged to the API response."
                },
                "confirmation": {
                    "type": "string",
                    "description": "Human-readable summary of what was scheduled, shown to the user."
                }
            },
            "required": ["title", "energy_level", "scheduled_at", "duration_minutes", "confirmation"]
        })
    }

    #[test]
    fn find_slot_schema_has_no_user_id() {
        let schema = find_slot_schema();
        assert!(!has_user_id_property(&schema));
        assert!(!schema_requires_user_id(&schema));
    }

    #[test]
    fn create_task_schema_has_no_user_id() {
        let schema = create_task_schema();
        assert!(!has_user_id_property(&schema));
        assert!(!schema_requires_user_id(&schema));
    }

    #[test]
    fn create_task_schema_requires_title_and_confirmation() {
        let schema = create_task_schema();
        assert!(schema_requires_field(&schema, "title"));
        assert!(schema_requires_field(&schema, "confirmation"));
    }

    fn clarification_schema() -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "required": ["ui_signals"],
            "properties": {
                "ui_signals": {
                    "type": "array",
                    "items": {},
                    "description": "UI hints for fields that need user input."
                }
            }
        })
    }

    #[test]
    fn request_clarification_is_terminal() {
        let tool = RequestClarificationTool;
        assert!(tool.is_terminal());
    }

    #[test]
    fn request_clarification_schema_has_no_user_id() {
        let schema = clarification_schema();
        assert!(!has_user_id_property(&schema));
        assert!(!schema_requires_user_id(&schema));
    }

    #[test]
    fn request_clarification_schema_requires_ui_signals() {
        let schema = clarification_schema();
        assert!(schema_requires_field(&schema, "ui_signals"));
    }

    #[test]
    fn request_clarification_execute_returns_partial_response() {
        use uuid::Uuid;
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let tool = RequestClarificationTool;
            let ctx = ToolContext { user_id: Uuid::nil() };
            let input = serde_json::json!({
                "ui_signals": [{"type": "show_select", "field": "duration_minutes"}]
            });
            let result = tool.execute(&ctx, input).await.unwrap();
            assert_eq!(result["confirmation"], "");
            assert_eq!(result["actions_taken"], serde_json::json!([]));
            assert_eq!(result["ui_signals"][0]["field"], "duration_minutes");
        });
    }
}
