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
