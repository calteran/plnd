use std::sync::Arc;

use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use plnd_data::repository::{MealAnchorInstanceRepository, ScheduleRepository, TaskRepository};

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

// ── Helper: wall-clock duration between two times-of-day ─────────────────────────

/// Minutes from `start` to `end`, both wall-clock `TIME` values (#936). A span
/// that crosses midnight has `end < start`; wrapping into `[0, 24h)` recovers
/// the positive duration for any sub-24h span.
fn wall_clock_duration_minutes(start: NaiveTime, end: NaiveTime) -> i64 {
    (end - start).num_minutes().rem_euclid(24 * 60)
}

// ── Helper: map plnd_data::Error → ToolError ─────────────────────────────────────

fn db_err(tool: &str, e: plnd_data::Error) -> ToolError {
    ToolError::Execution {
        tool: tool.to_string(),
        reason: e.to_string(),
    }
}

// ── GetDayScheduleTool ────────────────────────────────────────────────────────

pub struct GetDayScheduleTool {
    schedule: Arc<dyn ScheduleRepository>,
    anchors: Arc<dyn MealAnchorInstanceRepository>,
}

#[async_trait::async_trait]
impl Tool for GetDayScheduleTool {
    fn name(&self) -> &str {
        "get_day_schedule"
    }

    fn description(&self) -> &str {
        "Retrieve the schedule for a given date including meals, tasks, and appointments. \
         Use this to understand task density before placing a new task."
    }

    fn schema(&self) -> serde_json::Value {
        get_day_schedule_schema()
    }

    fn is_terminal(&self) -> bool {
        false
    }

    async fn execute(
        &self,
        ctx: &ToolContext,
        input: serde_json::Value,
    ) -> Result<serde_json::Value, ToolError> {
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

        let entries = self
            .schedule
            .get_day_entries(ctx.user_id, date)
            .await
            .map_err(|e| db_err(self.name(), e))?;

        let anchors = self
            .anchors
            .list_for_date(ctx.user_id, date)
            .await
            .map_err(|e| db_err(self.name(), e))?;

        let task_count = entries.len();
        let anchor_count = anchors.len();
        let summary =
            format!("{task_count} tasks and {anchor_count} meal anchors scheduled for this date");

        let entry_values: Vec<serde_json::Value> = entries
            .into_iter()
            .map(|e| {
                let mut obj = serde_json::Map::new();
                obj.insert(
                    "title".to_string(),
                    serde_json::Value::String(e.title.unwrap_or_default()),
                );
                obj.insert(
                    "type".to_string(),
                    serde_json::Value::String(e.task_type.clone()),
                );
                if let Some(start) = e.scheduled_start {
                    obj.insert(
                        "time".to_string(),
                        serde_json::Value::String(start.format("%H:%M").to_string()),
                    );
                }
                if let Some(slot_label) = e.after_anchor {
                    obj.insert("slot".to_string(), serde_json::Value::String(slot_label));
                }
                if let (Some(start), Some(end)) = (e.scheduled_start, e.scheduled_end) {
                    let mins = wall_clock_duration_minutes(start, end);
                    obj.insert(
                        "duration".to_string(),
                        serde_json::Value::Number(mins.into()),
                    );
                }
                serde_json::Value::Object(obj)
            })
            .collect();

        let anchor_values: Vec<serde_json::Value> = anchors
            .into_iter()
            .map(|a| {
                serde_json::json!({
                    "id": a.id.to_string(),
                    "name": a.name,
                    "preferred_time": a.preferred_time.format("%H:%M").to_string(),
                    "tolerance_minutes": a.tolerance_minutes,
                })
            })
            .collect();

        Ok(serde_json::json!({
            "date": date.to_string(),
            "entries": entry_values,
            "meal_anchors": anchor_values,
            "summary": summary
        }))
    }
}

// ── CreateTaskTool ────────────────────────────────────────────────────────────

pub struct CreateTaskTool(Arc<dyn TaskRepository>);

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

        let scheduled_start: Option<DateTime<Utc>> = match input
            .get("scheduled_start")
            .and_then(|v| v.as_str())
        {
            Some(s) => Some(
                s.parse::<DateTime<Utc>>()
                    .map_err(|_| ToolError::InvalidInput {
                        tool: self.name().to_string(),
                        reason: format!("'scheduled_start' is not a valid ISO 8601 datetime: {s}"),
                    })?,
            ),
            None => None,
        };

        let after_anchor = input
            .get("after_anchor")
            .and_then(|v| v.as_str())
            .map(str::to_string);

        // null / absent both mean "not one-shot"; non-boolean values are schema
        // violations and are intentionally treated as false (safe default).
        let one_shot = input
            .get("one_shot")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        if scheduled_start.is_none() && after_anchor.is_none() {
            return Err(ToolError::InvalidInput {
                tool: self.name().to_string(),
                reason: "at least one of 'after_anchor' or 'scheduled_start' must be provided"
                    .to_string(),
            });
        }

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
                scheduled_start,
                duration_minutes,
                after_anchor.as_deref(),
                one_shot,
            )
            .await
            .map_err(|e| db_err(self.name(), e))?;

        Ok(serde_json::json!({
            "actions_taken": [{
                "type": "task_created",
                "task_id": task.task_id,
                "date": date.to_string(),
                "after_anchor": after_anchor,
                "scheduled_at": scheduled_start
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
/// let task_repo: Arc<dyn TaskRepository> = Arc::new(PgTaskRepository::new(pool.clone()));
/// let schedule_repo: Arc<dyn ScheduleRepository> = Arc::new(PgScheduleRepository::new(pool));
/// register_schedule_tools(&mut registry, task_repo, schedule_repo, anchor_repo);
/// ```
pub fn register_schedule_tools(
    registry: &mut ToolRegistry,
    task_repo: Arc<dyn TaskRepository>,
    schedule_repo: Arc<dyn ScheduleRepository>,
    anchor_repo: Arc<dyn MealAnchorInstanceRepository>,
) {
    registry.register(Arc::new(GetDayScheduleTool {
        schedule: schedule_repo,
        anchors: anchor_repo,
    }));
    registry.register(Arc::new(CreateTaskTool(task_repo)));
    registry.register(Arc::new(RequestClarificationTool));
}

// ── Schema constructors ───────────────────────────────────────────────────────

fn get_day_schedule_schema() -> serde_json::Value {
    serde_json::json!({
        "type": "object",
        "required": ["date"],
        "properties": {
            "date": {
                "type": "string",
                "description": "Calendar date to retrieve the schedule for (YYYY-MM-DD)."
            }
        }
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
            "date": {
                "type": "string",
                "format": "date",
                "description": "Calendar date for the task (YYYY-MM-DD)."
            },
            "scheduled_start": {
                "type": "string",
                "format": "date-time",
                "description": "ISO 8601 datetime when the task starts. Omit for slot-based placement."
            },
            "after_anchor": {
                "type": "string",
                "description": "Slot anchor label to position this task after. Use the 'slot' value \
                                from an anchor entry (is_anchor = true) returned by get_day_schedule, \
                                or a free-form anchor label. Omit when scheduled_start is set."
            },
            "one_shot": {
                "type": "boolean",
                "description": "Whether this task is meaningful only within today's window. \
                                One-shot tasks are silently dropped at window close and never \
                                surface in carryover review (e.g. 'brush teeth'). \
                                Infer from context; default false."
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

// ── PlaceTasksTool ────────────────────────────────────────────────────────────

/// Terminal tool: the LLM calls this with the full array of scheduled task
/// placements. The input is returned verbatim as the agent's final output.
/// Schema validation in `AgentService::run` enforces the response contract.
/// No DB writes occur here.
///
/// The outer `{"entries": [...]}` wrapper exists because the Anthropic API
/// requires tool input schemas to be `type: object`.
pub(crate) struct PlaceTasksTool;

#[async_trait::async_trait]
impl Tool for PlaceTasksTool {
    fn name(&self) -> &str {
        "place_tasks"
    }

    fn description(&self) -> &str {
        "Submit the complete set of scheduled task placements. Call this as your \
         final action once every task from the input list has been assigned a date, \
         time window, duration, and energy level. Pass the full entries array — \
         never omit a task."
    }

    fn schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "required": ["entries"],
            "additionalProperties": false,
            "properties": {
                "entries": {
                    "type": "array",
                    "description": "One entry per task from the input list",
                    "items": {
                        "type": "object",
                        "required": ["title", "scheduled_date",
                                     "duration_minutes", "energy_required", "task_type"],
                        "additionalProperties": false,
                        "properties": {
                            "title": {
                                "type": "string",
                                "description": "Exact task name — do not alter it"
                            },
                            "scheduled_date": {
                                "type": "string",
                                "format": "date",
                                "description": "ISO date within the plan period"
                            },
                            "after_anchor": {
                                "type": "string",
                                "description": "Slot anchor label for floating tasks. Use the 'slot' \
                                                value from an anchor entry in the schedule context \
                                                (is_anchor = true). Mutually exclusive with \
                                                time_window_start."
                            },
                            "time_window_start": {
                                "type": "string",
                                "description": "Exact wall-clock start as HH:MM — for fixed tasks \
                                                only (appointments, medication doses, scheduled calls). \
                                                Mutually exclusive with after_anchor."
                            },
                            "duration_minutes": {
                                "type": "integer",
                                "minimum": 1,
                                "maximum": 480,
                                "description": "Estimated duration in minutes"
                            },
                            "energy_required": {
                                "type": "string",
                                "enum": ["low", "medium", "high"],
                                "description": "Cognitive/physical energy demand"
                            },
                            "task_type": {
                                "type": "string",
                                "enum": ["work", "exercise", "leisure",
                                         "appointment", "medication", "general"],
                                "description": "Domain category for this task. \
                                                For personal errands or activities with \
                                                no specific category, use \"general\"."
                            },
                            "one_shot": {
                                "type": "boolean",
                                "description": "Whether this task is meaningful only within today's window. \
                                                One-shot tasks are silently dropped at window close and never \
                                                surface in carryover review (e.g. 'brush teeth'). \
                                                Infer from context; default false."
                            }
                        }
                    }
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
        Ok(input)
    }
}

/// Registers the terminal tool for the `PlaceTasks` use case.
pub(crate) fn register_place_tasks_tools(registry: &mut ToolRegistry) {
    registry.register(Arc::new(PlaceTasksTool));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn t(h: u32, m: u32) -> NaiveTime {
        NaiveTime::from_hms_opt(h, m, 0).unwrap()
    }

    #[test]
    fn wall_clock_duration_same_day() {
        assert_eq!(wall_clock_duration_minutes(t(9, 0), t(10, 0)), 60);
        assert_eq!(wall_clock_duration_minutes(t(9, 0), t(9, 0)), 0);
    }

    #[test]
    fn wall_clock_duration_crosses_midnight_is_positive() {
        // 23:30 → 00:30 is a 60-minute span, not -1380 (#936: wall-clock TIME
        // values wrap at midnight, unlike the prior next-day timestamptz instants).
        assert_eq!(wall_clock_duration_minutes(t(23, 30), t(0, 30)), 60);
    }

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
    fn create_task_schema_does_not_require_scheduled_start() {
        let schema = create_task_schema();
        assert!(!schema_requires_field(&schema, "scheduled_start"));
    }

    #[test]
    fn create_task_schema_has_scheduled_start_not_scheduled_at() {
        let schema = create_task_schema();
        let props = schema.get("properties").unwrap();
        assert!(props.get("scheduled_start").is_some());
        assert!(props.get("scheduled_at").is_none());
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

    #[test]
    fn get_day_schedule_schema_requires_date() {
        let schema = get_day_schedule_schema();
        assert!(schema_requires_field(&schema, "date"));
    }

    #[test]
    fn get_day_schedule_schema_has_no_user_id() {
        let schema = get_day_schedule_schema();
        assert!(!has_user_id_property(&schema));
        assert!(!schema_requires_user_id(&schema));
    }

    #[test]
    fn get_day_schedule_schema_is_consistent() {
        // Verify the schema free fn is self-consistent without needing a real pool.
        let schema = get_day_schedule_schema();
        assert!(schema_requires_field(&schema, "date"));
        assert!(!schema_requires_user_id(&schema));
        // date property should exist
        assert!(
            schema
                .get("properties")
                .and_then(|p| p.get("date"))
                .is_some()
        );
    }

    #[test]
    fn place_tasks_tool_is_terminal() {
        assert!(PlaceTasksTool.is_terminal());
    }

    #[test]
    fn place_tasks_tool_name() {
        assert_eq!(PlaceTasksTool.name(), "place_tasks");
    }

    #[tokio::test]
    async fn place_tasks_tool_returns_input_verbatim() {
        let tool = PlaceTasksTool;
        let ctx = ToolContext {
            user_id: uuid::Uuid::new_v4(),
        };
        let input = serde_json::json!({
            "entries": [{
                "title": "Call dentist",
                "scheduled_date": "2026-04-23",
                "time_window_start": "10:00",
                "duration_minutes": 30,
                "energy_required": "low",
                "task_type": "general"
            }]
        });
        let result = tool.execute(&ctx, input.clone()).await.unwrap();
        assert_eq!(result, input);
    }

    #[test]
    fn place_tasks_tool_schema_does_not_require_time_window_start() {
        let schema = PlaceTasksTool.schema();
        let items = &schema["properties"]["entries"]["items"];
        let required = items["required"].as_array().unwrap();
        assert!(
            !required
                .iter()
                .any(|v| v.as_str() == Some("time_window_start")),
            "time_window_start must not be required — floating tasks use after_anchor"
        );
        assert!(
            items["properties"].get("after_anchor").is_some(),
            "after_anchor must be a declared property"
        );
        assert!(
            items["properties"]["after_anchor"].get("enum").is_none(),
            "after_anchor must NOT have a hardcoded enum — it accepts any slot label"
        );
        assert_eq!(
            items["properties"]["after_anchor"]["type"].as_str(),
            Some("string"),
            "after_anchor must be typed as a free-form string"
        );
    }

    #[tokio::test]
    async fn place_tasks_tool_accepts_floating_task_with_after_anchor() {
        let tool = PlaceTasksTool;
        let ctx = ToolContext {
            user_id: uuid::Uuid::new_v4(),
        };
        let input = serde_json::json!({
            "entries": [{
                "title": "Review expense report",
                "scheduled_date": "2026-04-24",
                "after_anchor": "lunch",
                "duration_minutes": 45,
                "energy_required": "medium",
                "task_type": "work"
            }]
        });
        let result = tool.execute(&ctx, input.clone()).await.unwrap();
        assert_eq!(result, input);
    }

    #[test]
    fn create_task_schema_has_one_shot_property() {
        let schema = create_task_schema();
        assert!(
            schema["properties"].get("one_shot").is_some(),
            "create_task schema must have one_shot property"
        );
        assert_eq!(
            schema["properties"]["one_shot"]["type"].as_str(),
            Some("boolean")
        );
        assert!(
            schema["properties"]["one_shot"]["description"]
                .as_str()
                .unwrap_or("")
                .contains("carryover"),
            "one_shot description must mention carryover"
        );
    }

    #[test]
    fn place_tasks_schema_has_one_shot_in_items() {
        let tool = PlaceTasksTool;
        let schema = tool.schema();
        let items = &schema["properties"]["entries"]["items"];
        assert!(
            items["properties"].get("one_shot").is_some(),
            "place_tasks items must have one_shot property"
        );
        assert_eq!(
            items["properties"]["one_shot"]["type"].as_str(),
            Some("boolean")
        );
        assert!(
            items["properties"]["one_shot"]["description"]
                .as_str()
                .unwrap_or("")
                .contains("carryover"),
            "one_shot description must mention carryover"
        );
    }
}
