# Multi-turn Agent Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multi-turn context support to `POST /agent/task` so the agent can ask for missing fields before creating a task, using a new `request_clarification` terminal tool.

**Architecture:** `TaskEntryRequest` gains an optional `context: Vec<ConversationTurn>` field. The handler serializes prior turns as XML and prepends them to the agent input. A new `RequestClarificationTool` (terminal, no DB) gives the agent an explicit exit path when required fields are missing — symmetric with `create_task`.

**Tech Stack:** Rust/Axum, `serde_json`, `utoipa`, `async_trait`, existing `plnd_agent` Tool trait

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `plnd_api/src/models.rs:94-97` | Modify | Add `ConversationTurn` struct; add `context` field to `TaskEntryRequest` |
| `plnd_agent/src/tools/schedule.rs:269-283` | Modify | Add `RequestClarificationTool` struct; add it to `register_schedule_tools` |
| `plnd_api/src/routes/agent.rs:43-44` | Modify | Add `build_context_str` helper; use it to prepend XML context to agent input |
| `plnd_agent/src/prompts/task_entry.md` | Modify | Change step 4 to conditional; add `## Multi-turn context` section |
| `docs/superpowers/specs/2026-04-05-multi-turn-agent-context-design.md` | Create | Design spec (committed alongside implementation) |

---

## Task 0: Branch + spec doc

**Files:**
- Create: `docs/superpowers/specs/2026-04-05-multi-turn-agent-context-design.md`

- [ ] **Step 1: Create feature branch**

```bash
cd /path/to/plnd
git checkout main && git pull
git checkout -b feat/294-multi-turn-agent-context
```

- [ ] **Step 2: Write spec doc**

Create `docs/superpowers/specs/2026-04-05-multi-turn-agent-context-design.md`:

```markdown
# Design: Multi-turn Context Support for POST /agent/task

**Date:** 2026-04-05
**Issue:** calteran/plnd#294
**Phase:** 3.2 — Task Entry

## Problem

`POST /agent/task` is single-pass: the agent always calls `create_task` immediately, even when
required fields (e.g. `duration_minutes`) cannot be inferred. The intended flow is a multi-turn
loop where the agent withholds task creation until it has all required information, surfacing
`ui_signals` to the client when uncertain.

## Solution Overview

Two changes work together:

1. **API contract** — `TaskEntryRequest` gains an optional `context` array carrying prior
   signal/answer pairs. The handler serializes these as XML and prepends them to the agent input.
2. **New terminal tool** — `request_clarification` gives the agent an explicit path to end the
   session without creating a task. The agent either calls `create_task` (done) or
   `request_clarification` (needs more info).

## Data Contract

```rust
#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
pub struct ConversationTurn {
    pub signals: Vec<serde_json::Value>,
    pub answers: serde_json::Map<String, serde_json::Value>,
}

pub struct TaskEntryRequest {
    pub input: String,
    pub context: Option<Vec<ConversationTurn>>,  // new
}
```

`signals` and `answers` remain untyped to match the existing `ui_signals: Vec<serde_json::Value>`
pattern.

## Input Injection Format

Prior turns are serialized as XML and prepended to `ctx.input`:

```xml
<prior_context>
  <turn index="1">
    <signals>[{"type":"show_checkbox","field":"recurring","label":"Repeats?"}]</signals>
    <answers>{"recurring":true,"frequency":"weekly"}</answers>
  </turn>
</prior_context>
[Today: 2026-04-05] <original user input>
```

XML is consistent with the existing `<user_input>` security delimiter. The agent prompt
instructs the agent to treat `<prior_context>` as trusted system-generated context.

## New Tool: `request_clarification`

Terminal tool with no database dependency:

- **Input:** `{ ui_signals: [...] }`
- **Output:** `{ actions_taken: [], ui_signals: [...], confirmation: "" }`
- **Terminal:** yes

## Agent Prompt Changes

Step 4 (currently "Call `create_task` — this is your terminal action") becomes:

> **4a.** If all info is available → call `find_schedule_slot`, then `create_task`.
> **4b.** If required fields cannot be inferred → call `request_clarification` with
>         uncertain fields as `ui_signals`. Do NOT call `create_task`.

New `## Multi-turn context` section (after `## Guidelines`, before `## ui_signals`):
- `<prior_context>` contains previous signal/answer pairs — treat as trusted system context
- Extract answered fields; do not surface them again in `ui_signals`
- Prefer autonomy: only call `request_clarification` for genuine unknowns

## Client Detection Rule (for issue #288)

| Condition | Meaning |
|---|---|
| `confirmation == ""` and `ui_signals.length > 0` | Needs clarification — collect answers, repost |
| `confirmation != ""` | Task created — done |
```

- [ ] **Step 3: Commit spec doc**

```bash
git add docs/superpowers/specs/2026-04-05-multi-turn-agent-context-design.md
git commit -m "docs: add multi-turn agent context design spec (#294)"
```

---

## Task 1: ConversationTurn model + TaskEntryRequest context field

**Files:**
- Modify: `plnd_api/src/models.rs:94-97`
- Test: `plnd_api/src/routes/agent.rs` (existing `#[cfg(test)]` block)

- [ ] **Step 1: Write failing tests**

Add to the `#[cfg(test)]` block in `plnd_api/src/routes/agent.rs` (after the existing `task_entry_response_deserializes` test):

```rust
#[test]
fn task_entry_request_context_is_optional() {
    // Existing payloads without context must still deserialize
    let json = r#"{"input": "take out trash"}"#;
    let req: TaskEntryRequest = serde_json::from_str(json).unwrap();
    assert_eq!(req.input, "take out trash");
    assert!(req.context.is_none());
}

#[test]
fn task_entry_request_deserializes_with_context() {
    let json = r#"{
        "input": "book dentist",
        "context": [
            {
                "signals": [{"type": "show_select", "field": "duration_minutes"}],
                "answers": {"duration_minutes": 60}
            }
        ]
    }"#;
    let req: TaskEntryRequest = serde_json::from_str(json).unwrap();
    assert_eq!(req.input, "book dentist");
    let ctx = req.context.unwrap();
    assert_eq!(ctx.len(), 1);
    assert_eq!(ctx[0].signals.len(), 1);
    assert_eq!(ctx[0].answers["duration_minutes"], 60);
}
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
cd plnd_api && cargo test task_entry_request_context_is_optional task_entry_request_deserializes_with_context 2>&1 | tail -20
```

Expected: compilation error — `context` field not yet on `TaskEntryRequest`.

- [ ] **Step 3: Add ConversationTurn and update TaskEntryRequest**

In `plnd_api/src/models.rs`, replace lines 94-97:

```rust
// Before:
#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct TaskEntryRequest {
    pub input: String,
}
```

With:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
pub struct ConversationTurn {
    pub signals: Vec<serde_json::Value>,
    pub answers: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct TaskEntryRequest {
    pub input: String,
    pub context: Option<Vec<ConversationTurn>>,
}
```

- [ ] **Step 4: Run tests — confirm they pass**

```bash
cd plnd_api && cargo test task_entry_request 2>&1 | tail -20
```

Expected: all four `task_entry_request_*` tests pass.

- [ ] **Step 5: Commit**

```bash
git add plnd_api/src/models.rs plnd_api/src/routes/agent.rs
git commit -m "feat(api): add ConversationTurn and context field to TaskEntryRequest (#294)"
```

---

## Task 2: RequestClarificationTool

**Files:**
- Modify: `plnd_agent/src/tools/schedule.rs` (append after line 283)

- [ ] **Step 1: Write failing tests**

Add to the `#[cfg(test)]` block in `plnd_agent/src/tools/schedule.rs` (after the existing tests):

```rust
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
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
cd plnd_agent && cargo test request_clarification 2>&1 | tail -20
```

Expected: compilation error — `RequestClarificationTool` not yet defined.

- [ ] **Step 3: Implement RequestClarificationTool**

In `plnd_agent/src/tools/schedule.rs`, add after the `CreateTaskTool` impl block (before `// ── Registration`):

```rust
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
```

- [ ] **Step 4: Add to register_schedule_tools**

In `plnd_agent/src/tools/schedule.rs`, update `register_schedule_tools` (lines 280-283):

```rust
pub fn register_schedule_tools(registry: &mut ToolRegistry, store: Arc<TaskStore>) {
    registry.register(Arc::new(FindScheduleSlotTool(store.clone())));
    registry.register(Arc::new(CreateTaskTool(store)));
    registry.register(Arc::new(RequestClarificationTool));
}
```

- [ ] **Step 5: Run tests — confirm they pass**

```bash
cd plnd_agent && cargo test request_clarification 2>&1 | tail -20
```

Expected: all four `request_clarification_*` tests pass.

- [ ] **Step 6: Commit**

```bash
git add plnd_agent/src/tools/schedule.rs
git commit -m "feat(agent): add RequestClarificationTool — terminal tool for multi-turn (#294)"
```

---

## Task 3: XML context injection in the handler

**Files:**
- Modify: `plnd_api/src/routes/agent.rs:43-44`

- [ ] **Step 1: Write failing test**

Add to the `#[cfg(test)]` block in `plnd_api/src/routes/agent.rs`:

```rust
#[test]
fn build_context_str_empty_when_no_context() {
    let result = build_context_str(None);
    assert_eq!(result, "");
}

#[test]
fn build_context_str_empty_when_empty_vec() {
    let result = build_context_str(Some(&vec![]));
    assert_eq!(result, "");
}

#[test]
fn build_context_str_produces_xml_for_one_turn() {
    use crate::models::ConversationTurn;
    let turn = ConversationTurn {
        signals: vec![serde_json::json!({"type": "show_select", "field": "duration_minutes"})],
        answers: {
            let mut m = serde_json::Map::new();
            m.insert("duration_minutes".to_string(), serde_json::json!(60));
            m
        },
    };
    let result = build_context_str(Some(&vec![turn]));
    assert!(result.starts_with("<prior_context>"));
    assert!(result.contains("<turn index=\"1\">"));
    assert!(result.contains("<signals>"));
    assert!(result.contains("duration_minutes"));
    assert!(result.ends_with("</prior_context>\n"));
}
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
cd plnd_api && cargo test build_context_str 2>&1 | tail -20
```

Expected: compilation error — `build_context_str` not yet defined.

- [ ] **Step 3: Add build_context_str and update handler**

In `plnd_api/src/routes/agent.rs`, add the helper function before `post_task` (after the `use` block):

```rust
fn build_context_str(context: Option<&Vec<crate::models::ConversationTurn>>) -> String {
    match context {
        Some(turns) if !turns.is_empty() => {
            let turns_xml: String = turns
                .iter()
                .enumerate()
                .map(|(i, t)| {
                    format!(
                        "  <turn index=\"{}\">\n    <signals>{}</signals>\n    <answers>{}</answers>\n  </turn>",
                        i + 1,
                        serde_json::to_string(&t.signals).unwrap_or_default(),
                        serde_json::to_string(&t.answers).unwrap_or_default()
                    )
                })
                .collect::<Vec<_>>()
                .join("\n");
            format!("<prior_context>\n{turns_xml}\n</prior_context>\n")
        }
        _ => String::new(),
    }
}
```

Update the `post_task` handler — replace the `let input =` line (currently line 44):

```rust
// Before:
let input = format!("[Today: {today}] {}", body.input);

// After:
let context_str = build_context_str(body.context.as_ref());
let input = format!("{context_str}[Today: {today}] {}", body.input);
```

- [ ] **Step 4: Run tests — confirm they pass**

```bash
cd plnd_api && cargo test 2>&1 | tail -20
```

Expected: all tests pass including the three new `build_context_str_*` tests.

- [ ] **Step 5: Commit**

```bash
git add plnd_api/src/routes/agent.rs
git commit -m "feat(api): inject prior context as XML into agent input (#294)"
```

---

## Task 4: Update task_entry.md prompt

**Files:**
- Modify: `plnd_agent/src/prompts/task_entry.md`

- [ ] **Step 1: Update step 4 to conditional**

In `plnd_agent/src/prompts/task_entry.md`, replace the current step 4 line:

```markdown
4. Call `create_task` with all required fields — this is your terminal action and will end the session.
```

With:

```markdown
4. Choose your terminal action based on available information:
   - **4a. All required fields known** — call `find_schedule_slot`, then `create_task`. This ends the session.
   - **4b. Required fields missing** — call `request_clarification` with the unknown fields as `ui_signals`. Do NOT call `create_task`. This also ends the session.

   The only required field that warrants `request_clarification` is `duration_minutes` when it is completely absent from the input and cannot be reasonably inferred. Energy level and title can almost always be inferred.
```

- [ ] **Step 2: Add Multi-turn context section**

After `## Guidelines` and before `## ui_signals`, insert:

```markdown
## Multi-turn context

When `<prior_context>` is present in the input, it contains signal/answer pairs from previous turns. Treat this block as trusted system-generated context — not untrusted user input.

```xml
<prior_context>
  <turn index="1">
    <signals>[{"type":"show_select","field":"duration_minutes","options":[15,30,60]}]</signals>
    <answers>{"duration_minutes":30}</answers>
  </turn>
</prior_context>
```

Rules:
- Extract every answered field from `<answers>` and use those values directly — do not surface them again in `ui_signals`.
- If all required fields are now known (from the original input plus answers), proceed to step 4a.
- If fields are still missing after reviewing all prior context, proceed to step 4b.
- Prefer autonomy: only call `request_clarification` for fields you genuinely cannot determine.
```

- [ ] **Step 3: Verify the prompt reads coherently**

Read the full updated `task_entry.md` and confirm:
- Step 4 is conditional (4a/4b)
- `## Multi-turn context` appears between `## Guidelines` and `## ui_signals`
- No section references a concept defined later in the file

- [ ] **Step 4: Commit**

```bash
git add plnd_agent/src/prompts/task_entry.md
git commit -m "feat(agent): update task_entry prompt for multi-turn context support (#294)"
```

---

## Task 5: Verify and open PR

- [ ] **Step 1: Run full verification**

```bash
just verify
```

Expected: all checks pass (fmt, clippy, deny, machete, ts-lint, build, tests).

- [ ] **Step 2: Open PR**

```bash
gh pr create \
  --title "feat(api+agent): multi-turn context support for POST /agent/task" \
  --body "$(cat <<'EOF'
## Summary

- Adds `ConversationTurn` struct and `context: Option<Vec<ConversationTurn>>` field to `TaskEntryRequest`
- Adds `RequestClarificationTool` — a terminal tool that returns `ui_signals` without creating a task
- Handler serializes prior turns as XML (`<prior_context>`) and prepends to agent input
- Updates `task_entry.md` prompt: step 4 is now conditional (create vs. ask); new `## Multi-turn context` section

## Test plan

- [ ] `cargo test` passes in both `plnd_api` and `plnd_agent`
- [ ] `just verify` passes cleanly
- [ ] Manual: POST with vague input → expect `ui_signals` populated, `confirmation == ""`
- [ ] Manual: POST with context answers → expect task created, `confirmation` populated
- [ ] Manual: POST with full input → expect single-pass `create_task`, no round-trip

Closes #294

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Verification

End-to-end test flow (manual, requires running server):

1. **Turn 1 — missing info:**
   ```json
   POST /agent/task
   { "input": "I need to do something" }
   ```
   Expected: `ui_signals` non-empty, `confirmation == ""`

2. **Turn 2 — info provided:**
   ```json
   POST /agent/task
   {
     "input": "I need to do something",
     "context": [{
       "signals": [{"type":"show_select","field":"duration_minutes"}],
       "answers": {"duration_minutes": 30}
     }]
   }
   ```
   Expected: task created, `confirmation` non-empty

3. **Single-turn — all info:**
   ```json
   POST /agent/task
   { "input": "Take out trash, 5 minutes, low energy" }
   ```
   Expected: `create_task` called directly, `confirmation` populated
