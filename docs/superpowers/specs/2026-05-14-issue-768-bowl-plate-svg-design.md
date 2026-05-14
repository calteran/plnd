# Bowl/plate SVG illustrations for MealPlanLoadingComponent

**Issue:** calteran/plnd#768 — Polish: replace CSS-gradient bowl/plate in MealPlanLoadingComponent with SVG illustrations
**Master:** calteran/plnd#740
**Predecessor:** calteran/plnd#754 (added the CSS-gradient placeholders this issue replaces)
**Date:** 2026-05-14
**Status:** Approved

## Overview

`MealPlanLoadingComponent` (`plnd_client/src/app/features/onboarding/shared/meal-plan-loading/meal-plan-loading.ts`) currently uses CSS `radial-gradient` placeholders for its central bowl and plate visuals. The loader runs for 20–60 s during AI meal-plan generation; the gradients read as unfinished. This spec replaces them with hand-authored inline SVG illustrations.

After visual brainstorming, the design evolved past a 1:1 swap:

- **Bowl** gains structure (raised rim, ~65° perspective tilt, abstract ingredients) and continuous motion (steam wisps, spiraling ingredients).
- **Plate is scrapped entirely.** Drop-mode food particles now fall *into* the bowl. The mode-stage cross-fade collapses: one bowl is always visible, only the particle vocabulary changes between spiral and drop modes.
- **Drop animation rewritten** — particles can start anywhere along the top, then arc inward (X converges faster than Y) to land inside a 40–60 % "safe zone" over the bowl interior.

Net: component shrinks in code while the visual becomes significantly richer.

## Design Decisions

### Bowl SVG (always visible)

Inline `<svg>` inside a `.bowl-base` wrapper (class name preserved so the existing reduced-motion test selector still passes). Perspective via `<g transform="translate(60 60) scale(1 0.906) translate(-60 -60)">` → ratio 0.906 ≈ 65° tilt.

Four concentric shapes:

| Layer | Shape | Fill | Purpose |
|---|---|---|---|
| Exterior | `circle r=54` | `#7c2d12` | Dark bowl exterior |
| Rim band | `circle r=50` | `#b45309` | Mid-amber lip (4 px band visible) |
| Contents | `circle r=44` | `#ecfccb` | Pale-green broth (hue contrast vs cream loader background `#fef3c7`) |
| Crescent shadow | `path` arc | `#365314 @ 0.14` | Bottom-inside arc, suggests rim wall curving up |

Plus 11 swirling ingredients positioned at bowl center (60, 60) and animated:

- 3 carrots — `rect 10×3.5 @ rx 1.5`, `#ea580c`, 13 s
- 4 peas — `circle r=2.5–2.8`, `#65a30d`, 11 s
- 2 noodle squiggles — `path q-curve`, white stroke 2.2, 16 s
- 3 herb specks — `circle r=1.4`, `#15803d`, 9 s

Each ingredient uses the same `@keyframes ing-spiral` driven by per-element CSS custom properties: `--start` (entry angle in deg), `--dur` (cycle s), `--del` (negative delay to stagger). The keyframe rotates 540° while translating radius from 36 → 0 with scale 0.5 → 1 → 0.3 and a fade at each end. Margin of ~8 px between rim and outermost ingredient orbit.

`transform-box: view-box; transform-origin: 60px 60px;` rotates each ingredient around the bowl's geometric center. The outer `scale(1, 0.906)` perspective wrapper makes the spiral paths elliptical, matching the tilted bowl.

### Steam wisps

Three small inline `<svg>` curves rising above the bowl, staggered animation delays (0 s, 1 s, 2 s), stroke `#b45309 @ 0.55 opacity`, 3.2 s `rise` cycle.

### Spiral mode (unchanged behavior)

Particles continue to spiral in from perimeter `translate(140 px)` to bowl center via the existing `@keyframes spiralIn`. No changes to spiral particle emission.

### Drop mode (rewritten)

Plate removed. Drop particles now fall *into* the bowl. Each gets:

- `startX`: random in `[5, 95]` (% of stage width) — any horizontal start
- `targetX`: random in `[40, 60]` (% of stage width) — safe zone, always inside the bowl interior

Particle is positioned with `left: ${targetX}%` and given CSS variable `--start-x` in pixels for the px-offset from target. New `@keyframes dropAndDrift`:

```css
@keyframes dropAndDrift {
  0%   { transform: translate(var(--start-x), -30px) scale(0.6); opacity: 0; }
  18%  { opacity: 1; }
  60%  { transform: translate(calc(var(--start-x) * 0.22), 55px) scale(0.95); opacity: 1; }
  82%  { transform: translate(0, 95px) scale(1); opacity: 1; }
  100% { transform: translate(0, 125px) scale(0.3); opacity: 0; }
}
```

At 60 % of timeline, X has covered 78 % of its journey while Y is only 44 % down → gentle inward arc. Particles fade and shrink as they "submerge" into the broth.

### Reduced motion fallback

Existing `@media (prefers-reduced-motion: reduce)` block already disables all animations. New keyframes (`ing-spiral`, `rise`, `dropAndDrift`) must be added to the disable list. The static fallback renders the same SVG bowl in a `.bowl-base` wrapper with no animation.

## Files Changed

| File | Action |
|---|---|
| `plnd_client/src/app/features/onboarding/shared/meal-plan-loading/meal-plan-loading.ts` | Replace template, styles, and `emitFoodParticle`/`emitTextParticle` drop-mode branches; extend `Particle` interface with `startX`/`targetX`; add `dropOffsetPx` helper |
| `plnd_client/src/app/features/onboarding/shared/meal-plan-loading/meal-plan-loading.spec.ts` | Rewrite mode-alternation test (selectors `.mode-stage.spiral` / `.mode-stage.drop` are gone); add tests for drop `targetX` range and `dropOffsetPx` helper |

## Deferred

None — the design is final.

## Out of Scope

- Plate redesign (scrapped, not re-art-directed)
- Changes to `PlanMealsStepComponent` (importer; no API changes — same inputs/outputs)
- Backend changes (none — pure frontend)
- Architecture doc changes (no new patterns)
