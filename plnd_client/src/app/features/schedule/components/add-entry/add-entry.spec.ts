import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Subject, of, throwError } from 'rxjs';
import { AddEntryComponent } from './add-entry';
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

describe('AddEntryComponent', () => {
  let agentSpy: jasmine.SpyObj<AgentService>;

  async function setup() {
    agentSpy = jasmine.createSpyObj<AgentService>('AgentService', ['createTask']);
    agentSpy.createTask.and.returnValue(of(makeResponse({ confirmation: 'Task added!' })));

    await TestBed.configureTestingModule({
      imports: [AddEntryComponent],
      providers: [{ provide: AgentService, useValue: agentSpy }],
    }).compileComponents();

    const f = TestBed.createComponent(AddEntryComponent);
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
    expect(agentSpy.createTask).toHaveBeenCalledOnceWith({ input: 'buy groceries', context: [] });
  });

  it('shows loading state while the request is in flight', async () => {
    const subject = new Subject<TaskEntryResponse>();
    const f = await setup();
    agentSpy.createTask.and.returnValue(subject.asObservable());
    openPanel(f);
    typeText(f, 'buy groceries');
    clickSubmit(f);

    expect(f.componentInstance.isLoading()).toBeTrue();
    expect(f.debugElement.query(By.css('.loading'))).toBeTruthy();
  });

  it('shows confirmation and clears loading after successful response with no signals', async () => {
    const f = await setup();
    agentSpy.createTask.and.returnValue(
      of(makeResponse({ confirmation: 'Task added!', ui_signals: [] })),
    );
    openPanel(f);
    typeText(f, 'buy groceries');
    clickSubmit(f);

    expect(f.debugElement.query(By.css('.agent-confirmation'))).toBeTruthy();
    expect(f.nativeElement.textContent).toContain('Task added!');
    expect(f.componentInstance.isLoading()).toBeFalse();
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

  it('re-calls createTask with accumulated context when Continue is clicked', async () => {
    const firstSignals = [{ type: 'show_checkbox' as const, field: 'urgent', label: 'Urgent?' }];
    const f = await setup();
    agentSpy.createTask.and.returnValues(
      of(makeResponse({ ui_signals: firstSignals })),
      of(makeResponse({ confirmation: 'Done!', ui_signals: [] })),
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
});
