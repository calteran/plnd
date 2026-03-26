# Wizard Shell Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update `planning-wizard.ts` to render a labeled pill-badge progress bar, fix the nav button weight, and align the header to the app's design system.

**Architecture:** All changes are confined to a single Angular standalone component (`planning-wizard.ts`) — template, styles, and one component property. No new files or components are created.

**Tech Stack:** Angular 17+ (standalone components, `@for` with `$first`/`$last` locals), CSS custom properties from `_tokens.scss`.

**Spec:** `docs/superpowers/specs/2026-03-26-wizard-shell-redesign-design.md`

---

## File Map

| File | Action |
|---|---|
| `plnd_client/src/app/features/planning/planning-wizard/planning-wizard.ts` | Modify — steps array, template, styles |
| `plnd_client/src/app/features/planning/planning-wizard/planning-wizard.spec.ts` | Modify — add pill label + state tests |

---

## Task 1: Progress bar — tests first

**Files:**
- Modify: `plnd_client/src/app/features/planning/planning-wizard/planning-wizard.spec.ts`

- [ ] **Step 1: Add three failing tests for the new progress bar**

  Open `planning-wizard.spec.ts` and add these three tests inside the existing `describe` block, after the last existing `it(...)`:

  ```typescript
  it('should render all 5 step labels', () => {
    const labels = fixture.nativeElement.querySelectorAll('.pill-label');
    const texts = Array.from(labels).map((el: any) => el.textContent.trim());
    expect(texts).toEqual(['Carryover', 'Tasks', 'Meals', 'Review', 'Confirm']);
  });

  it('should mark step 1 as active on init', () => {
    const pills = fixture.nativeElement.querySelectorAll('.progress-pill');
    expect(pills[0].classList).toContain('active');
    expect(pills[1].classList).not.toContain('active');
  });

  it('should mark step 1 as done and step 2 as active when on step 2', () => {
    fixture.componentInstance.weekPlanService.goToStep(2);
    fixture.detectChanges();
    const pills = fixture.nativeElement.querySelectorAll('.progress-pill');
    expect(pills[0].classList).toContain('done');
    expect(pills[1].classList).toContain('active');
  });
  ```

- [ ] **Step 2: Run the new tests to confirm they fail**

  ```bash
  just test-ng-headless 2>&1 | grep -A3 "pill\|step label\|FAILED\|SUMMARY"
  ```

  Expected: 3 failures — `.pill-label` elements don't exist yet, `.progress-pill` class doesn't exist yet.

---

## Task 2: Progress bar — implement

**Files:**
- Modify: `plnd_client/src/app/features/planning/planning-wizard/planning-wizard.ts`

- [ ] **Step 1: Replace the `steps` array**

  In `planning-wizard.ts`, replace:
  ```typescript
  readonly steps = [1, 2, 3, 4, 5];
  ```
  with:
  ```typescript
  readonly steps = [
    { n: 1, label: 'Carryover' },
    { n: 2, label: 'Tasks' },
    { n: 3, label: 'Meals' },
    { n: 4, label: 'Review' },
    { n: 5, label: 'Confirm' },
  ];
  ```

- [ ] **Step 2: Replace the progress bar template block**

  In the template, replace the entire `<div class="wizard-progress" ...>` block:
  ```html
  <div class="wizard-progress" role="progressbar"
       [attr.aria-valuenow]="weekPlanService.currentStep()"
       aria-valuemin="1" aria-valuemax="5">
    @for (s of steps; track s.n) {
      @if (!$first) {
        <span class="progress-sep">›</span>
      }
      <div class="progress-pill"
           [class.active]="weekPlanService.currentStep() === s.n"
           [class.done]="weekPlanService.currentStep() > s.n">
        <span class="pill-num">{{ s.n }}</span>
        <span class="pill-label">{{ s.label }}</span>
      </div>
    }
  </div>
  ```

- [ ] **Step 3: Replace the progress bar styles**

  In the `styles` array, replace the existing `.wizard-progress` and `.progress-step` rules with:
  ```css
  .wizard-progress { display: flex; align-items: center; gap: 4px; padding: 0.5rem 1rem; }
  .progress-pill { display: flex; align-items: center; gap: 5px; height: 28px; padding: 0 10px;
                   border-radius: 14px; border: 1.5px solid var(--color-border-row);
                   background: #fff; font-size: 11px; color: var(--color-text-muted); }
  .progress-pill.done { background: var(--color-accent-light); border-color: var(--color-accent-border);
                        color: var(--color-accent-dark); }
  .progress-pill.done .pill-num { background: var(--color-accent); color: #fff; }
  .progress-pill.active { background: var(--color-accent-light); border-color: var(--color-accent);
                          color: var(--color-accent-dark); }
  .progress-pill.active .pill-label { font-weight: 700; }
  .progress-pill.active .pill-num { background: var(--color-accent); color: #fff; }
  .pill-num { width: 16px; height: 16px; border-radius: 50%; background: var(--color-border-row);
              display: flex; align-items: center; justify-content: center;
              font-size: 10px; font-weight: 700; flex-shrink: 0; }
  .pill-label { white-space: nowrap; }
  .progress-sep { color: var(--color-text-muted); font-size: 12px; user-select: none; }
  ```

- [ ] **Step 4: Run tests — all should pass**

  ```bash
  just test-ng-headless 2>&1 | tail -20
  ```

  Expected: all tests pass including the 3 new ones.

- [ ] **Step 5: Commit**

  ```bash
  git add plnd_client/src/app/features/planning/planning-wizard/planning-wizard.ts \
          plnd_client/src/app/features/planning/planning-wizard/planning-wizard.spec.ts
  git commit -m "feat(planning): replace progress bar circles with labeled pill badges (#58)"
  ```

---

## Task 3: Nav button and header fixes

**Files:**
- Modify: `plnd_client/src/app/features/planning/planning-wizard/planning-wizard.ts`

These are visual-only style fixes. No new tests are needed — the existing `should create` and nav button tests cover the markup.

- [ ] **Step 1: Fix `.nav-btn` font size and weight**

  In the `styles` array, update the `.nav-btn` rule. Change:
  ```css
  font-size: 18px; font-weight: 700;
  ```
  to:
  ```css
  font-size: 16px; font-weight: 400;
  ```
  The full rule becomes:
  ```css
  .nav-btn { background: var(--color-accent-light); border: 1.5px solid var(--color-accent-border);
             border-radius: 8px; padding: 5px 14px; color: var(--color-accent-dark);
             font-size: 16px; font-weight: 400; line-height: 1; min-width: 44px; min-height: 44px;
             display: flex; align-items: center; justify-content: center; }
  ```

- [ ] **Step 2: Tighten `.wizard-header` padding**

  In the `styles` array, update `.wizard-header`:
  ```css
  .wizard-header { display: flex; justify-content: space-between; align-items: center; padding: 0.75rem 1rem; }
  ```

- [ ] **Step 3: Style the `h1` to match `.app-title`**

  Add this rule inside the `styles` array (e.g. after `.wizard-header`):
  ```css
  .wizard-header h1 { font-size: 1.25rem; font-weight: 800; color: var(--color-text-primary);
                      letter-spacing: -0.02em; margin: 0; }
  ```

- [ ] **Step 4: Run the full test suite**

  ```bash
  just test-ci 2>&1 | tail -30
  ```

  Expected: all tests pass.

- [ ] **Step 5: Run the quality suite**

  ```bash
  just verify 2>&1 | tail -20
  ```

  Expected: clean (fmt, clippy, deny, machete, ts-lint, ts-deps, build, tests all pass).

- [ ] **Step 6: Commit**

  ```bash
  git add plnd_client/src/app/features/planning/planning-wizard/planning-wizard.ts
  git commit -m "fix(planning): fix nav-btn weight, align wizard header to design system (#58)"
  ```
