# Onboarding UI Visual Design Spec

**Branch**: `docs/onboarding-spec-replan`
**Architecture reference**: `docs/superpowers/specs/2026-04-22-onboarding-enrichment-design.md`

This spec defines the visual design for the PLND onboarding enrichment flow — the hub-and-spoke first-run wizard that collects account, scheduling, and food preferences before activating a user's first plan. It covers every screen and interaction state. No code is prescribed — this is the design contract for implementation agents.

---

## Design System

All onboarding screens use these shared tokens:

| Token | Value | Usage |
|---|---|---|
| `--color-accent` | `#d97706` | Primary buttons, active borders, amber fills |
| `--color-accent-dark` | `#78350f` | Primary text, headings |
| `--color-accent-light` | `#fef3c7` | Amber surface fills |
| `--color-accent-border` | `#fde68a` | Amber borders |
| `--color-surface-warm` | `#fef9f0` | Page/screen background |
| `--color-surface-white` | `#ffffff` | Card interiors |
| `--color-green` | `#16a34a` | Completion states |
| `--color-green-light` | `#dcfce7` | Completion icon tile / badge backgrounds |

Card `border-radius`: 10px. Icon tile `border-radius`: 8px. All borders `1.5px` solid.

Energy badges use `color-mix()` against the warm surface to produce per-level tints.

**No AI/LLM language** anywhere in user-facing copy. Use passive voice: "Your tasks have been placed", never "The AI placed your tasks."

---

## Hub Screen (`/onboarding`)

The hub is the entry point and the final review surface. It does not have spoke chrome (no progress dots, no Back button). It transforms progressively as sections are completed.

### Layout

A vertical stack with a single-line prompt at the top:

```
Complete sections in any order
[Account Settings card]
[Tasks & Routines card]
[Food & Meals card]
[Exercise card]          ← disabled
[Skip]  [Approve Plan →] ← button row
```

### Section Cards

Each card: `36×36px` icon tile + title (`12px 700`) + subtitle (`10px` muted) + status badge right-aligned.

**Not started state**: amber border (`#fde68a`), amber icon tile bg (`#fef3c7`), badge reads "not started" (gray bg, `#9ca3af` text).

**Complete state**: green border (`#16a34a`), green icon tile bg (`#dcfce7`), badge reads "✓ done" (green bg/text). Subtitle remains visible.

Cards in order:

| Icon | Title | Subtitle |
|---|---|---|
| 👤 | Account Settings | Display name and notifications |
| 📋 | Tasks & Routines | Recurring routines and upcoming tasks |
| 🥗 | Food & Meals | Dietary needs and first meal plan |
| 🏃 | Exercise | Coming in a future update |

Exercise is permanently disabled: `55%` opacity, gray icon tile, "soon" pill badge, `cursor:default`.

Tapping any active card navigates into that spoke. Tapping a completed card re-enters it (user can revise).

### Stats Banner

Appears **only** when all three active spokes (Account, Tasks, Food) are complete. Fades and slides in on the last completion.

Amber surface (`#fef3c7`), amber border. Heading: "Everything looks good". Four stats in a row separated by `1px` dividers:

```
Routines  |  Tasks  |  Meals  |  Days
   3            4       14       14
```

Values are live-computed from `OnboardingStateService`. "Routines" = count of recurring routines. "Tasks" = count of one-off tasks placed. "Meals" = total non-skipped meal slots across the plan period. "Days" = plan period length.

### CTA Button Row

**While any spoke is incomplete**: two buttons side-by-side.
- Left: **Skip** — gray border (`#e5e7eb`), muted gray text, subdued weight.
- Right: **Approve Plan →** — ghost style (amber border `#fde68a`, amber text `#b45309`, `50%` opacity, `cursor:not-allowed`, disabled).

**When all spokes complete**: Skip button disappears. "Approve Plan →" becomes full-width amber primary (`#d97706` fill, white text, enabled).

Tapping "Approve Plan →" calls `commitPlan()` on the service, shows a "Saving…" submitting state (spinner inline in button, button disabled, cards and stats banner dim to `60%` opacity), then navigates to `/day/<plan-start-date>` on success. On error, an error banner appears below the button and the CTA re-enables for retry. Error copy: "Something went wrong — your plan wasn't saved. Please try again."

### Skip Modal

Tapping "Skip" opens a centered modal overlay (warm surface backdrop at `88%` opacity).

**Modal card** (white, amber border, `border-radius: 10px`):

- **Title**: "Skip setup for now?"
- **Body**: "Your progress is saved. You can add more detail anytime from **Settings**."
- **Buttons**: "Keep going" (ghost amber) left · "Skip for now" (gray primary — intentionally not amber) right.

"Keep going" dismisses the modal. "Skip for now" navigates to `/day/<today>` without committing a plan.

---

## Spoke Chrome

All three active spokes share identical chrome.

### Header Bar

```
← Hub        [Section Title]        ● ● ○ ○
```

- Left: "← Hub" link — always visible, navigates back to `/onboarding` without saving.
- Center: section title (e.g. "Tasks & Routines"), `13px 700`.
- Right: dot progress row — filled amber = completed step, solid amber ring = current step, gray = ahead.
- Tooltips on hover over each dot showing the step name.

### Footer

```
[← Back]                    [Save & Continue →]
```

- Left: "← Back" ghost button (amber border, amber text). Hidden on the first step of each spoke (← Hub covers it).
- Right: "Save & Continue →" amber primary. On the final step of a spoke, saves and navigates back to hub with that spoke marked complete.

---

## Account Settings (`/onboarding/account`)

**One step** — single dot in progress indicator (current + complete simultaneously). No Back button.

### Fields

**Display Name** — text input, full width. Pre-filled from account if available. Hint below: "Used in greetings and plan summaries."

**Email** — text input, full width. Pre-filled from auth, editable. Gray border + gray background to signal pre-population.

### Notifications

Section heading: "Notifications". Three toggle rows:

- **Email** — toggle + email address shown as subtitle below toggle label.
- **SMS** — toggle. When toggled on, a phone number text input reveals inline below the toggle row.
- **Push** — toggle. Enabling triggers the browser permission prompt.

### Future Placeholder

A dashed amber box below notifications: "More settings — integrations, accessibility, timezone — coming in a future update."

### Footer

"Save & Continue →" right-aligned amber primary. Saves and returns to hub with Account marked complete.

---

## Tasks & Routines (`/onboarding/tasks`)

Four steps. Dot progress indicator shows 4 dots.

### Step 1 — Planning Preferences (shared first-run)

Gated by `planningPrefsComplete` flag on `OnboardingStateService`. Auto-shown as step 1 the **first time** the user enters either Tasks & Routines or Food & Meals. Skipped on all subsequent entries to either spoke.

**First-run callout banner** (amber, below spoke header): "A few quick questions to set up your planning rhythm. You'll only see this once."

**Fields**:

- **Plan length** — 3-way segmented control: 1 week / **2 weeks** (default) / 4 weeks.
- **Week start** — 7-button single-select row (Sun → Sat). Default: Monday.
- **Planning day + time** — day pill single-select (M T W T F S S) + time picker. Sets the weekly planning reminder.

**Footer note**: "You can update these after onboarding in **Settings → Planning**."

No re-entry to this step from the hub during onboarding — changing plan length mid-flow would orphan already-placed tasks.

### Step 2 — Schedule Types

Defines the user's recurring day patterns (e.g. Weekdays, Weekends). All schedule types use the same card component. Two pre-configured instances are shown by default.

**Card anatomy** (one card per schedule type):
- Editable name — inline text input in the card header.
- Day pills: M T W T F S S — amber fill = assigned to this type, gray = unassigned. Pre-checked for Weekdays (M–F) and Weekends (S–S).
- Wake time + Bed time pickers — both required. Define the outer schedulable window for this day type.
- ✕ remove button — always visible. Gray + `cursor:not-allowed` while any days are assigned to this type; amber + clickable when all days are unchecked. Tapping the disabled ✕ shows an inline hint: "Uncheck all days before removing this type" (auto-dismisses after ~3s).

**"+ Add schedule type"** link below the cards creates a new blank card.

**7-day mode** (default): standard M T W T F S S pills.

**Cycle mode** (non-7-day schedules): a "Non-7-day schedule?" link at the bottom switches to cycle mode. In cycle mode, a cycle length (N days) and anchor start date appear at the top of the section; day pills become numbered 1…N. A "Switch to 7-day week" link returns to default. Cycle arithmetic: Day N = `(calendar_date − anchor) % cycle_length`.

Wake time for each schedule type is set here — this is where it lives, not Account Settings.

### Step 3 — Routines & Tasks Entry

Two sections on one pane, separated by a divider.

**Recurring Routines**

Subtitle: "Things you do on a regular schedule."

Entry row: name input + recurrence dropdown (Every day / Weekdays / Weekends / Weekly… / Custom…) + Add button. "Weekly…" reveals a day-of-week single-select inline. "Custom…" opens a more detailed picker (implementation concern).

**Quick-add chips** (labelled "Inspiration"):
🌅 Morning walk · 💊 Medication · 📓 Journal · 🦷 Brush teeth · 🧘 Meditate · 🛏 Wind down · 🐕 Walk the dog.
Tapping a chip adds it immediately with a sensible default recurrence.

Added routines appear as amber chips: `🌅 Morning walk · daily ✕`. Tapping the chip body opens an inline recurrence editor.

**Upcoming Tasks**

Subtitle: "One-off things to get done in your planning period. Duration and timing set in the next step."

Entry row: name input only + Add button. Duration and energy are deferred to Task Placement Review.

Added tasks appear as simpler amber chips: `Call dentist ✕`. No recurrence label.

### Step 4 — Task Placement Review

Shows all tasks (routines instantiated + one-off tasks) placed across the plan period in a day card grid. Meals are shown as slot dividers even though meal content isn't available yet.

**Layout**: horizontal scrolling row of day cards on desktop. Full-width vertical stack on mobile.

**Day card structure** (always expanded — no collapse on this screen):
- Header: day name (uppercase `800` weight) + date, warm surface background.
- Body: chronological interleaved timeline — meal slot dividers with tasks between them.

**Meal slot dividers**: amber fill (`#fef3c7`), amber borders, uppercase label ("BREAKFAST"). Shows `— italic` when no meal is placed yet. A note below the entire grid reads: "Meal slots will fill in once you complete the Food & Meals section."

**Task row — three interaction states**:

1. **Default**: title (`11px`, font-weight `500`, `#78350f`) + energy badge right-aligned. Timed tasks show time in amber (`700` weight) to the left of the title. Floating tasks show no time.
2. **Hovered / tapped**: subtle background highlight. A second row reveals: duration + slot summary ("30 min · afternoon") + amber-outlined "Edit" button right-aligned.
3. **Edit open**: white background + `3px` amber left border running the full height of the expanded block. Title row stays. Below: duration input (number + "min" label) + energy select in a row; then slot or time picker; then day picker; then Save (amber primary) + Remove (gray ghost) buttons.

Edit form varies by task type:
- **Floating task**: slot picker (Morning / Afternoon / Evening) + day picker.
- **Timed task**: time input + day picker.
Both include duration and energy.

**"Save & Return to Hub →"** amber primary CTA, right-aligned below the card row. Saves placement and navigates to hub with Tasks & Routines marked complete.

---

## Food & Meals (`/onboarding/food`)

Six steps. Dot progress indicator shows 6 dots.

### Step 1 — Planning Preferences (shared first-run)

Identical to Tasks & Routines step 1. Skipped if `planningPrefsComplete` is already set. See that section for full spec.

### Step 2 — Meal Times

Three cards: Breakfast / Lunch / Dinner. Each card uses the amber slot-divider visual language matching the Task Placement Review day-card meal dividers (amber fill header).

**Each card**: "From" time picker + "To" time picker — defines a window, not a point time.

Note below the cards: "Tasks are generally not scheduled during meal windows."

### Step 3 — Dietary Restrictions

**Banner**: "These foods should never appear in your meal plan." ("should never" — not "will never" — legal hedge.)

Three restriction types, all treated identically by the system (100% excluded):

| Type | Border color | Badge color |
|---|---|---|
| Allergy | `#fca5a5` | `#dc2626` red |
| Intolerance | `#fde68a` | `#b45309` amber |
| Cultural / Religious | `#c4b5fd` | `#7c3aed` purple |

**Entry**: type segmented selector (3 options) + name text input + Add button. A "+ Add a note" link below the entry row expands an optional notes field inline.

**Added items** render as mini-cards (not chips — notes need space). Card: type badge + name + optional notes line + ✕ in top-right.

**Card edit**: tapping anywhere on a card (except ✕) expands it inline. All other cards dim to `45%` opacity (only one card editable at a time). Expanded state: type selector row in header, editable name input, notes textarea, Cancel / Save buttons. ✕ remains accessible in top-right during editing.

### Step 4 — Dietary Preferences

**Banner**: "Your choices here reflect your tastes and practices, and will be considered when planning your meals."

#### Lifestyle (collapsible)

Starts collapsed. Collapsed state shows the section header + any selected lifestyle chips (✕-able, amber fill) + a quiet "+ Add more" chip if any are selected.

Expanded state shows all available lifestyles as grouped chips with hover tooltips (dark popover, factual description text, centered above chip with downward-pointing arrow).

Tap to toggle selection. Selected = amber fill + amber border + bold text.

Groups (alphabetical within each group):

- **Plant-based**: 🥛 Lacto-vegetarian, 🥚 Ovo-vegetarian, 🐟 Pescatarian, 🌿 Vegan, 🌱 Vegetarian, 🥦 Whole food plant-based
- **Dietary patterns**: 🫀 DASH, 🥑 Low-carb, 🫒 Mediterranean, 🥩 Paleo
- **Religious / Cultural**: ☪️ Halal, ✡️ Kosher
- **Avoidance**: 🌾 Gluten-free

**Add your own** (bottom of expanded panel): label "Add your own", text input, placeholder "e.g. low FODMAP, raw food…", Add button. The name is interpreted at meal-planning time — no description field needed.

#### Ingredient Ratings

Section divider, then:

- **Legend** above the emoji column: "hate — meh — love"
- **Entry row**: `[ingredient text input, flex-1]` + `[😖 😕 😐 🙂 😍 buttons]`
- **Rated rows**: `[✕ · ingredient name, flex-1]` + `[😖 😕 😐 🙂 😍 buttons]` — ✕ sits inside the left cell; emoji column aligns with the entry row.

Emoji scale: 😖 😕 😐 🙂 😍 (confounded face = strongly dislike). Color only on the selected button: red tint for 😖 / 😕, green tint for 🙂 / 😍. All unselected buttons stay flat gray.

#### Meal Ratings

Same visual pattern as Ingredient Ratings, in a separate section below with its own divider.

- **Section title**: "Meal Ratings"
- **Subtitle**: "Rate specific meals you love or want to avoid."
- **Entry row**: meal text input (placeholder "Meal…") + 5 emoji buttons.
- Rated rows, scale, and color rules identical to Ingredient Ratings.

### Step 5 — Meal Habits

**Description** (below spoke header): "Tell us about meals you have on a regular basis — they'll be scheduled in your plan automatically."

**Entry form** (contained in an amber-bordered card):

1. Meal name input — full width.
2. **Slot pills** (single-select, 3 options): Breakfast / Lunch / Dinner.
3. **Recurrence pills** (single-select, 4 options): Every day / Weekdays / Weekends / Weekly…
4. **Day picker** — revealed only when "Weekly…" is selected: M T W T F S S circle pills, single-select.

**Add button**: right-aligned amber primary. Label changes to **"Add anyway"** when an exact conflict is detected (see below).

**Conflict detection** — exact match = same slot AND same recurrence pattern:
- An inline amber warning appears below the form: "[Existing meal] already fills [Slot] [recurrence]. Adding [New meal] will give you two options for the same slot — the planner will alternate between them."
- Fuzzy overlaps (e.g. "Every day" + "Every Friday" covering the same slot) are silent — the planner resolves by specificity.

**Added habits** appear as amber chips below the form:
`[Meal name] · [Slot] · [Recurrence] ✕`
Remove and re-add to edit.

### Step 6 — Meal Plan Review

Adapted from `PlanMealsStepComponent` (`plnd_client/src/app/features/planning/steps/plan-meals-step/plan-meals-step.ts`). Step 6 = final step; its dot in the progress indicator renders as a ring (not filled).

#### Generation State

"Save & Continue →" is disabled (`40%` opacity, `cursor:not-allowed`) until generation completes.

First-run callout (amber banner): "Building your first meal plan… Using your dietary preferences and restrictions — usually about 10 seconds."

The grid renders as a shimmer skeleton (animated gray placeholder cells) during generation.

#### Post-Generation Grid

Days × meal slots (Breakfast / Lunch / Dinner). Adapts to plan period (1 / 2 / 4 weeks). Horizontal scrolling on desktop.

**Cell states**:

| State | Visual |
|---|---|
| Proposed | White bg, italic text, ✓ approve / ✏️ edit / 🔀 suggest buttons |
| Approved | Amber fill (`#fef3c7`), bold text, ✏️ edit only |
| Skipped | `45%` opacity, "— skipped" label + undo link |
| Editing | Inline text input, amber underline border, no action buttons |

× in the top-right of any non-skipped cell skips it.

#### Footer

```
[← Back]    [✓ Approve all N]  [🔀 Refresh N]    [Save & Continue →]
```

- "✓ Approve all [N]" — green button. Counts only proposed cells (not approved, not skipped). Hidden when N = 0.
- "🔀 Refresh [N]" — amber button. Same count. Hidden when N = 0. Opens confirmation modal before replacing cells.
- "Save & Continue →" — amber primary, always active post-generation.

**Refresh confirmation modal**: "This will replace [N] unapproved meals. Approved and edited meals stay as they are. Continue?" with Cancel / Refresh buttons.

**Below-grid note**: "Unapproved suggestions are kept as planned. You can review meals anytime from the planner."

Completing this step saves and returns to hub with Food & Meals marked complete.

---

## Hub — Complete State (Review & Commit)

There is no separate `/onboarding/review` route. The hub screen in its fully complete state serves as the review and commit surface.

When all three active spokes are done, the hub shows:
1. All three section cards with green completion state (as above).
2. The stats banner (fades in on last completion).
3. Full-width **"Approve Plan →"** amber primary CTA.

Tapping "Approve Plan →" calls `commitPlan()`. On success, navigates to `/day/<plan-start-date>`. On error, shows error banner; CTA re-enables.

**Submitting state**: button shows spinner + "Saving…"; button is disabled; cards and stats banner dim to `60%` opacity. (Skip button is already gone in the complete state.)

See the Hub Screen section above for full detail on the Skip button and modal.
