use std::sync::Arc;

use chrono::{DateTime, NaiveDate, Utc};
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

// ── Valid duration range ──────────────────────────────────────────────────────

const DURATION_MIN: i32 = 1;
const DURATION_MAX: i32 = 480;

fn validate_duration_minutes(value: i64, tool: &str) -> Result<i32, ToolError> {
    if !(DURATION_MIN as i64..=DURATION_MAX as i64).contains(&value) {
        return Err(ToolError::InvalidInput {
            tool: tool.to_string(),
            reason: format!(
                "duration_minutes {value} is out of range; must be {DURATION_MIN}–{DURATION_MAX}"
            ),
        });
    }
    Ok(value as i32)
}

// ── Helper: map DatabaseError → ToolError ─────────────────────────────────────

fn db_err(tool: &str, e: DatabaseError) -> ToolError {
    ToolError::Execution {
        tool: tool.to_string(),
        reason: e.to_string(),
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
        create_task_schema()
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

        let date_str =
            input
                .get("date")
                .and_then(|v| v.as_str())
                .ok_or_else(|| ToolError::InvalidInput {
                    tool: self.name().to_string(),
                    reason: "missing required field 'date'".to_string(),
                })?;

        let date = date_str
            .parse::<NaiveDate>()
            .map_err(|_| ToolError::InvalidInput {
                tool: self.name().to_string(),
                reason: format!("'date' is not a valid ISO 8601 date (YYYY-MM-DD): {date_str}"),
            })?;

        let scheduled_at: Option<DateTime<Utc>> = match input
            .get("scheduled_at")
            .and_then(|v| v.as_str())
        {
            Some(s) => Some(
                s.parse::<DateTime<Utc>>()
                    .map_err(|_| ToolError::InvalidInput {
                        tool: self.name().to_string(),
                        reason: format!("'scheduled_at' is not a valid ISO 8601 datetime: {s}"),
                    })?,
            ),
            None => None,
        };

        let after_milepost = input
            .get("after_milepost")
            .and_then(|v| v.as_str())
            .map(str::to_string);

        let duration_minutes = input
            .get("duration_minutes")
            .and_then(|v| v.as_i64())
            .ok_or_else(|| ToolError::InvalidInput {
                tool: self.name().to_string(),
                reason: "missing required field 'duration_minutes'".to_string(),
            })?;
        let duration_minutes = validate_duration_minutes(duration_minutes, self.name())?;

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

        let task = self
            .0
            .create_user_task(
                ctx.user_id,
                &title,
                &energy_level,
                date,
                scheduled_at,
                duration_minutes,
                after_milepost.as_deref(),
            )
            .await
            .map_err(|e| db_err(self.name(), e))?;

        Ok(serde_json::json!({
            "actions_taken": [{
                "type": "task_created",
                "task_id": task.task_id,
                "date": date.to_string(),
                "scheduled_at": scheduled_at
            }],
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
         Call this instead of create_task when any required task property cannot be \
         confidently inferred from the input or prior context. \
         This is a terminal tool — calling it ends the agent loop."
    }

    fn schema(&self) -> serde_json::Value {
        request_clarification_schema()
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
            .ok_or_else(|| ToolError::InvalidInput {
                tool: self.name().to_string(),
                reason: "missing required field 'ui_signals'".to_string(),
            })?;

        Ok(serde_json::json!({
            "actions_taken": [],
            "ui_signals": ui_signals,
            "confirmation": ""
        }))
    }
}

// ── Registration ──────────────────────────────────────────────────────────────

/// Register schedule tools into `registry`.
///
/// # Example
///
/// ```ignore
/// let store = Arc::new(TaskStore::new(pool));
/// register_schedule_tools(&mut registry, store);
/// ```
pub fn register_schedule_tools(registry: &mut ToolRegistry, store: Arc<TaskStore>) {
    registry.register(Arc::new(CreateTaskTool(store)));
    registry.register(Arc::new(RequestClarificationTool));
}

// ── Schema constructors ───────────────────────────────────────────────────────

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
            "date": {
                "type": "string",
                "format": "date",
                "description": "Calendar date for the task (YYYY-MM-DD)."
            },
            "scheduled_at": {
                "type": "string",
                "format": "date-time",
                "description": "ISO 8601 datetime when the task starts. Omit for bucket-based placement."
            },
            "after_milepost": {
                "type": "string",
                "enum": ["breakfast", "lunch", "dinner"],
                "description": "Schedule this task after a meal anchor. Use when scheduled_at is omitted."
            },
            "duration_minutes": {
                "type": "integer",
                "minimum": DURATION_MIN,
                "maximum": DURATION_MAX,
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
        "required": ["title", "energy_level", "date", "duration_minutes", "confirmation"]
    })
}

fn request_clarification_schema() -> serde_json::Value {
    serde_json::json!({
        "type": "object",
        "required": ["ui_signals"],
        "properties": {
            "ui_signals": {
                "type": "array",
                "items": { "type": "object" },
                "description": "UI hints for fields that need user input."
            }
        }
    })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

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

    #[test]
    fn create_task_schema_has_no_user_id() {
        let schema = create_task_schema();
        assert!(!has_user_id_property(&schema));
        assert!(!schema_requires_user_id(&schema));
    }

    #[test]
    fn create_task_schema_requires_title_date_and_confirmation() {
        let schema = create_task_schema();
        assert!(schema_requires_field(&schema, "title"));
        assert!(schema_requires_field(&schema, "date"));
        assert!(schema_requires_field(&schema, "confirmation"));
    }

    #[test]
    fn create_task_schema_does_not_require_scheduled_at() {
        let schema = create_task_schema();
        assert!(!schema_requires_field(&schema, "scheduled_at"));
    }

    #[test]
    fn request_clarification_tool_schema_delegates_to_free_fn() {
        // RequestClarificationTool is the only store-free struct; verify the
        // delegation pattern works end-to-end for one tool.
        let tool = RequestClarificationTool;
        assert_eq!(tool.schema(), request_clarification_schema());
    }

    #[test]
    fn request_clarification_is_terminal() {
        let tool = RequestClarificationTool;
        assert!(tool.is_terminal());
    }

    #[test]
    fn request_clarification_schema_has_no_user_id() {
        let schema = request_clarification_schema();
        assert!(!has_user_id_property(&schema));
        assert!(!schema_requires_user_id(&schema));
    }

    #[test]
    fn request_clarification_schema_requires_ui_signals() {
        let schema = request_clarification_schema();
        assert!(schema_requires_field(&schema, "ui_signals"));
    }

    #[test]
    fn request_clarification_execute_returns_partial_response() {
        use uuid::Uuid;
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let tool = RequestClarificationTool;
            let ctx = ToolContext {
                user_id: Uuid::nil(),
            };
            let input = serde_json::json!({
                "ui_signals": [{"type": "show_select", "field": "duration_minutes"}]
            });
            let result = tool.execute(&ctx, input).await.unwrap();
            assert_eq!(result["confirmation"], "");
            assert_eq!(result["actions_taken"], serde_json::json!([]));
            assert_eq!(result["ui_signals"][0]["field"], "duration_minutes");
        });
    }

    #[test]
    fn duration_minutes_valid_boundary() {
        assert_eq!(validate_duration_minutes(1, "test").unwrap(), 1);
        assert_eq!(validate_duration_minutes(480, "test").unwrap(), 480);
        assert_eq!(validate_duration_minutes(30, "test").unwrap(), 30);
    }

    #[test]
    fn duration_minutes_too_small() {
        assert!(validate_duration_minutes(0, "test").is_err());
        assert!(validate_duration_minutes(-1, "test").is_err());
    }

    #[test]
    fn duration_minutes_too_large() {
        assert!(validate_duration_minutes(481, "test").is_err());
        assert!(validate_duration_minutes(i64::MAX, "test").is_err());
    }

    #[test]
    fn duration_minutes_error_names_tool() {
        let err = validate_duration_minutes(0, "create_task").unwrap_err();
        match err {
            ToolError::InvalidInput { tool, .. } => assert_eq!(tool, "create_task"),
            _ => panic!("expected InvalidInput"),
        }
    }
}
