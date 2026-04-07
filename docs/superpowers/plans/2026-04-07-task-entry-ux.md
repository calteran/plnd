# Task Entry UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static "…" loading indicator and stuck confirmation state with a shimmer+spinner loading treatment, a bottom-of-screen toast, and smart form reset/close behavior with an "Adding more" toggle.

**Architecture:** Three touch points — `_tokens.scss` gains toast color tokens; `add-entry` gets a `confirmed` output, `addingMore` signal, and visual loading overhaul; `day-view` hosts the toast and wires the new output.

**Tech Stack:** Angular 18 standalone components, SCSS with CSS custom properties, Jasmine/Karma unit tests (`just test-ng-headless`).

---

## File Map

| File | Change |
|------|--------|
| `plnd_client/src/styles/_tokens.scss` | Add `--color-toast-bg` / `--color-toast-text` tokens (light + dark) |
| `plnd_client/src/app/features/schedule/components/add-entry/add-entry.ts` | Add `confirmed` output, `addingMore` signal; update `open/close/submit`; revamp template |
| `plnd_client/src/app/features/schedule/components/add-entry/add-entry.scss` | Remove `.loading`/`.agent-confirmation`; add `.input-wrapper`, `.input-spinner`, `.entry-input.loading`, `.toggle-adding-more` |
| `plnd_client/src/app/features/schedule/components/add-entry/add-entry.spec.ts` | Update 2 broken tests; add 5 new tests |
| `plnd_client/src/app/features/day-view/day-view.ts` | Add `toastMessage` signal, `onTaskConfirmed`, wire `(confirmed)` output |
| `plnd_client/src/app/features/day-view/day-view.scss` | Add `.toast` + `@keyframes toast-in` |
| `plnd_client/src/app/features/day-view/day-view.spec.ts` | Add 3 toast tests |

---

## Task 1: Add toast color tokens

**Files:**
- Modify: `plnd_client/src/styles/_tokens.scss`

- [ ] **Step 1: Add tokens to light and dark themes**

In `_tokens.scss`, add the following lines.

Inside `:root { ... }` after `--color-tooltip-bg`:
```scss
  --color-toast-bg:   #2d4f2d;
  --color-toast-text: #ffffff;
```

Inside `[data-theme="dark"] { ... }` after `--color-tooltip-bg`:
```scss
  --color-toast-bg:   #22c55e;
  --color-toast-text: #1e1e2e;
```

- [ ] **Step 2: Verify build compiles**

```bash
just verify-build
```
Expected: clean compile, no errors.

- [ ] **Step 3: Commit**

```bash
git add plnd_client/src/styles/_tokens.scss
git commit -m "feat(tokens): add toast color tokens for light and dark mode"
```

---

## Task 2: Update add-entry tests to reflect new behavior

The existing test suite has two tests that will break once the implementation changes:
- `shows loading state while the request is in flight` — checks for `.loading` div (being removed)
- `shows confirmation and clears loading after successful response with no signals` — checks for `.agent-confirmation` (being removed)

Update these and add new tests for the new behavior **before** touching the implementation so the TDD cycle is correct.

**Files:**
- Modify: `plnd_client/src/app/features/schedule/components/add-entry/add-entry.spec.ts`

- [ ] **Step 1: Update the loading-state test**

Find the test `'shows loading state while the request is in flight'` (around line 87) and replace its body:

```typescript
it('shows loading state while the request is in flight', async () => {
  const subject = new Subject<TaskEntryResponse>();
  const f = await setup();
  agentSpy.createTask.and.returnValue(subject.asObservable());
  openPanel(f);
  typeText(f, 'buy groceries');
  clickSubmit(f);

  expect(f.componentInstance.isLoading()).toBeTrue();
  // Spinner is rendered inside the input wrapper
  expect(f.debugElement.query(By.css('.input-spinner'))).toBeTruthy();
  // Input has .loading class (drives shimmer animation)
  expect(f.debugElement.query(By.css('.entry-input.loading'))).toBeTruthy();
  // No standalone loading div
  expect(f.debugElement.query(By.css('.loading:not(.entry-input)'))).toBeNull();
});
```

- [ ] **Step 2: Update the confirmation test**

Find the test `'shows confirmation and clears loading after successful response with no signals'` (around line 99) and replace its body:

```typescript
it('emits confirmed and clears loading after successful response with no signals', async () => {
  const f = await setup();
  agentSpy.createTask.and.returnValue(
    of(makeResponse({ confirmation: 'Task added!', ui_signals: [] })),
  );
  openPanel(f);
  typeText(f, 'buy groceries');

  let confirmedMsg: string | undefined;
  f.componentInstance.confirmed.subscribe((msg: string) => (confirmedMsg = msg));
  clickSubmit(f);

  expect(confirmedMsg).toBe('Task added!');
  expect(f.componentInstance.isLoading()).toBeFalse();
  // No inline confirmation text
  expect(f.debugElement.query(By.css('.agent-confirmation'))).toBeNull();
});
```

- [ ] **Step 3: Add test — addingMore defaults to false**

Append inside the `describe('AddEntryComponent', ...)` block:

```typescript
it('addingMore defaults to false when the form opens', async () => {
  const f = await setup();
  openPanel(f);
  const checkbox = f.debugElement.query(By.css('.toggle-adding-more input[type="checkbox"]'));
  expect(checkbox).toBeTruthy();
  expect((checkbox.nativeElement as HTMLInputElement).checked).toBeFalse();
});
```

- [ ] **Step 4: Add test — form closes after success when addingMore is false**

```typescript
it('closes the form after success when addingMore is false', async () => {
  const f = await setup();
  agentSpy.createTask.and.returnValue(
    of(makeResponse({ confirmation: 'Done!', ui_signals: [] })),
  );
  openPanel(f);
  typeText(f, 'buy groceries');
  // addingMore is false by default
  clickSubmit(f);

  expect(f.componentInstance.isOpen()).toBeFalse();
  expect(f.debugElement.query(By.css('.entry-panel'))).toBeNull();
});
```

- [ ] **Step 5: Add test — form resets in place when addingMore is true**

```typescript
it('clears input and stays open after success when addingMore is true', async () => {
  const f = await setup();
  agentSpy.createTask.and.returnValue(
    of(makeResponse({ confirmation: 'Done!', ui_signals: [] })),
  );
  openPanel(f);
  typeText(f, 'buy groceries');

  // Check the "Adding more" checkbox
  const checkbox = f.debugElement
    .query(By.css('.toggle-adding-more input[type="checkbox"]'))
    .nativeElement as HTMLInputElement;
  checkbox.checked = true;
  checkbox.dispatchEvent(new Event('change'));
  f.detectChanges();

  clickSubmit(f);

  expect(f.componentInstance.isOpen()).toBeTrue();
  expect(f.componentInstance['_text']()).toBe('');
});
```

- [ ] **Step 6: Add test — addingMore resets to false when form closes and reopens**

```typescript
it('resets addingMore to false when the form is closed and reopened', async () => {
  const f = await setup();
  openPanel(f);

  // Set addingMore to true
  const checkbox = f.debugElement
    .query(By.css('.toggle-adding-more input[type="checkbox"]'))
    .nativeElement as HTMLInputElement;
  checkbox.checked = true;
  checkbox.dispatchEvent(new Event('change'));
  f.detectChanges();
  expect(f.componentInstance['addingMore']()).toBeTrue();

  // Close and reopen
  f.debugElement.query(By.css('.btn-cancel')).nativeElement.click();
  f.detectChanges();
  f.debugElement.query(By.css('.add-row')).nativeElement.click();
  f.detectChanges();

  const reopenedCheckbox = f.debugElement
    .query(By.css('.toggle-adding-more input[type="checkbox"]'))
    .nativeElement as HTMLInputElement;
  expect(reopenedCheckbox.checked).toBeFalse();
});
```

- [ ] **Step 7: Run tests — confirm new tests fail and existing pass**

```bash
just test-ng-headless
```
Expected: the 5 new tests FAIL (component not yet updated), all other existing tests PASS.

---

## Task 3: Implement add-entry component changes

**Files:**
- Modify: `plnd_client/src/app/features/schedule/components/add-entry/add-entry.ts`
- Modify: `plnd_client/src/app/features/schedule/components/add-entry/add-entry.scss`

- [ ] **Step 1: Add `confirmed` output and `addingMore` signal; remove dead `confirmation` signal**

In `add-entry.ts`, update the signal/output declarations (lines 109–117) to:

```typescript
readonly added              = output<AddedEntry>();
readonly confirmed          = output<string>();
readonly isOpen             = signal(false);
protected readonly _text    = signal('');
readonly isLoading                      = signal(false);
protected readonly addingMore           = signal(false);
protected readonly pendingSignals       = signal<UiSignal[]>([]);
protected readonly signalAnswers        = signal<Record<string, unknown>>({});
protected readonly conversationHistory  = signal<ConversationTurn[]>([]);
protected readonly errorMessage         = signal<string | null>(null);
```

> The `confirmation` signal is removed — it was only used to drive the inline `agent-confirmation` paragraph, which is replaced by the toast.

- [ ] **Step 2: Reset `addingMore` in `open()` and `close()`**

Update `open()`:
```typescript
open(): void {
  this.isOpen.set(true);
  this.addingMore.set(false);
  setTimeout(() => this.entryInput?.nativeElement.focus(), 0);
}
```

Update `close()`:
```typescript
close(): void {
  this.isOpen.set(false);
  this._text.set('');
  this.isLoading.set(false);
  this.addingMore.set(false);
  this.pendingSignals.set([]);
  this.signalAnswers.set({});
  this.conversationHistory.set([]);
  this.errorMessage.set(null);
  this._conversationInput = '';
}
```

- [ ] **Step 3: Update `submit()` success path**

Replace the `next` callback inside `submit()` (lines 178–188):

```typescript
next: res => {
  this.isLoading.set(false);
  if (res.ui_signals.length > 0) {
    this.pendingSignals.set(res.ui_signals);
  } else {
    const action = res.actions_taken[0];
    this.added.emit({ label: input, type: toItemType(action?.type), id: action?.task_id });
    this.confirmed.emit(res.confirmation);
    this.conversationHistory.set([]);
    this.pendingSignals.set([]);
    if (this.addingMore()) {
      this._text.set('');
      this._conversationInput = '';
      setTimeout(() => this.entryInput?.nativeElement.focus(), 0);
    } else {
      this.close();
    }
  }
},
```

- [ ] **Step 4: Update the template**

Replace the entire `template` string with:

```typescript
template: `
  @if (!isOpen()) {
    <div class="add-row" (click)="open()" role="button" tabindex="0"
         (keydown.enter)="open()" (keydown.space)="open()" aria-label="Open entry form">
      <div class="gutter"></div>
      <div class="add-checkbox" aria-hidden="true">+</div>
      <span class="add-label">Add something…</span>
    </div>
  } @else {
    <div class="entry-panel">
      <div class="input-wrapper">
        <input
          #entryInput
          class="entry-input"
          [class.loading]="isLoading()"
          [value]="_text()"
          (input)="_text.set($any($event.target).value)"
          placeholder="e.g. vitamins with breakfast, walk after lunch, dentist 2pm…"
          (keydown.escape)="close()"
          (keydown.enter)="submit()"
          [attr.readonly]="isLoading() ? '' : null"
          aria-label="Add something to your day"
        />
        @if (isLoading()) {
          <div class="input-spinner" aria-hidden="true"></div>
        }
      </div>

      @if (pendingSignals().length > 0) {
        <div class="signal-form">
          @for (sig of pendingSignals(); track sig.field) {
            @switch (sig.type) {
              @case ('show_checkbox') {
                <label class="signal-label">
                  <input
                    type="checkbox"
                    [checked]="signalAnswers()[sig.field] ?? sig.default ?? false"
                    (change)="setAnswer(sig.field, $any($event.target).checked)"
                  />
                  {{ sig.label ?? sig.field }}
                </label>
              }
              @case ('show_select') {
                <label class="signal-label">
                  {{ sig.label ?? sig.field }}
                  <select
                    [value]="signalAnswers()[sig.field] ?? sig.default ?? ''"
                    (change)="setAnswer(sig.field, $any($event.target).value)"
                  >
                    @for (opt of sig.options ?? []; track opt) {
                      <option [value]="opt">{{ opt }}</option>
                    }
                  </select>
                </label>
              }
            }
          }
        </div>
      }

      @if (errorMessage()) {
        <p class="agent-error">{{ errorMessage() }}</p>
      }

      <div class="entry-actions">
        <label class="toggle-adding-more">
          <input
            type="checkbox"
            [checked]="addingMore()"
            (change)="addingMore.set($any($event.target).checked)"
          />
          Adding more
        </label>
        <button class="btn-cancel" type="button" (click)="close()">Cancel</button>
        @if (pendingSignals().length > 0) {
          <button class="btn-continue" type="button" (click)="continueWithAnswers()">Continue</button>
        } @else {
          <button class="btn-add" type="button" (click)="submit()" [disabled]="!_text().trim() || isLoading()">Add</button>
        }
      </div>
    </div>
  }
`,
```

- [ ] **Step 5: Update the SCSS**

Replace the entire contents of `add-entry.scss` with:

```scss
.add-row {
  display: flex;
  align-items: center;
  padding: 10px 24px;
  background: var(--color-surface-white);
  cursor: pointer;
  opacity: 0.5;

  &:hover { opacity: 0.8; }
}

.gutter {
  width: 40px;
  flex-shrink: 0;
  margin-right: 12px;
}

.add-checkbox {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  border-radius: 4px;
  border: 2px dashed var(--color-border-row);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-muted);
  font-size: 12px;
  margin-right: 10px;
}

.add-label {
  font-size: 12px;
  color: var(--color-text-muted);
}

.entry-panel {
  padding: 12px 24px 16px;
  background: var(--color-surface-white);
  border-top: 1px solid var(--color-border-row);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

// ── Input with loading treatment ──────────────────────────────────────

.input-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

.entry-input {
  width: 100%;
  padding: 10px 14px;
  border: 1.5px solid var(--color-border-meal);
  border-radius: 8px;
  font-size: 13px;
  font-family: inherit;
  background: var(--color-surface-warm);
  color: var(--color-text-body);
  outline: none;
  box-sizing: border-box;

  &:focus { border-color: var(--color-accent); }

  &.loading {
    padding-right: 36px; // leave room for spinner
    color: var(--color-text-muted);
    background: linear-gradient(
      105deg,
      var(--color-surface-warm) 20%,
      var(--color-border-row)   50%,
      var(--color-surface-warm) 80%
    );
    background-size: 300% 100%;
    animation: entry-input-shimmer 2.4s linear infinite;
    cursor: not-allowed;
  }
}

@keyframes entry-input-shimmer {
  0%   { background-position: 100% 0; }
  100% { background-position: -100% 0; }
}

.input-spinner {
  position: absolute;
  right: 11px;
  width: 14px;
  height: 14px;
  border: 2px solid var(--color-border-row);
  border-top-color: var(--color-accent);
  border-radius: 50%;
  animation: input-spin 0.75s linear infinite;
  flex-shrink: 0;
  pointer-events: none;
}

@keyframes input-spin {
  to { transform: rotate(360deg); }
}

// ── Signal clarification form ─────────────────────────────────────────

.signal-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
  animation: fadeIn 150ms ease-out;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(-4px); }
  to   { opacity: 1; transform: translateY(0); }
}

.signal-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--color-text-body);
}

// ── Error ─────────────────────────────────────────────────────────────

.agent-error {
  font-size: 12px;
  color: var(--color-destructive);
  margin: 0;
}

// ── Action row ────────────────────────────────────────────────────────

.entry-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.toggle-adding-more {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--color-text-muted);
  cursor: pointer;
  margin-right: auto; // push cancel/add to the right

  input[type="checkbox"] {
    accent-color: var(--color-accent);
    cursor: pointer;
  }
}

.btn-cancel {
  background: none;
  border: 1px solid var(--color-border-row);
  border-radius: 6px;
  padding: 6px 14px;
  font-size: 12px;
  color: var(--color-text-muted);
  cursor: pointer;
}

.btn-continue {
  background: var(--color-surface-warm);
  border: 1.5px solid var(--color-accent-border);
  border-radius: 6px;
  padding: 6px 16px;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-accent-dark);
  cursor: pointer;
}

.btn-add {
  background: var(--color-accent-light);
  border: 1.5px solid var(--color-accent-border);
  border-radius: 6px;
  padding: 6px 16px;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-accent-dark);
  cursor: pointer;

  &:disabled { opacity: 0.4; cursor: not-allowed; }
}
```

- [ ] **Step 6: Run all add-entry tests**

```bash
just test-ng-headless
```
Expected: all tests in `add-entry.spec.ts` PASS.

- [ ] **Step 7: Commit**

```bash
git add plnd_client/src/app/features/schedule/components/add-entry/
git commit -m "feat(add-entry): shimmer+spinner loading, addingMore toggle, confirmed output"
```

---

## Task 4: Add day-view toast tests

**Files:**
- Modify: `plnd_client/src/app/features/day-view/day-view.spec.ts`

- [ ] **Step 1: Add toast test describe block**

Add the following at the end of `day-view.spec.ts`, after the existing `describe` blocks. This requires `fakeAsync` and `tick` from `@angular/core/testing` — add them to the existing import if not present.

Update the import at the top:
```typescript
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
```

Then add the new block at the end of the file:

```typescript
describe('DayViewComponent (toast)', () => {
  async function setupToast() {
    const svc = makeScheduleServiceMock();
    await TestBed.configureTestingModule({
      imports: [DayViewComponent, RouterTestingModule],
      providers: [
        { provide: ScheduleService,  useValue: svc },
        { provide: BriefingService,  useValue: makeBriefingServiceMock() },
        { provide: ActivatedRoute,   useValue: mockActivatedRoute },
      ],
    }).compileComponents();
    const f = TestBed.createComponent(DayViewComponent);
    f.detectChanges();
    return f;
  }

  it('shows a toast when onTaskConfirmed is called', async () => {
    const f = await setupToast();
    f.componentInstance.onTaskConfirmed('Walk added for after lunch');
    f.detectChanges();
    const toast = f.debugElement.query(By.css('.toast'));
    expect(toast).toBeTruthy();
    expect(toast.nativeElement.textContent).toContain('Walk added for after lunch');
  });

  it('hides the toast after 2500ms', fakeAsync(async () => {
    const f = await setupToast();
    f.componentInstance.onTaskConfirmed('Walk added');
    f.detectChanges();
    expect(f.debugElement.query(By.css('.toast'))).toBeTruthy();

    tick(2500);
    f.detectChanges();
    expect(f.debugElement.query(By.css('.toast'))).toBeNull();
  }));

  it('replaces an in-flight toast when a second confirmation arrives', fakeAsync(async () => {
    const f = await setupToast();
    f.componentInstance.onTaskConfirmed('First task added');
    f.detectChanges();

    tick(1000); // 1s into first toast's lifetime
    f.componentInstance.onTaskConfirmed('Second task added');
    f.detectChanges();

    const toast = f.debugElement.query(By.css('.toast'));
    expect(toast.nativeElement.textContent).toContain('Second task added');

    tick(2500); // second toast's full lifetime expires
    f.detectChanges();
    expect(f.debugElement.query(By.css('.toast'))).toBeNull();
  }));
});
```

- [ ] **Step 2: Run tests — confirm new tests fail**

```bash
just test-ng-headless
```
Expected: 3 new toast tests FAIL, all others PASS.

---

## Task 5: Implement toast in day-view

**Files:**
- Modify: `plnd_client/src/app/features/day-view/day-view.ts`
- Modify: `plnd_client/src/app/features/day-view/day-view.scss`

- [ ] **Step 1: Add toast state and handler to DayViewComponent**

In `day-view.ts`, update the class body. Add `OnDestroy` to the import from `@angular/core`:

```typescript
import { Component, DestroyRef, OnDestroy, OnInit, computed, inject } from '@angular/core';
```

Add the toast signal and timer field to the class (after `readonly isToday = computed(...)`):

```typescript
protected readonly toastMessage = signal<string | null>(null);
private toastTimer?: ReturnType<typeof setTimeout>;
```

Add the `implements OnDestroy` to the class declaration:

```typescript
export class DayViewComponent implements OnInit, OnDestroy {
```

Add `ngOnDestroy` and `onTaskConfirmed` methods at the end of the class:

```typescript
ngOnDestroy(): void {
  if (this.toastTimer) clearTimeout(this.toastTimer);
}

onTaskConfirmed(message: string): void {
  if (this.toastTimer) clearTimeout(this.toastTimer);
  this.toastMessage.set(message);
  this.toastTimer = setTimeout(() => this.toastMessage.set(null), 2500);
}
```

- [ ] **Step 2: Wire the `(confirmed)` output and add toast to the template**

In the template, update the `<app-add-entry>` line:

```html
<app-add-entry (added)="onItemAdded($event)" (confirmed)="onTaskConfirmed($event)" />
```

Add the toast at the very end of `.schedule-view`, just before the closing `</div>`:

```html
@if (toastMessage()) {
  <div class="toast" role="status" aria-live="polite">{{ toastMessage() }}</div>
}
```

- [ ] **Step 3: Add toast styles**

In `day-view.scss`, append:

```scss
// ── Toast notification ────────────────────────────────────────────────

.toast {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--color-toast-bg);
  color: var(--color-toast-text);
  border-radius: 10px;
  padding: 11px 20px;
  font-size: 13px;
  font-weight: 500;
  box-shadow: var(--shadow-dropdown);
  white-space: nowrap;
  z-index: 100;
  pointer-events: none;
  animation: toast-in 0.2s ease-out;
}

@keyframes toast-in {
  from { opacity: 0; transform: translateX(-50%) translateY(8px); }
  to   { opacity: 1; transform: translateX(-50%) translateY(0); }
}
```

- [ ] **Step 4: Run all tests**

```bash
just test-ng-headless
```
Expected: all tests PASS including the 3 new toast tests.

- [ ] **Step 5: Commit**

```bash
git add plnd_client/src/app/features/day-view/
git commit -m "feat(day-view): bottom toast notification for task confirmation"
```

---

## Task 6: Final verification

- [ ] **Step 1: Run full quality suite**

```bash
just verify
```
Expected: all checks pass cleanly (fmt, clippy, deny, machete, ts-lint, ts-deps, build, tests).

- [ ] **Step 2: Manual smoke test**

Start the dev stack (`just dev`) and verify:

1. Open day view → click "Add something…" → type a task → press Enter
   - Input shimmers with a slow single-direction sweep
   - Green spinner appears right-aligned inside the input
   - Add button is disabled
2. On agent success:
   - Toast slides up from the bottom of the screen
   - Toast shows the confirmation text
   - Form closes (panel collapses back to "Add something…")
   - Toast disappears after ~2.5s
3. Reopen form → check "Adding more" → add a task
   - After success: input clears, focus returns to input, form stays open
   - Toast still appears
4. Add two tasks back-to-back with "Adding more" checked — works on each submit
5. Uncheck "Adding more" on the last task — form closes after submit
6. Submit with no network (DevTools → Offline) — error message appears inline, no toast
7. Toggle dark mode (DevTools or `data-theme="dark"` on `<body>`) — shimmer, spinner, and toast all render correctly using token colors

- [ ] **Step 3: Final commit (if any leftover changes)**

```bash
git status
# If clean, nothing to do. If there are any final tweaks:
git add -p
git commit -m "fix(task-entry-ux): polish from manual smoke test"
```
