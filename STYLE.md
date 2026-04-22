# PLND Visual Style Guide

A guide for AI agents and developers building or modifying the PLND frontend. The goal is twofold: document the visual patterns so new UI stays consistent, and explain the reasoning behind design decisions so agents can make good judgment calls when patterns don't fully cover a new situation.

This is a living document. Add to it when a design decision is made that future agents would otherwise have to reverse-engineer.

> **Navigation:** Jump to the section most relevant to your task. If you're building something new, start with §1–3. If you're matching an existing component, jump to §8.

---

## Table of Contents

**Part 1 — Design Language**
1. [Design Philosophy](#1-design-philosophy)
2. [Visual Tone & Personality](#2-visual-tone--personality)
3. [Color System](#3-color-system)
4. [Typography](#4-typography)
5. [Layout & Spacing](#5-layout--spacing)
6. [Key Visual Concepts](#6-key-visual-concepts)
7. [Dark Mode](#7-dark-mode)
8. [Accessibility](#8-accessibility)

**Part 2 — Component Reference**

9. [Day View Components](#9-day-view-components)
10. [Planning Wizard Components](#10-planning-wizard-components)
11. [Shared Styles & Tokens](#11-shared-styles--tokens)

---

## Part 1 — Design Language

### 1. Design Philosophy

PLND is a planner for neurodivergent users. Three principles shaped every visual decision:

**Gradual exposure.** Show a quick overview; reveal details on demand. Extra information — estimated task durations, nutrition detail, review panes — lives behind expansions and toggles, never in the default view. The user gets a clean summary first and dives in when ready.

**Sensory-friendly.** Avoid harsh contrast, jarring colors, and visual noise. The palette is warm and muted rather than high-contrast and clinical. Animations are subtle (150–200ms, ease-out). Nothing flashes, pulses, or demands attention uninvited.

**Customizable.** Design patterns should accommodate the user's way of working, not enforce one. UI should flex around user preferences rather than imposing a fixed workflow.

---

### 2. Visual Tone & Personality

The app should feel: **friendly and warm, professional without being cold, never cutesy.**

- **Friendly and warm** — approachable, soft surfaces, rounded corners, earth tones.
- **Professional without being cold** — consistent structure, readable typography, restrained use of color.
- **Never cutesy** — no bubble fonts, no whimsical-for-its-own-sake elements, no decorative use of emoji. The app takes the user's goals seriously.

**On emoji:** Emoji are used deliberately throughout the UI, but always for semantic purpose — as meal-type identifiers, as visual anchors in text-heavy sections (like wizard step headers), or as compact action labels (e.g., 🔀 for swap). They are never used to make the app feel playful or to fill space. When in doubt, ask whether removing the emoji would make the UI less clear. If yes, it's earning its place.

The amber/brown palette was chosen specifically for neurodivergent users: warm earth tones are less stimulating than cool blues, and muted cream surfaces reduce background noise. In dark mode the accent shifts from amber to indigo — a cooler tone that works better against dark surfaces while preserving the calm, non-clinical feel.

---

### 3. Color System

Token definitions live in `plnd_client/src/styles/_tokens.scss`. The palette is organized into semantic roles, not raw values — always use tokens, never hardcode hex values.

**Surfaces (`--color-surface-*`):** Layered warm whites and creams. The base → warm → meal gradient creates a subtle warmth hierarchy that signals content nesting without relying on borders.

**Accent (`--color-accent-*`):** Amber in light mode, indigo in dark mode. Used for interactive elements, active states, and user-facing feedback. Never purely decorative.

**Text (`--color-text-*`):** A four-level hierarchy — dark brown (primary headings), gray (body), amber-brown (secondary), light gray (muted/hint). Always pick the lowest-emphasis level that still reads clearly.

**Status (`--color-destructive-*`, `--color-success-*`):** Standard red/green. Used sparingly. PLND avoids punishing error states — destructive color should signal consequence, not failure.

**Purple (`--color-purple-*`):** Reserved exclusively for floating tasks — tasks that exist in the system but haven't been assigned to a specific day or time slot. Purple is visually quarantined from the amber world of scheduled content. Do not use purple for anything else.

**Energy (`--color-energy-*`):** Blue (low), orange (medium), dark red (high). A conventional cognitive/physical demand metaphor used on task badges.

---

### 4. Typography

**Font family:** `system-ui, -apple-system, sans-serif` — no external font loading. System fonts respect the user's OS preferences and load instantly.

**Weight is the primary hierarchy signal:**
- `800` — page anchors, primary headings, date displays
- `700` — section labels, card titles, important callouts
- `600` — UI controls, captions, secondary labels
- `400–500` — body copy, toast messages

**Size range:** 8px (tiny badges) to 24px (onboarding page titles). The conversational baseline is 12–13px.

**Uppercase + letter-spacing** is reserved for categorical labels — day headers, badge text, section labels with `.label` class. It signals "this is a label, not content." Do not apply it to body copy, headings, or titles.

---

### 5. Layout & Spacing

**Platform targets:** Desktop, mobile web, and mobile device are all first-class design targets. The responsive split at 768px is a genuine platform divide, not a graceful degradation. On mobile, the bottom navigation bar replaces the sidebar and touch targets expand to 44px minimum.

**Container width:** Content columns max at 860px and center horizontally with `margin-inline: auto`. Modals max at 380px.

**Spacing base unit:** 8px. Common values: 4, 8, 10, 12, 16, 24, 32px. The 10–12px range dominates row padding and component gaps. Use the scale — don't invent arbitrary values.

**Mobile specifics:**
- Bottom nav bar: 56px tall — toast and floating elements must account for this
- Touch targets: 44px minimum (checkboxes use a `::after` pseudo-element to expand the hit area)
- Sidebar navigation becomes bottom tab navigation at `max-width: 767px`

---

### 6. Key Visual Concepts

These are the design decisions that aren't obvious from the tokens alone. Understanding them helps when building new components that need to fit the existing visual grammar.

**Meal bands vs. task rows.** Meals are the structural anchors of a day's schedule. They appear as visually prominent "bands" with warm borders (`--color-border-meal`), emoji identifiers, and generous padding. Tasks are compact rows that nest within or between meals. This hierarchy reflects the domain: meals shape the day, tasks fill it. Don't treat meals and tasks as peers visually.

**The 40px gutter.** Every row in the schedule view — meal, task, add-entry — reserves a 40px column to the left of content for time display or emoji. This consistent left edge is why the schedule reads as orderly across mixed row types. New schedule row types must respect this alignment.

**Progressive disclosure in the schedule.** Meal rows expand into a nutrition/detail pane. The add-entry form starts as a faded (50% opacity) prompt and expands into a full input panel. This is the gradual exposure principle in action. The default view is always the clean summary; detail is one interaction away.

**Wizard progress pills.** The planning wizard uses pill-shaped step indicators rather than a progress bar. Pills are more scannable for multi-step flows, and each pill contains a step number so the user always knows their position in the sequence. The pill's visual state (inactive / active / done) maps to the user's progress through the wizard.

**Floating tasks (purple).** Tasks that haven't been assigned to a day live in a distinct purple panel, visually quarantined from the scheduled amber world. The purple color says "this exists in the system but hasn't been placed yet." The visual separation matters — don't merge floating and scheduled content into the same visual zone.

**Skeleton loading.** Loading states use skeleton placeholder elements sized to match the content they'll replace. This preserves layout stability (no reflow when content arrives) and reduces the perception of waiting compared to a spinner. Skeletons use a shimmer animation (1.4s, opacity 0.4→0.7→0.4).

**Accordion expansion.** Two expand/collapse techniques appear in the codebase; use the one that fits the content size. The planning wizard's task step and day-grid cards use a `max-height` CSS transition (0 → 800px, 0.25s ease-out / 0.3s ease-in) with chevron rotation — this preserves layout continuity during animation. The meal review pane uses Angular's `@if` for conditional DOM inclusion — appropriate when the expanded content is large or carries state that shouldn't persist while hidden. In both cases the chevron rotates 180° when open.

---

### 7. Dark Mode

Dark mode is implemented via CSS custom properties overridden on `[data-theme="dark"]` at the `<html>` element. Theme state is managed by `ThemeService` (`plnd_client/src/app/core/services/theme.service.ts`), which respects OS color scheme preference and persists the user's override to localStorage.

**Why indigo replaces amber in dark mode:** Amber on dark surfaces reads as a warning or caution signal, and loses the warmth it conveys on light backgrounds. Indigo (`#6366f1`) preserves the calm, non-clinical feel while providing sufficient contrast against dark surfaces. All token overrides for dark mode are in `_tokens.scss` under `[data-theme="dark"]`.

New features must be tested in both light and dark mode before shipping. The most common mistake is hardcoding a color in a component's SCSS instead of using a token — such values won't adapt to the dark theme.

---

### 8. Accessibility

**Focus rings:** Always visible, never removed. The default ring is `2px solid var(--color-accent)` with `2px offset`, defined in `plnd_client/src/styles/_reset.scss`. Do not suppress focus rings with `outline: none` unless you're providing an equally visible custom indicator.

**Touch targets:** 44px minimum on mobile for all interactive elements. Checkboxes use `::after { inset: -14px }` to expand the hit area without affecting layout.

**Color is never the sole indicator.** Energy level badges include text labels. Status colors are paired with icons or text. Never rely on hue alone to convey meaning — this matters for color-blind users and also for users in unexpected lighting conditions.

**Error states:** Avoid language or visual treatment that feels punishing. Destructive red signals consequence and caution, not user failure. Error messages should be instructive, not alarming.

---

## Part 2 — Component Reference

### 9. Day View Components

| Component | Path | Purpose |
|-----------|------|---------|
| `DayViewComponent` | `plnd_client/src/app/features/day-view/` | Root shell — composes the full day view including briefing, schedule, and empty/error states |
| `BriefingHeaderComponent` | `plnd_client/src/app/features/day-view/components/briefing-header/` | Side-by-side weather + headlines cards above the schedule; only shown for today |
| `YesterdaySnapshotComponent` | `plnd_client/src/app/features/day-view/components/yesterday-snapshot/` | Compact summary footer below the schedule |
| `MealReviewPaneComponent` | `plnd_client/src/app/features/day-view/components/meal-review-pane/` | Expandable nutrition detail panel; toggled via `@if`, slides open below a meal row |
| `DayHeaderComponent` | `plnd_client/src/app/features/schedule/components/day-header/` | Date display with prev/next navigation; the visual anchor for the schedule |
| `MealRowComponent` | `plnd_client/src/app/features/schedule/components/meal-row/` | A meal "band" — emoji, name, review toggle, nested task rows |
| `TaskRowComponent` | `plnd_client/src/app/features/schedule/components/task-row/` | A single checklist row; used both standalone and nested inside meal bands |
| `AddEntryComponent` | `plnd_client/src/app/features/schedule/components/add-entry/` | Progressive-disclosure entry form; opens from a faded prompt into a full input panel |

---

### 10. Planning Wizard Components

| Component | Path | Purpose |
|-----------|------|---------|
| `PlanningWizardComponent` | `plnd_client/src/app/features/planning/planning-wizard/` | Wizard shell — progress pills, step navigation, back/next footer |
| `PlanReviewStepComponent` | `plnd_client/src/app/features/planning/steps/plan-review-step/` | Carry-over review step for unfinished items from the previous week |
| `PlanTasksStepComponent` | `plnd_client/src/app/features/planning/steps/plan-tasks-step/` | Weekly task accordion with floating (unscheduled) task panel |
| `PlanMealsStepComponent` | `plnd_client/src/app/features/planning/steps/plan-meals-step/` | Weekly meal grid — assign, edit, skip, or AI-suggest meals per day |
| `PlanDayGridStepComponent` | `plnd_client/src/app/features/planning/steps/plan-day-grid-step/` | Per-day card grid for reviewing the full week at a glance |
| `PlanConfirmStepComponent` | `plnd_client/src/app/features/planning/steps/plan-confirm-step/` | Completion step with summary and CTA to return to the day view |

**Onboarding:**

| Component | Path | Purpose |
|-----------|------|---------|
| `OnboardingHubComponent` | `plnd_client/src/app/features/onboarding/hub/` | Hub-and-spoke card grid for first-run onboarding steps |
| `OnboardingAccountComponent` | `plnd_client/src/app/features/onboarding/account/` | Initial account setup and preference configuration |
| `OnboardingFoodComponent` | `plnd_client/src/app/features/onboarding/food/` | Food preferences and typical meal schedule setup |
| `OnboardingTasksComponent` | `plnd_client/src/app/features/onboarding/tasks/` | Initial task and energy baseline configuration |
| `OnboardingReviewComponent` | `plnd_client/src/app/features/onboarding/review/` | Final review of onboarding configuration |

---

### 11. Shared Styles & Tokens

| File | Purpose |
|------|---------|
| `plnd_client/src/styles/_tokens.scss` | All design tokens (colors, shadows) for both light and dark themes — the authoritative source for token values |
| `plnd_client/src/styles/_reset.scss` | Base reset, font family, and focus ring definition |
| `plnd_client/src/styles/_energy-badges.scss` | Shared energy level badge styles (low/medium/high) |
| `plnd_client/src/styles/_wizard-step-header.scss` | Shared step header styles used across all wizard steps |
| `plnd_client/src/app/core/services/theme.service.ts` | Theme state management — OS detection, localStorage persistence, `[data-theme]` toggling |
