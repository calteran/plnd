import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Subject, of, throwError } from 'rxjs';
import { AddEntryComponent, AddedEntry } from './add-entry';
import { AgentService } from '../../../../core/services/agent.service';
import { TaskEntryResponse } from '../../../../core/models/agent';

function makeResponse(overrides: Partial<TaskEntryResponse> = {}): TaskEntryResponse {
  return {
    actions_taken: [],
    ui_signals: [],
    confirmation: '',
    ...overrides,
  };
}

/** Convenience helper for the happy-path: task created, no pending signals. */
function makeSuccessResponse(confirmation = 'Task added!'): TaskEntryResponse {
  return makeResponse({ actions_taken: [{ type: 'task_created', task_id: 'test-task-id' }], confirmation });
}

describe('AddEntryComponent', () => {
  let agentSpy: jasmine.SpyObj<AgentService>;

  async function setup(date = '2026-01-15') {
    agentSpy = jasmine.createSpyObj<AgentService>('AgentService', ['createTask']);
    agentSpy.createTask.and.returnValue(of(makeSuccessResponse()));

    await TestBed.configureTestingModule({
      imports: [AddEntryComponent],
      providers: [{ provide: AgentService, useValue: agentSpy }],
    }).compileComponents();

    const f = TestBed.createComponent(AddEntryComponent);
    f.componentRef.setInput('date', date);
    f.detectChanges();
    return f;
  }

  function openPanel(f: ReturnType<typeof TestBed.createComponent<AddEntryComponent>>) {
    f.debugElement.query(By.css('.add-row')).nativeElement.click();
    f.detectChanges();
  }

  function typeText(
    f: ReturnType<typeof TestBed.createComponent<AddEntryComponent>>,
    text: string,
  ) {
    const input = f.debugElement.query(By.css('.entry-input')).nativeElement as HTMLInputElement;
    input.value = text;
    input.dispatchEvent(new Event('input'));
    f.detectChanges();
  }

  function clickSubmit(f: ReturnType<typeof TestBed.createComponent<AddEntryComponent>>) {
    f.debugElement.query(By.css('.btn-add')).nativeElement.click();
    f.detectChanges();
  }

  // ── Structural / navigation ────────────────────────────────────────────────

  it('shows the add row when closed', async () => {
    const f = await setup();
    expect(f.nativeElement.textContent).toContain('Add something');
    expect(f.debugElement.query(By.css('.entry-panel'))).toBeNull();
  });

  it('opens the entry panel when add row is clicked', async () => {
    const f = await setup();
    openPanel(f);
    expect(f.debugElement.query(By.css('.entry-panel'))).toBeTruthy();
  });

  it('closes the panel on Escape', async () => {
    const f = await setup();
    openPanel(f);
    const input = f.debugElement.query(By.css('.entry-input')).nativeElement;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    f.detectChanges();
    expect(f.debugElement.query(By.css('.entry-panel'))).toBeNull();
  });

  // ── Agent integration ──────────────────────────────────────────────────────

  it('calls AgentService.createTask with the input text on submit', async () => {
    const f = await setup();
    openPanel(f);
    typeText(f, 'buy groceries');
    clickSubmit(f);
    expect(agentSpy.createTask).toHaveBeenCalledOnceWith({ input: 'buy groceries', date: '2026-01-15', context: [] });
  });

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

  it('emits confirmed and clears loading after successful response with no signals', async () => {
    const f = await setup();
    agentSpy.createTask.and.returnValue(of(makeSuccessResponse('Task added!')));
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

  it('renders a checkbox for a show_checkbox ui_signal', async () => {
    const f = await setup();
    agentSpy.createTask.and.returnValue(
      of(makeResponse({
        ui_signals: [{ type: 'show_checkbox', field: 'urgent', label: 'Is this urgent?' }],
      })),
    );
    openPanel(f);
    typeText(f, 'something');
    clickSubmit(f);

    const checkbox = f.debugElement.query(By.css('input[type="checkbox"]'));
    expect(checkbox).toBeTruthy();
    expect(f.nativeElement.textContent).toContain('Is this urgent?');
  });

  it('renders a select for a show_select ui_signal', async () => {
    const f = await setup();
    agentSpy.createTask.and.returnValue(
      of(makeResponse({
        ui_signals: [{ type: 'show_select', field: 'category', label: 'Category', options: ['work', 'home'] }],
      })),
    );
    openPanel(f);
    typeText(f, 'do a thing');
    clickSubmit(f);

    const select = f.debugElement.query(By.css('select'));
    expect(select).toBeTruthy();
    const options = f.debugElement.queryAll(By.css('option'));
    expect(options.length).toBe(2);
    expect(options[0].nativeElement.value).toBe('work');
    expect(options[1].nativeElement.value).toBe('home');
  });

  it('does not call createTask a second time while a request is already in flight', async () => {
    const subject = new Subject<TaskEntryResponse>();
    const f = await setup();
    agentSpy.createTask.and.returnValue(subject.asObservable());
    openPanel(f);
    typeText(f, 'buy groceries');
    clickSubmit(f);
    clickSubmit(f); // second click while in flight — should be ignored
    expect(agentSpy.createTask).toHaveBeenCalledTimes(1);
  });

  it('merges sig.default into answers for fields the user did not interact with', async () => {
    const checkboxSignal = { type: 'show_checkbox' as const, field: 'urgent', label: 'Urgent?', default: true };
    const f = await setup();
    agentSpy.createTask.and.returnValues(
      of(makeResponse({ ui_signals: [checkboxSignal] })),
      of(makeSuccessResponse('Done!')),
    );
    openPanel(f);
    typeText(f, 'buy groceries');
    clickSubmit(f);

    // Click Continue without touching the checkbox (user accepts the default)
    const continueBtn = f.debugElement.query(By.css('.btn-continue'));
    continueBtn.nativeElement.click();
    f.detectChanges();

    const secondCall = agentSpy.createTask.calls.mostRecent().args[0];
    expect(secondCall.context?.[0].answers['urgent']).toBe(true);
  });

  it('discards conversation context when input text changes between turns', async () => {
    const checkboxSignal = { type: 'show_checkbox' as const, field: 'urgent', label: 'Urgent?' };
    const f = await setup();
    agentSpy.createTask.and.returnValues(
      of(makeResponse({ ui_signals: [checkboxSignal] })),
      of(makeResponse({ confirmation: 'Done!', ui_signals: [] })),
    );
    openPanel(f);
    typeText(f, 'buy groceries');
    clickSubmit(f); // first turn — gets signals back

    // Change input while signals are pending (Add button is hidden; submit via Enter binding)
    typeText(f, 'something different');
    const input = f.debugElement.query(By.css('.entry-input')).nativeElement;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    f.detectChanges();

    const secondCall = agentSpy.createTask.calls.mostRecent().args[0];
    expect(secondCall.context).toEqual([]);
  });

  it('re-calls createTask with accumulated context when Continue is clicked', async () => {
    const firstSignals = [{ type: 'show_checkbox' as const, field: 'urgent', label: 'Urgent?' }];
    const f = await setup();
    agentSpy.createTask.and.returnValues(
      of(makeResponse({ ui_signals: firstSignals })),
      of(makeSuccessResponse('Done!')),
    );
    openPanel(f);
    typeText(f, 'buy groceries');
    clickSubmit(f);

    const continueBtn = f.debugElement.query(By.css('.btn-continue'));
    expect(continueBtn).toBeTruthy();
    continueBtn.nativeElement.click();
    f.detectChanges();

    expect(agentSpy.createTask).toHaveBeenCalledTimes(2);
    const secondCall = agentSpy.createTask.calls.mostRecent().args[0];
    expect(secondCall.context?.length).toBe(1);
    expect(secondCall.context?.[0].signals).toEqual(firstSignals);
  });

  it('shows an error message when the agent call fails', async () => {
    const f = await setup();
    agentSpy.createTask.and.returnValue(throwError(() => new Error('Network error')));
    openPanel(f);
    typeText(f, 'buy groceries');
    clickSubmit(f);

    expect(f.debugElement.query(By.css('.agent-error'))).toBeTruthy();
    expect(f.nativeElement.textContent).toContain('Something went wrong');
    expect(f.componentInstance.isLoading()).toBeFalse();
  });

  it('emits the type from actions_taken[0].type when the agent returns a known type', async () => {
    const f = await setup();
    agentSpy.createTask.and.returnValue(
      of(makeResponse({
        actions_taken: [{ type: 'exercise', task_id: 'abc' }],
        confirmation: 'Exercise scheduled!',
      })),
    );
    openPanel(f);
    typeText(f, 'morning run');

    let emitted: AddedEntry | undefined;
    f.componentInstance.added.subscribe((e: AddedEntry) => (emitted = e));
    clickSubmit(f);

    expect(emitted?.type).toBe('exercise');
  });

  it('emits "appointment" when actions_taken[0].type is "appointment"', async () => {
    const f = await setup();
    agentSpy.createTask.and.returnValue(
      of(makeResponse({
        actions_taken: [{ type: 'appointment', task_id: 'appt-1' }],
        confirmation: 'Appointment scheduled!',
      })),
    );
    openPanel(f);
    typeText(f, 'dentist 2pm');

    let emitted: AddedEntry | undefined;
    f.componentInstance.added.subscribe((e: AddedEntry) => (emitted = e));
    clickSubmit(f);

    expect(emitted?.type).toBe('appointment');
  });

  it('emits type "task" as fallback for an unrecognised action type', async () => {
    const f = await setup();
    agentSpy.createTask.and.returnValue(
      of(makeResponse({ actions_taken: [{ type: 'future_thing', task_id: 'id-1' }], confirmation: 'Done!' })),
    );
    openPanel(f);
    typeText(f, 'buy groceries');

    let emitted: AddedEntry | undefined;
    f.componentInstance.added.subscribe((e: AddedEntry) => (emitted = e));
    clickSubmit(f);

    expect(emitted?.type).toBe('general');
  });

  it('does not emit added when actions_taken is empty and ui_signals is empty', async () => {
    const f = await setup();
    agentSpy.createTask.and.returnValue(
      of(makeResponse({ actions_taken: [], confirmation: '', ui_signals: [] })),
    );
    openPanel(f);
    typeText(f, 'buy groceries');

    let emitted: AddedEntry | undefined;
    f.componentInstance.added.subscribe((e: AddedEntry) => (emitted = e));
    clickSubmit(f);

    expect(emitted).toBeUndefined();
    expect(f.componentInstance.isOpen()).toBeTrue(); // stays open
  });

  it('emits the task_id from actions_taken[0] as id', async () => {
    const f = await setup();
    agentSpy.createTask.and.returnValue(
      of(makeResponse({
        actions_taken: [{ type: 'task', task_id: 'server-id-123' }],
        confirmation: 'Task added!',
      })),
    );
    openPanel(f);
    typeText(f, 'buy groceries');

    let emitted: AddedEntry | undefined;
    f.componentInstance.added.subscribe((e: AddedEntry) => (emitted = e));
    clickSubmit(f);

    expect(emitted?.id).toBe('server-id-123');
  });

  // ── addingMore / smart close ───────────────────────────────────────────────

  it('addingMore defaults to false when the form opens', async () => {
    const f = await setup();
    openPanel(f);
    const checkbox = f.debugElement.query(By.css('.toggle-adding-more input[type="checkbox"]'));
    expect(checkbox).toBeTruthy();
    expect((checkbox.nativeElement as HTMLInputElement).checked).toBeFalse();
  });

  it('closes the form after success when addingMore is false', async () => {
    const f = await setup();
    agentSpy.createTask.and.returnValue(of(makeSuccessResponse('Done!')));
    openPanel(f);
    typeText(f, 'buy groceries');
    // addingMore is false by default
    clickSubmit(f);

    expect(f.componentInstance.isOpen()).toBeFalse();
    expect(f.debugElement.query(By.css('.entry-panel'))).toBeNull();
  });

  it('clears input and stays open after success when addingMore is true', async () => {
    const f = await setup();
    agentSpy.createTask.and.returnValue(of(makeSuccessResponse('Done!')));
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
});
