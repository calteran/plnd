# Onboarding Dark/Light Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the onboarding component's inline styles to a dedicated `.scss` file and replace all hardcoded hex colors with CSS custom property tokens so the screen responds to the existing dark/light mode infrastructure.

**Architecture:** `ThemeService` already detects `prefers-color-scheme` and sets `data-theme` on `<html>`. `_tokens.scss` already defines full light and dark token palettes. `onboarding.ts` is the only component that bypasses this system via inline hardcoded colors. The fix is a pure CSS refactor: extract styles to `onboarding.scss`, replace every hex literal with a CSS variable, and change `styles:` to `styleUrl:` in the component decorator. No changes to services, tokens, or tests.

**Tech Stack:** Angular 18 standalone component, SCSS, CSS custom properties

---

### Task 1: Create worktree and branch

**Files:** (repo setup only)

- [ ] **Step 1: Create a new worktree**

```bash
just worktree-new
```

Name the branch `feat/onboarding-dark-mode` when prompted. This creates the worktree at `.worktrees/feat-onboarding-dark-mode/` with Angular deps pre-installed.

- [ ] **Step 2: Switch into the worktree**

```bash
cd .worktrees/feat-onboarding-dark-mode
```

All subsequent steps run from this directory.

---

### Task 2: Create `onboarding.scss`

**Files:**
- Create: `plnd_client/src/app/features/onboarding/onboarding.scss`

- [ ] **Step 1: Create the file with complete token-based styles**

Create `plnd_client/src/app/features/onboarding/onboarding.scss`:

```scss
.onboarding-shell {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-surface-base);
  padding: 1.5rem;
}

.onboarding-card {
  background: var(--color-surface-white);
  border-radius: 12px;
  box-shadow: var(--color-shadow-dropdown);
  padding: 2rem;
  width: 100%;
  max-width: 480px;
}

.progress-bar {
  height: 6px;
  background: var(--color-border-row);
  border-radius: 3px;
  overflow: hidden;
  margin-bottom: 0.5rem;
}

.progress-fill {
  height: 100%;
  background: var(--color-accent);
  border-radius: 3px;
  transition: width 0.3s ease;
}

.step-label {
  font-size: 0.75rem;
  color: var(--color-text-muted);
  margin: 0 0 1.5rem;
  text-align: right;
}

.step-content { display: flex; flex-direction: column; gap: 1rem; }

.step-title {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--color-text-primary);
  margin: 0;
}

.step-desc {
  color: var(--color-text-muted);
  font-size: 0.9375rem;
  margin: 0;
  line-height: 1.5;
}

.step-form {
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
}

.step-form--compact { gap: 0.625rem; }

.form-field { display: flex; flex-direction: column; gap: 0.375rem; }

.form-field--narrow { flex: 0 0 140px; }
.form-field--grow { flex: 1; }

.form-row { display: flex; gap: 0.75rem; align-items: flex-end; }

label {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--color-text-body);
}

input,
select,
textarea {
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--color-border-row);
  border-radius: 6px;
  font-size: 0.875rem;
  background: var(--color-surface-white);
  color: var(--color-text-body);
  font-family: inherit;
  width: 100%;
  box-sizing: border-box;
}

input:focus,
select:focus,
textarea:focus {
  outline: none;
  border-color: var(--color-accent);
}

textarea { resize: vertical; }

.step-actions { display: flex; margin-top: 0.5rem; }

.step-actions--two { gap: 0.75rem; }

.btn {
  padding: 0.5625rem 1.25rem;
  border-radius: 6px;
  font-size: 0.9375rem;
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition: opacity 0.15s ease;
}

.btn:disabled { opacity: 0.5; cursor: not-allowed; }

.btn--full { width: 100%; }

// `color: white` is the CSS named keyword — not a hex literal.
// White text is correct on both amber (light mode) and indigo (dark mode) accent buttons.
.btn--primary {
  background: var(--color-accent);
  color: white;
  flex: 1;
}

// filter: brightness(0.9) darkens by 10% regardless of the underlying color,
// so hover works correctly with both amber and indigo accent without a hover token.
.btn--primary:hover:not(:disabled) { filter: brightness(0.9); }

.btn--secondary {
  background: var(--color-border-row);
  color: var(--color-text-body);
  flex: 1;
}

.btn--secondary:hover:not(:disabled) { filter: brightness(0.9); }

.status-error {
  color: var(--color-destructive);
  font-size: 0.875rem;
  margin: 0;
}

.restriction-chips {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.chip {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  background: var(--color-accent-light);
  border-radius: 999px;
  padding: 0.25rem 0.75rem;
  font-size: 0.8125rem;
}

.chip-type {
  color: var(--color-accent-dark);
  font-weight: 600;
}

.chip-name { color: var(--color-text-body); }
```

- [ ] **Step 2: Confirm no hex values were introduced**

```bash
grep -n '#[0-9a-fA-F]\{3,6\}' plnd_client/src/app/features/onboarding/onboarding.scss
```

Expected output: (empty — no matches)

---

### Task 3: Update `onboarding.ts`

**Files:**
- Modify: `plnd_client/src/app/features/onboarding/onboarding.ts`

- [ ] **Step 1: Add `styleUrl` and remove the inline `styles` block**

In `plnd_client/src/app/features/onboarding/onboarding.ts`, make two edits to the `@Component` decorator:

**Add `styleUrl` before `template`** (insert after the `imports` line):

```typescript
  styleUrl: './onboarding.scss',
```

**Delete the entire `styles` block** — find and remove the `styles: [`` ... ``]` property at the bottom of the `@Component` decorator. It starts with:

```typescript
  styles: [`
    .onboarding-shell {
```

and ends with the closing backtick-bracket pair `` `] ``. Delete everything from `styles: [`` to the matching close, inclusive.

The decorator should close immediately after the template backtick with no `styles` property remaining.

- [ ] **Step 2: Verify no inline styles remain**

```bash
grep -n 'styles:' plnd_client/src/app/features/onboarding/onboarding.ts
```

Expected output: (empty — no matches)

- [ ] **Step 3: Verify `styleUrl` is present**

```bash
grep -n 'styleUrl' plnd_client/src/app/features/onboarding/onboarding.ts
```

Expected output:
```
  styleUrl: './onboarding.scss',
```

---

### Task 4: Build, test, and verify

**Files:** (verification only)

- [ ] **Step 1: Compile check**

```bash
just verify-build
```

Expected: clean compilation, no TypeScript or template errors.

- [ ] **Step 2: Run unit tests**

```bash
just test-ng-headless
```

Expected: all existing onboarding tests pass. No test changes needed — the spec tests component logic and class names (not colors), so extracting styles does not affect them.

- [ ] **Step 3: Manual visual smoke test**

```bash
just dev
```

Navigate to `/onboarding` in the browser.

**Light mode:** shell background warm/light, progress bar and primary button amber/orange, chips with amber tint, form inputs readable.

**Dark mode:** shell background `#1e1e2e`, card `#2a2a3e`, progress bar and primary button indigo, all text readable, no hardcoded light colors visible anywhere.

Step through all 3 steps in both modes and confirm every interactive element (progress bar, form fields, chips, error states, buttons) responds correctly.

---

### Task 5: Commit and open PR

**Files:** all modified files

- [ ] **Step 1: Commit the implementation**

```bash
git add plnd_client/src/app/features/onboarding/onboarding.scss \
        plnd_client/src/app/features/onboarding/onboarding.ts
git commit -m "feat(onboarding): extract inline styles and apply CSS variable tokens for dark/light mode"
```

- [ ] **Step 2: Commit the design spec and plan**

```bash
git add docs/superpowers/specs/2026-04-07-onboarding-dark-light-mode-design.md \
        docs/superpowers/plans/2026-04-07-onboarding-dark-light-mode.md
git commit -m "docs: add onboarding dark/light mode design spec and implementation plan"
```

- [ ] **Step 3: Rebase onto origin/main before opening the PR**

```bash
git fetch origin
git rebase origin/main
```

- [ ] **Step 4: Push and open PR**

```bash
git push -u origin feat/onboarding-dark-mode
gh pr create \
  --title "feat(onboarding): respect system dark/light mode" \
  --body "$(cat <<'EOF'
## Summary

- Extracts inline styles from `onboarding.ts` into a dedicated `onboarding.scss` file, aligning with project conventions
- Replaces all hardcoded hex colors with CSS custom property tokens from `_tokens.scss`
- Onboarding now responds to `ThemeService`/`data-theme` infrastructure already used by all other components
- Also aligns onboarding accent colors with the established brand palette (amber in light mode, indigo in dark mode)

No logic changes. No new tokens. No new tests required — existing tests cover component behavior, not colors.

## Test plan

- [ ] `just verify-build` passes cleanly
- [ ] `just test-ng-headless` — all onboarding tests pass
- [ ] Manual: step through all 3 onboarding screens in light mode — amber accent visible throughout
- [ ] Manual: step through all 3 onboarding screens in dark mode — dark surfaces, indigo accent, readable text

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
