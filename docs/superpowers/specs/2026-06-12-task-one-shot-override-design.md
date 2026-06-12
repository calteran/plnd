# Design — User override of the `one_shot` flag (issue #81)

**Date:** 2026-06-12
**Status:** Approved (design phase)
**Issue:** [#81](https://github.com/calteran/plnd/issues/81) — *feat(tasks): add time-sensitive flag to distinguish stale-able carryover items*

> This is a point-in-time design artifact, not authoritative architecture. The controlling
> reference is [docs/architecture.md](../../architecture.md) §4.4 (Tasks) and §4.10 (The planning process).

## 1. Framing — issue #81 is already the `one_shot` flag

Issue #81 proposes a new `time_sensitive` boolean so that time-sensitive carryover items
(e.g. "take evening meds", "morning workout") are auto-dismissed rather than offered for
carry-over. Architecture §4.4 already defines exactly this concept under the name **`one_shot`**:

> **`one_shot` flag** — whether the task is meaningful only within its scheduled window
> (e.g., daily teeth brushing — missed yesterday is not relevant today) or remains relevant
> if missed (e.g., "call the dentist"). Inferred by the LLM at task creation; the user can
> override. Drives carryover behavior (§4.10): one-shot tasks left incomplete at window close
> are silently dropped; the rest surface in the next carryover review.

The behavior issue #81 asks for — **silent auto-dismiss of stale time-sensitive items** — is
already specified by §4.10 ("silently dropped … never appear in carryover") and already
implemented:

| Issue #81 scope item                    | Status                                                          |
| --------------------------------------- | -------------------------------------------------------------- |
| Backend field + migration               | ✅ `schedule_entries.one_shot` exists                          |
| Carryover auto-dismiss                  | ✅ `get_carryover` filters `one_shot = FALSE` (covered by test) |
| API DTO exposure                        | ✅ `one_shot` present in schedule DTOs                          |
| Frontend service + model (data)         | ✅ `one_shot` in `week-plan.ts` DTOs                            |
| Carryover UI handles stale items        | ✅ N/A by design — they never surface (auto-dismissed)         |
| LLM infers the flag at task creation    | ✅ agent `create_task` tool sets `one_shot`                     |
| **User can override the inferred flag** | ❌ **the one real gap** — no UI sets `one_shot` today           |

**Decision: we add no new field and no migration.** We reuse `one_shot` and implement the one
promise architecture already makes but does not deliver — *"the user can override"*. No
`architecture.md` change is required; §4.4 already covers it.

## 2. Goal

Let the user override the agent-inferred `one_shot` value through two surfaces:

1. **At creation** — only when the agent is genuinely uncertain whether a task is one-shot.
2. **After creation** — durably, from the day view, for anything the agent defaulted.

## 3. Non-goals

- No new `time_sensitive` column, type, or migration (reuses `one_shot`).
- No deadline / multi-day staleness model — `one_shot` is a pure boolean ("relevant only in
  its window" vs "still relevant if missed"). Deadlines are out of scope.
- No change to the carryover review step — it already excludes `one_shot` items.
- No change to `architecture.md`.

## 4. Design

### 4.1 Backend — override endpoint (`plnd_api` + `plnd_data`)

A near-mechanical clone of the existing status-patch path
(`PATCH /schedule/entries/{id}/status` → `update_entry_status`).

- **`plnd_data`** — add `update_entry_one_shot(user_id, entry_id, one_shot: bool)` to the
  schedule repository trait and its Postgres implementation, modeled on `update_entry_status`
  (scoped by `user_id`, returns `NotFound` when no row matches).
- **`plnd_api`** — add `PATCH /schedule/entries/{id}/one-shot` with body
  `{ "one_shot": bool }`. Responses: `204` on success, `404` when the entry is absent,
  `401` unauthorized. No validation table needed (boolean).

### 4.2 Creation-path override — agent `show_checkbox`, **uncertainty-gated**

Reuses the existing `UiSignal` → `show_checkbox` mechanism end to end; the `add-entry`
signal-form already renders checkbox signals, and answers round-trip via
`ConversationTurn.answers` → `TaskEntryRequest.context` → agent re-run → persisted value.

**Behavioral rule (the key UX decision):** the agent surfaces the `one_shot` confirmation
checkbox **only to resolve genuine uncertainty**. When the agent is confident about the
inferred value, it sets `one_shot` silently and emits no signal — preserving low-friction,
neurodivergent-friendly capture.

- Update the `create_task` tool guidance so the agent: (a) when confident, sets `one_shot`
  and emits no confirmation signal; (b) when genuinely ambiguous, emits a `show_checkbox`
  with `field: "one_shot"` and `default` = its best inference, letting the user decide.
- No new client rendering — the checkbox renders through the existing signal-form.

### 4.3 Day-view override — `task-row` toggle (only net-new UI)

- Add `oneShot: boolean` to the `ScheduleTask` client model and populate it from
  `ScheduleEntryDto.one_shot` in the day-view mapping.
- Add a **subtle** affordance on `task-row` to flip carry-over vs one-time. Per the
  sensory-friendly principle, it stays visually quiet by default and is emphasized only when a
  task *is* one-time; it is keyboard-accessible with a clear `aria-label`.
- The control emits an event the parent wires to a new
  `ScheduleService.setEntryOneShot(id, oneShot)` calling the §4.1 endpoint.

### 4.4 User-facing copy

Never expose the words `one_shot` or `time_sensitive` in the UI.

- **Label:** "One-time only"
- **Helper / aria text:** "Won't carry over to next week if missed."

## 5. Data flow

```
Creation (uncertain):
  user types task → agent infers one_shot, judges uncertainty
    → uncertain: create_task emits show_checkbox(one_shot, default=inferred)
        → add-entry renders checkbox → user answers
        → answer returns as context → agent persists chosen one_shot
    → confident: create_task sets one_shot silently (no signal)

Post-creation:
  day view shows task with oneShot (from DTO)
    → user flips task-row toggle
    → ScheduleService.setEntryOneShot(id, value)
    → PATCH /schedule/entries/{id}/one-shot
    → update_entry_one_shot(user_id, id, value)

Carryover (unchanged):
  get_carryover excludes one_shot = TRUE → stale one-time tasks never surface
```

## 6. Testing

- **Rust**
  - `update_entry_one_shot` roundtrip (set true/false, read back; `NotFound` for bad id /
    wrong user).
  - `PATCH /schedule/entries/{id}/one-shot` route: `204` success, `404` missing, `401`
    unauthorized.
  - Agent `create_task`: can carry a `one_shot` `show_checkbox`; confident path sets the value
    without a signal.
- **Angular**
  - `task-row` toggle emits the expected event and reflects `oneShot` state.
  - `ScheduleService.setEntryOneShot` issues the correct PATCH.
  - Day-view mapping populates `oneShot` from `one_shot`.
- **E2E** (per CLAUDE.md mock policy — agent endpoints mocked, schedule via real backend)
  - Create a task → flip "One-time only" in the day view → confirm it is absent from the next
    carryover review (exercises the real backend `one_shot = FALSE` exclusion).

## 7. Follow-ups

- Update issue #81 with a comment recording the reframe (reuse `one_shot`; no new field) so the
  history is clear for anyone who linked the original `time_sensitive` proposal.
