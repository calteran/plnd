# Onboarding Loading Screen — Design Spec

**Date:** 2026-04-27
**Status:** Implemented

## Context

The task-placement substep in onboarding calls an AI endpoint that can take several seconds.
The prior loading state was a plain text div with no animation. This spec documents the
replacement design.

## Visual Design

**Layout:** Full content area inside the existing spoke chrome. Centred column:
1. Pulsing amber calendar icon (52 px circle, `--color-accent` background, radial pulse)
2. `"Building your plan"` heading (18 px, bold)
3. `"This should only take a moment…"` subtitle
4. Chat message stream

**Chat stream container:** Fixed height (210 px), `overflow: hidden`, `position: relative`.
A CSS `mask-image` gradient (transparent → opaque over 36 px) softens the top edge so
messages that scroll off-screen dissolve rather than hard-clip.

**Chat list:** `position: absolute; bottom: 0` — new messages always appear at the bottom.
The list grows upward naturally; the container clips old messages at the top.

## Message Behaviour

- A **typing indicator** (three bouncing dots) appears first.
- After a **randomised delay** (1 100 – 2 400 ms), the indicator is replaced by a message bubble.
- Messages enter with a short `translateY + scale` ease-in animation.
- Maximum **6 messages** are retained in the DOM at any time; oldest entries are pruned
  once they are definitely off-screen (container height ≈ 4 bubbles).

## Message Selection Algorithm

```
p(generic) = usedPersonalised / totalPersonalised
```

- At first draw: 0 % generic (all personalised).
- As personalised messages are consumed the generic probability rises continuously.
- Once all personalised messages are shown: 100 % generic.

**Personalised messages** (built from `taskCount`, `routineCount`, `taskNames` inputs):
- `"Found N tasks & M routines"` (always included)
- One of four templates per task name (up to 5 tasks):
  - `"Protecting time for <name>…"`
  - `"Fitting <name> into your morning…"`
  - `"Scheduling <name> around your focus blocks…"`
  - `"Reserving buffer after <name>…"`

**Generic library** (14 entries, shuffled and recycled):
Negotiating with Tuesday, Herding cats (metaphorically), Consulting the calendar spirits,
Untangling your week, Aligning the cosmic schedule, Applying temporal smoothing,
Coaxing tasks into sensible order, Convincing Monday to cooperate, Optimising for sanity,
Cross-referencing your best hours, Resolving scheduling paradoxes, Defragmenting your week,
Analysing your energy patterns, Almost there…

**Easter egg:** `"Reticulating splines…"` fires on every 15th generic draw (~6.7 % of
generic draws). Inspired by SimCity's classic loading humour.

## Component API

```typescript
selector: 'app-onboarding-loading-screen'
inputs:
  taskCount:    number    // tasks being placed
  routineCount: number    // routines in the plan
  taskNames:    string[]  // individual task names for personalised messages
```

Timer loop starts in `ngOnInit`, all handles cleared in `ngOnDestroy`.

## Timer Implementation

Two nullable fields (`pendingT1`, `pendingT2`) track the currently-pending timers only.
The schedule is strictly sequential so at most two handles are live at once — an accumulating
array would be a memory leak.
