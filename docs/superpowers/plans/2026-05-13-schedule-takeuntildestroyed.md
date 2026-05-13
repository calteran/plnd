# Schedule Service `takeUntilDestroyed` Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Guard the two ad-hoc PATCH subscriptions in `ScheduleService` with `takeUntilDestroyed` so they are safely cleaned up if the service is ever scoped below `providedIn: 'root'`.

**Architecture:** Inject `DestroyRef` as a class field (already valid in the injection context of field initializers), then pipe each bare `.subscribe()` call through `takeUntilDestroyed(this.destroyRef)`. No behavior change when the service is root-provided — this is purely defensive.

**Tech Stack:** Angular 17+, `@angular/core/rxjs-interop` (`takeUntilDestroyed`), `@angular/core` (`DestroyRef`, `inject`)

**Branch:** `fix/schedule-takeuntildestroyed` — worktree at `.worktrees/fix/schedule-takeuntildestroyed` (create with `just worktree-new fix/schedule-takeuntildestroyed`)

**Closes:** #788

---

## File Map

| Action | File |
|--------|------|
| Modify | `plnd_client/src/app/core/services/schedule.service.ts` |
| Verify (existing tests) | `plnd_client/src/app/core/services/schedule.service.spec.ts` |

---

### Task 1: Confirm baseline tests pass

**Files:**
- Read: `plnd_client/src/app/core/services/schedule.service.spec.ts`

- [ ] **Step 1: Run the existing unit tests from the worktree's `plnd_client` directory**

```bash
# From inside the worktree:
cd plnd_client && npx ng test --include="**/schedule.service.spec.ts" \
  --browsers=ChromeHeadless --watch=false --no-progress
```

Expected: All tests pass (27 specs, 0 failures). If any fail, stop and investigate before proceeding.

---

### Task 2: Add `DestroyRef` injection to `ScheduleService`

**Files:**
- Modify: `plnd_client/src/app/core/services/schedule.service.ts`

- [ ] **Step 1: Add `DestroyRef` to the `@angular/core` import on line 1**

Current:
```typescript
import { Injectable, inject, signal } from '@angular/core';
```

Replace with:
```typescript
import { DestroyRef, Injectable, inject, signal } from '@angular/core';
```

- [ ] **Step 2: Inject `DestroyRef` as a class field (after the `apiBase` field, line 12)**

Current block (lines 11–12):
```typescript
  private readonly http    = inject(HttpClient);
  private readonly apiBase = inject(ConfigService).getConfig().api.baseUrl;
```

Replace with:
```typescript
  private readonly http       = inject(HttpClient);
  private readonly apiBase    = inject(ConfigService).getConfig().api.baseUrl;
  private readonly destroyRef = inject(DestroyRef);
```

- [ ] **Step 3: Run unit tests to confirm nothing broke**

```bash
cd plnd_client && npx ng test --include="**/schedule.service.spec.ts" \
  --browsers=ChromeHeadless --watch=false --no-progress
```

Expected: All 27 specs pass.

---

### Task 3: Guard the `toggleItem` PATCH subscription

**Files:**
- Modify: `plnd_client/src/app/core/services/schedule.service.ts` (lines 76–78)

- [ ] **Step 1: Pipe the PATCH observable through `takeUntilDestroyed`**

Current:
```typescript
    this.http
      .patch(`${this.apiBase}/schedule/entries/${id}/status`, { status: toApiStatus(currentStatus) })
      .subscribe({ error: () => this.loadDay(this._date()) });
```

Replace with:
```typescript
    this.http
      .patch(`${this.apiBase}/schedule/entries/${id}/status`, { status: toApiStatus(currentStatus) })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ error: () => this.loadDay(this._date()) });
```

- [ ] **Step 2: Run unit tests**

```bash
cd plnd_client && npx ng test --include="**/schedule.service.spec.ts" \
  --browsers=ChromeHeadless --watch=false --no-progress
```

Expected: All 27 specs pass (the existing `toggleItem` PATCH tests exercise the same code path and still flush correctly through `HttpTestingController`).

---

### Task 4: Guard the `skipMeal` PATCH subscription

**Files:**
- Modify: `plnd_client/src/app/core/services/schedule.service.ts` (lines 87–89)

- [ ] **Step 1: Pipe the PATCH observable through `takeUntilDestroyed`**

Current:
```typescript
    this.http
      .patch(`${this.apiBase}/schedule/entries/${id}/status`, { status: 'skipped' })
      .subscribe({ error: () => this.loadDay(this._date()) });
```

Replace with:
```typescript
    this.http
      .patch(`${this.apiBase}/schedule/entries/${id}/status`, { status: 'skipped' })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ error: () => this.loadDay(this._date()) });
```

- [ ] **Step 2: Run unit tests**

```bash
cd plnd_client && npx ng test --include="**/schedule.service.spec.ts" \
  --browsers=ChromeHeadless --watch=false --no-progress
```

Expected: All 27 specs pass.

---

### Task 5: Full verification and commit

- [ ] **Step 1: Run `just verify` from the repo root of the worktree**

```bash
just verify
```

Expected: Quality + build + tests + e2e all green.

- [ ] **Step 2: Commit**

```bash
git add plnd_client/src/app/core/services/schedule.service.ts
git commit -m "$(cat <<'EOF'
refactor(schedule): guard ad-hoc PATCH subscriptions with takeUntilDestroyed

Both skipMeal and toggleItem were bare .subscribe() calls on PATCH
observables. Injecting DestroyRef and piping through takeUntilDestroyed
makes cleanup automatic if the service is ever scoped below root.

Closes #788
EOF
)"
```

- [ ] **Step 3: Open a PR**

Use the `commit-commands:commit-push-pr` skill or:

```bash
git fetch origin && git rebase origin/main
git push -u origin fix/schedule-takeuntildestroyed
gh pr create \
  --title "refactor(schedule): guard ad-hoc PATCH subscriptions with takeUntilDestroyed" \
  --body "$(cat <<'EOF'
## Summary

- Injects `DestroyRef` as a class field in `ScheduleService`
- Pipes both `skipMeal` and `toggleItem` PATCH observables through `takeUntilDestroyed(this.destroyRef)`
- No behavior change today (service is `providedIn: 'root'`); prevents subscription leaks if the service is ever route- or feature-scoped

## Test plan

- [ ] `just verify` passes (all unit + e2e green)
- [ ] Manually toggle a schedule item and skip a meal in the dev UI — confirm optimistic updates and error rollback still work

Closes #788
EOF
)"
```

---

## Verification Summary

| Check | Command | Expected |
|-------|---------|----------|
| Unit tests | `cd plnd_client && npx ng test --include="**/schedule.service.spec.ts" --browsers=ChromeHeadless --watch=false --no-progress` | 27 specs pass |
| Full pipeline | `just verify` | All green |
| Manual smoke | Toggle item + skip meal in dev UI | Optimistic update, error rollback |
