# Task Entry UX — Design Spec

**Date:** 2026-04-07
**Branch:** fix/task-entry-ux

---

## Context

The task entry form (`add-entry` component) has two UX problems:
1. The loading indicator while the LLM processes is a static, left-justified "…" — gives no visual feedback that work is happening.
2. After the agent confirms a task was created, the form neither resets nor closes — the confirmation text sits there until the user manually clicks Cancel, and the input field still contains the original text.

This spec covers replacing both with a polished, token-based, dark-mode-aware implementation.

---

## Design

### 1. Loading State

**Replace** the standalone `<div class="loading">…</div>` with a two-part treatment applied directly to the input field:

- **Shimmer:** The input field background animates with a slow (2.4s), single-direction sweep using `--color-surface-warm` → `--color-border-row` → `--color-surface-warm`. Use `linear` easing to avoid bounce. `background-size: 300% 100%`, animating from `100%` to `-100%` position.
- **Spinner:** An absolutely-positioned spinner inside a `.input-wrapper` div, right-aligned (`right: 11px`), using:
  - Track color: `--color-border-row`
  - Active arc: `--color-accent`
  - Size: 14×14px, border 2px, `0.75s linear infinite` rotation

The input is also set `readonly` while loading to prevent double-submission.

**Tokens used:** `--color-surface-warm`, `--color-border-row`, `--color-accent` — all have dark mode overrides in `_tokens.scss`.

---

### 2. "Adding More" Toggle

A checkbox + label row in the bottom-left of the action bar, always visible when the form is open.

- **Signal:** `addingMore = signal(false)` — resets to `false` in `open()` and `close()`; never persisted to `localStorage`
- **Label:** "Adding more"
- **Placement:** Left side of `.entry-actions`, using `flex: 1` spacer to push Cancel/Add to the right
- **Style:** `font-size: 11px`, `--color-text-muted` label, `--color-accent-border` checkbox accent

---

### 3. Post-Success Flow

**Remove** the inline `<p class="agent-confirmation">` entirely.

**Add** a `confirmed` output on `AddEntryComponent`:
```ts
readonly confirmed = output<string>();
```

In the `submit()` success path (when no `ui_signals`):
1. Emit `added` (existing)
2. Emit `confirmed` with `res.confirmation`
3. **If `addingMore()` is true:** clear `_text`, reset conversation state, re-focus the input — form stays open
4. **If `addingMore()` is false:** call `close()`

---

### 4. Toast Notification

**Host:** `day-view` component, which already handles `(added)` from `add-entry`.

**New binding:** `(confirmed)="onTaskConfirmed($event)"` on `<app-add-entry>`

**Toast component:** A new standalone `ToastComponent` (`features/schedule/components/toast/`) — or implemented inline in `day-view` if a single toast is all that's ever needed. Inline is preferred (YAGNI).

**Behavior:**
- Slides up from the bottom of the viewport (`translateY(100%) → translateY(0)`, 200ms ease-out)
- Displays the confirmation string (e.g. "Walk added for after lunch")
- Auto-dismisses after 2.5s with a 300ms fade-out (`opacity: 1 → 0`)
- Only one toast at a time; a new confirmation replaces any in-flight one

**Placement:** `position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%)`

**Tokens:** The success tokens work well here:
- Background: `--color-success`
- Text: `--color-surface-white`
- Box shadow: `--shadow-dropdown`

Dark mode is handled automatically since all three tokens have `[data-theme="dark"]` overrides.

> **Note:** `--color-surface-white` is `#ffffff` in light and `#2a2a3e` in dark — this reads well as white text on the green `--color-success` in light, but in dark mode `--color-success` is `#22c55e` (bright green) and `--color-surface-white` is near-black. Invert to use `--color-tooltip-bg` for text in dark mode, **or** extend `_tokens.scss` with `--color-toast-bg` / `--color-toast-text` tokens. Recommend the latter for clarity.

---

### 5. Error State

Unchanged — `<p class="agent-error">` remains inline in the entry panel.

---

## Files to Modify

| File | Change |
|------|--------|
| `plnd_client/src/app/features/schedule/components/add-entry/add-entry.ts` | New `addingMore` signal, `confirmed` output, updated `submit()` / `open()` / `close()`, template changes |
| `plnd_client/src/app/features/schedule/components/add-entry/add-entry.scss` | Replace `.loading`, add `.input-wrapper`, `.input-spinner`, `.entry-input.loading`, `.toggle-adding-more` |
| `plnd_client/src/app/features/day-view/day-view.ts` | Handle `(confirmed)` output, manage toast state |
| `plnd_client/src/app/features/day-view/day-view.scss` | Toast styles (`.toast`, `.toast-enter`, `.toast-exit`) |
| `plnd_client/src/styles/_tokens.scss` | Add `--color-toast-bg` / `--color-toast-text` tokens with dark mode values |

---

## Verification

1. `just verify-build` — confirm no compile errors
2. `just test-ng-headless` — confirm existing unit tests pass
3. Manual smoke test:
   - Open day view, click "Add something…"
   - Type a task, press Enter — input shimmers with spinner while loading
   - On success: toast slides up from bottom, form closes (or resets if "Adding more" checked)
   - Open form again, check "Adding more", add two tasks back-to-back — form stays open each time
   - Submit with network offline — error message still appears inline
   - Toggle dark mode — shimmer, spinner, toast all render correctly with token colors
