import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { of } from 'rxjs';
import { OnboardingHubComponent } from './onboarding-hub';
import { OnboardingStateService, SectionId } from '../onboarding-state.service';
import { UserService } from '../../../core/services/user.service';
import { ConfigService } from '../../../core/services/config.service';

function makeStateMock() {
  const statusSignal = signal<Record<SectionId, 'not-started' | 'complete'>>({
    account: 'not-started',
    tasks: 'not-started',
    food: 'not-started',
  });
  const allCompleteSignal = signal(false);
  const planPeriodSignal = signal<{ start: string; end: string } | null>(null);

  return {
    sectionStatus: statusSignal.asReadonly(),
    allSectionsComplete: allCompleteSignal.asReadonly(),
    markComplete: jasmine.createSpy('markComplete').and.callFake((s: SectionId) => {
      statusSignal.update(prev => ({ ...prev, [s]: 'complete' }));
      if (Object.values(statusSignal()).every(v => v === 'complete')) {
        allCompleteSignal.set(true);
      }
    }),
    totalRoutines: signal(0).asReadonly(),
    totalTasks: signal(0).asReadonly(),
    totalMeals: signal(0).asReadonly(),
    planDays: signal(0).asReadonly(),
    planPeriod: planPeriodSignal.asReadonly(),
    planPeriodSignal,
    mealPlan: signal(null).asReadonly(),
    placedTasks: signal([]).asReadonly(),
    mealHabits: signal([]).asReadonly(),
    scheduleTemplates: signal([]).asReadonly(),
  };
}

describe('OnboardingHubComponent', () => {
  let fixture: ComponentFixture<OnboardingHubComponent>;
  let stateMock: ReturnType<typeof makeStateMock>;
  let router: Router;
  let userServiceStub: { completeOnboarding: jasmine.Spy };

  beforeEach(async () => {
    stateMock = makeStateMock();
    userServiceStub = { completeOnboarding: jasmine.createSpy('completeOnboarding').and.returnValue(of(undefined)) };
    await TestBed.configureTestingModule({
      imports: [OnboardingHubComponent],
      providers: [
        { provide: OnboardingStateService, useValue: stateMock },
        { provide: UserService, useValue: userServiceStub },
        { provide: ConfigService, useValue: { getConfig: () => ({ api: { baseUrl: 'http://localhost:3000' } }) } },
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    }).compileComponents();

    router = TestBed.inject(Router);
    fixture = TestBed.createComponent(OnboardingHubComponent);
    fixture.detectChanges();
  });

  // ── Structural ──────────────────────────────────────────────────────────────

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('renders 4 section cards', () => {
    const cards = fixture.nativeElement.querySelectorAll('.section-card');
    expect(cards.length).toBe(4);
  });

  it('Exercise card (index 3) has disabled attribute', () => {
    const cards: NodeListOf<HTMLButtonElement> =
      fixture.nativeElement.querySelectorAll('.section-card');
    expect(cards[3].disabled).toBeTrue();
  });

  it('Exercise card has aria-disabled="true"', () => {
    const cards: NodeListOf<HTMLButtonElement> =
      fixture.nativeElement.querySelectorAll('.section-card');
    expect(cards[3].getAttribute('aria-disabled')).toBe('true');
  });

  it('active section cards (0–2) are not disabled', () => {
    const cards: NodeListOf<HTMLButtonElement> =
      fixture.nativeElement.querySelectorAll('.section-card');
    for (let i = 0; i < 3; i++) {
      expect(cards[i].disabled).toBeFalse();
    }
  });

  it('renders all 4 section titles', () => {
    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain('Account Settings');
    expect(text).toContain('Tasks & Routines');
    expect(text).toContain('Food & Meals');
    expect(text).toContain('Exercise');
  });

  // ── Hub subtitle ────────────────────────────────────────────────────────────

  it('hub subtitle prompts the user to build their first plan', () => {
    const subtitle: HTMLElement = fixture.nativeElement.querySelector('.hub-subtitle');
    expect(subtitle?.textContent).toContain("Let's build your first plan");
  });

  // ── Section descriptions ────────────────────────────────────────────────────

  it('Account section description is "Display name and notifications"', () => {
    const descs: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll('.card-desc');
    expect(descs[0].textContent?.trim()).toBe('Display name and notifications');
  });

  // ── Badge initial state ─────────────────────────────────────────────────────

  it('active section badges initially have badge--muted class', () => {
    const badges: NodeListOf<HTMLElement> =
      fixture.nativeElement.querySelectorAll('.card-badge');
    for (let i = 0; i < 3; i++) {
      expect(badges[i].classList).toContain('badge--muted');
      expect(badges[i].classList).not.toContain('badge--done');
    }
  });

  it('active section badges initially show "not started" text', () => {
    const badges: NodeListOf<HTMLElement> =
      fixture.nativeElement.querySelectorAll('.card-badge');
    for (let i = 0; i < 3; i++) {
      expect(badges[i].textContent?.trim().toLowerCase()).toContain('not started');
    }
  });

  it('Exercise badge shows "coming soon"', () => {
    const badges: NodeListOf<HTMLElement> =
      fixture.nativeElement.querySelectorAll('.card-badge');
    expect(badges[3].textContent?.trim().toLowerCase()).toContain('coming soon');
  });

  it('Exercise badge has badge--disabled class, not badge--muted', () => {
    const badges: NodeListOf<HTMLElement> =
      fixture.nativeElement.querySelectorAll('.card-badge');
    expect(badges[3].classList).toContain('badge--disabled');
    expect(badges[3].classList).not.toContain('badge--muted');
    expect(badges[3].classList).not.toContain('badge--done');
  });

  // ── Badge reactive updates ──────────────────────────────────────────────────

  it('account badge shows ✓ done after markComplete("account")', () => {
    stateMock.markComplete('account');
    fixture.detectChanges();
    const badges: NodeListOf<HTMLElement> =
      fixture.nativeElement.querySelectorAll('.card-badge');
    expect(badges[0].classList).toContain('badge--done');
    expect(badges[0].classList).not.toContain('badge--muted');
    expect(badges[0].textContent?.trim().toLowerCase()).toContain('done');
  });

  it('tasks badge shows ✓ done after markComplete("tasks")', () => {
    stateMock.markComplete('tasks');
    fixture.detectChanges();
    const badges: NodeListOf<HTMLElement> =
      fixture.nativeElement.querySelectorAll('.card-badge');
    expect(badges[1].classList).toContain('badge--done');
  });

  it('food badge shows ✓ done after markComplete("food")', () => {
    stateMock.markComplete('food');
    fixture.detectChanges();
    const badges: NodeListOf<HTMLElement> =
      fixture.nativeElement.querySelectorAll('.card-badge');
    expect(badges[2].classList).toContain('badge--done');
  });

  it('completing a section adds section-card--done class to that card', () => {
    stateMock.markComplete('account');
    fixture.detectChanges();
    const cards: NodeListOf<HTMLElement> =
      fixture.nativeElement.querySelectorAll('.section-card');
    expect(cards[0].classList).toContain('section-card--done');
    expect(cards[1].classList).not.toContain('section-card--done');
  });

  // ── Stats banner ────────────────────────────────────────────────────────────

  it('stats banner is hidden when no sections are complete', () => {
    const banner: HTMLElement = fixture.nativeElement.querySelector('.stats-banner');
    expect(banner).toBeNull();
  });

  it('stats banner appears when all 3 sections are complete', () => {
    (['account', 'tasks', 'food'] as SectionId[]).forEach(s => stateMock.markComplete(s));
    fixture.detectChanges();
    const banner: HTMLElement = fixture.nativeElement.querySelector('.stats-banner');
    expect(banner).toBeTruthy();
    expect(banner.querySelector('.stats-heading')?.textContent?.trim()).toBe('Everything looks good');
  });

  it('stats banner shows stat labels: Routines, Tasks, Meals, Days', () => {
    (['account', 'tasks', 'food'] as SectionId[]).forEach(s => stateMock.markComplete(s));
    fixture.detectChanges();
    const banner: HTMLElement = fixture.nativeElement.querySelector('.stats-banner');
    const labels: NodeListOf<HTMLElement> = banner.querySelectorAll('.stat-label');
    const texts = Array.from(labels).map((el: HTMLElement) => el.textContent?.trim());
    expect(texts).toEqual(['Routines', 'Tasks', 'Meals', 'Days']);
  });

  // ── CTA button state ────────────────────────────────────────────────────────

  it('CTA has btn--ghost style when 0 sections are complete', () => {
    const btn: HTMLButtonElement = fixture.nativeElement.querySelector('.btn-cta');
    expect(btn.classList).toContain('btn--ghost');
    expect(btn.classList).not.toContain('btn--accent');
  });

  it('CTA stays ghost when only 2 of 3 sections are complete', () => {
    stateMock.markComplete('account');
    stateMock.markComplete('tasks');
    fixture.detectChanges();
    const btn: HTMLButtonElement = fixture.nativeElement.querySelector('.btn-cta');
    expect(btn.classList).toContain('btn--ghost');
    expect(btn.classList).not.toContain('btn--accent');
  });

  it('CTA becomes btn--accent when all 3 sections are complete', () => {
    (['account', 'tasks', 'food'] as SectionId[]).forEach(s => stateMock.markComplete(s));
    fixture.detectChanges();
    const btn: HTMLButtonElement = fixture.nativeElement.querySelector('.btn-cta');
    expect(btn.classList).toContain('btn--accent');
    expect(btn.classList).not.toContain('btn--ghost');
  });

  // ── Skip button ──────────────────────────────────────────────────────────────

  it('skip button is visible when sections are incomplete', () => {
    const skip: HTMLButtonElement = fixture.nativeElement.querySelector('.btn-skip');
    expect(skip).toBeTruthy();
  });

  it('skip button is absent when all sections are complete', () => {
    (['account', 'tasks', 'food'] as SectionId[]).forEach(s => stateMock.markComplete(s));
    fixture.detectChanges();
    const skip: HTMLButtonElement = fixture.nativeElement.querySelector('.btn-skip');
    expect(skip).toBeNull();
  });

  // ── Skip modal ──────────────────────────────────────────────────────────────

  it('skip modal is not shown initially', () => {
    const modal: HTMLElement = fixture.nativeElement.querySelector('.modal-backdrop');
    expect(modal).toBeNull();
  });

  it('clicking Skip button opens the skip modal', () => {
    const skip: HTMLButtonElement = fixture.nativeElement.querySelector('.btn-skip');
    skip.click();
    fixture.detectChanges();
    const modal: HTMLElement = fixture.nativeElement.querySelector('.modal-backdrop');
    expect(modal).toBeTruthy();
  });

  it('"Keep going" button dismisses the skip modal', () => {
    // open via UI
    (fixture.nativeElement.querySelector('.btn-skip') as HTMLButtonElement).click();
    fixture.detectChanges();
    const keepGoing: HTMLButtonElement = fixture.nativeElement.querySelector('.btn-ghost-amber');
    keepGoing.click();
    fixture.detectChanges();
    const modal: HTMLElement = fixture.nativeElement.querySelector('.modal-backdrop');
    expect(modal).toBeNull();
  });

  it('"Skip for now" calls completeOnboarding() then navigates to /day/<today>', () => {
    spyOn(router, 'navigate');
    // open via UI
    (fixture.nativeElement.querySelector('.btn-skip') as HTMLButtonElement).click();
    fixture.detectChanges();
    const skipBtn: HTMLButtonElement = fixture.nativeElement.querySelector('.btn-gray-primary');
    skipBtn.click();
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    expect(userServiceStub.completeOnboarding).toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/day', today]);
  });

  it('Escape key closes the skip modal', () => {
    // open via UI, then test the keyboard handler directly
    (fixture.nativeElement.querySelector('.btn-skip') as HTMLButtonElement).click();
    fixture.detectChanges();
    fixture.componentInstance.onEscapeKey();
    fixture.detectChanges();
    const modal: HTMLElement = fixture.nativeElement.querySelector('.modal-backdrop');
    expect(modal).toBeNull();
  });

  it('skip modal has role="dialog" and aria-modal="true"', () => {
    // open via UI
    (fixture.nativeElement.querySelector('.btn-skip') as HTMLButtonElement).click();
    fixture.detectChanges();
    const card: HTMLElement = fixture.nativeElement.querySelector('.modal-card');
    expect(card?.getAttribute('role')).toBe('dialog');
    expect(card?.getAttribute('aria-modal')).toBe('true');
  });

  // ── Navigation ──────────────────────────────────────────────────────────────

  it('clicking Account card navigates to /onboarding/account', () => {
    spyOn(router, 'navigate');
    const cards: NodeListOf<HTMLButtonElement> =
      fixture.nativeElement.querySelectorAll('.section-card');
    cards[0].click();
    expect(router.navigate).toHaveBeenCalledWith(['/onboarding/account']);
  });

  it('clicking Tasks card navigates to /onboarding/tasks', () => {
    spyOn(router, 'navigate');
    const cards: NodeListOf<HTMLButtonElement> =
      fixture.nativeElement.querySelectorAll('.section-card');
    cards[1].click();
    expect(router.navigate).toHaveBeenCalledWith(['/onboarding/tasks']);
  });

  it('clicking Food card navigates to /onboarding/food', () => {
    spyOn(router, 'navigate');
    const cards: NodeListOf<HTMLButtonElement> =
      fixture.nativeElement.querySelectorAll('.section-card');
    cards[2].click();
    expect(router.navigate).toHaveBeenCalledWith(['/onboarding/food']);
  });

  it('navigate() guard: disabled section does not call router.navigate', () => {
    spyOn(router, 'navigate');
    fixture.componentInstance.navigate({
      id: 'exercise', icon: '🏃', title: 'Exercise',
      description: '', route: '', disabled: true,
    });
    expect(router.navigate).not.toHaveBeenCalled();
  });

  // ── CTA behavior ────────────────────────────────────────────────────────────

  it('CTA shows "Approve Plan" text', () => {
    const btn: HTMLButtonElement = fixture.nativeElement.querySelector('.btn-cta');
    expect(btn?.textContent).toContain('Approve Plan');
  });

  it('"Approve Plan →" is disabled (ghost) when sections are incomplete', () => {
    const btn: HTMLButtonElement = fixture.nativeElement.querySelector('.btn-cta');
    expect(btn?.disabled).toBeTrue();
    expect(btn?.classList).toContain('btn--ghost');
  });

  it('"Approve Plan →" is enabled amber primary when all sections complete', () => {
    (['account', 'tasks', 'food'] as SectionId[]).forEach(s => stateMock.markComplete(s));
    fixture.detectChanges();
    const btn: HTMLButtonElement = fixture.nativeElement.querySelector('.btn-cta');
    expect(btn?.disabled).toBeFalse();
    expect(btn?.classList).toContain('btn--accent');
  });

  it('"Approve Plan →" click binding wires to commitPlan()', () => {
    spyOn(fixture.componentInstance, 'commitPlan');
    (['account', 'tasks', 'food'] as SectionId[]).forEach(s => stateMock.markComplete(s));
    fixture.detectChanges();
    const btn: HTMLButtonElement = fixture.nativeElement.querySelector('.btn-cta');
    btn.click();
    expect(fixture.componentInstance.commitPlan).toHaveBeenCalled();
  });

  it('commitPlan() posts to /schedule/plan then calls completeOnboarding', () => {
    const httpTesting = TestBed.inject(HttpTestingController);
    spyOn(router, 'navigate');
    // Give the mock a valid plan period so commitPlan() doesn't bail early
    stateMock.planPeriodSignal.set({ start: '2026-05-01', end: '2026-05-14' });
    (['account', 'tasks', 'food'] as SectionId[]).forEach(s => stateMock.markComplete(s));
    fixture.detectChanges();

    fixture.componentInstance.commitPlan();

    const planReq = httpTesting.expectOne(req =>
      req.method === 'POST' && req.url.includes('/schedule/plan'),
    );
    planReq.flush({ committed: 3, planning_task_status: 'completed' });

    expect(userServiceStub.completeOnboarding).toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/day', '2026-05-01']);

    httpTesting.verify();
  });

  it('button shows "Saving…" text and is disabled during submission', () => {
    (['account', 'tasks', 'food'] as SectionId[]).forEach(s => stateMock.markComplete(s));
    // isSubmitting is a protected signal; (as any) cast required since it
    // cannot be triggered via DOM without async HTTP mocking.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (fixture.componentInstance as any).isSubmitting.set(true);
    fixture.detectChanges();
    const btn: HTMLButtonElement = fixture.nativeElement.querySelector('.btn-cta');
    expect(btn?.disabled).toBeTrue();
    expect(btn?.textContent).toContain('Saving');
  });

  // ── Error state ─────────────────────────────────────────────────────────────

  it('error banner is hidden initially', () => {
    const err: HTMLElement = fixture.nativeElement.querySelector('.commit-error');
    expect(err).toBeNull();
  });

  it('error banner appears when commitError is true', () => {
    // commitError is a protected signal; (as any) cast required since it
    // cannot be triggered via DOM without async HTTP mocking.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (fixture.componentInstance as any).commitError.set(true);
    fixture.detectChanges();
    const err: HTMLElement = fixture.nativeElement.querySelector('.commit-error');
    expect(err).toBeTruthy();
    expect(err?.textContent).toContain('Something went wrong');
  });

  it('commitPlan() sends schedule_template_ids as empty array and routine instances via placed_tasks', () => {
    const httpTesting = TestBed.inject(HttpTestingController);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const placedTask = { task_type: 'custom', title: 'Morning Run', scheduled_date: '2026-05-05', duration_minutes: 30, energy_required: 'low' } as any;
    // Routine instances travel via placed_tasks; template IDs are deliberately omitted so
    // the backend does not re-expand templates and create duplicate schedule_entries.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (stateMock as any).placedTasks = signal([placedTask]).asReadonly();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (stateMock as any).scheduleTemplates = signal([
      { template_id: 'tmpl-abc', title: 'Morning Run' },
    ]).asReadonly();
    stateMock.planPeriodSignal.set({ start: '2026-05-05', end: '2026-05-11' });
    (['account', 'tasks', 'food'] as SectionId[]).forEach(s => stateMock.markComplete(s));
    fixture.detectChanges();

    fixture.componentInstance.commitPlan();

    const req = httpTesting.expectOne(r => r.method === 'POST' && r.url.includes('/schedule/plan'));
    expect(req.request.body.schedule_template_ids).toEqual([]);
    expect(req.request.body.placed_tasks).toEqual([placedTask]);
    req.flush({ committed: 1, planning_task_status: 'completed' });

    httpTesting.verify();
  });

  it('commitPlan() shows error banner and re-enables CTA when /schedule/plan fails', fakeAsync(() => {
    const httpTesting = TestBed.inject(HttpTestingController);
    stateMock.planPeriodSignal.set({ start: '2026-05-01', end: '2026-05-14' });
    (['account', 'tasks', 'food'] as SectionId[]).forEach(s => stateMock.markComplete(s));
    fixture.detectChanges();

    fixture.componentInstance.commitPlan();
    fixture.detectChanges();

    const planReq = httpTesting.expectOne(req =>
      req.method === 'POST' && req.url.includes('/schedule/plan')
    );
    planReq.flush('Server Error', { status: 500, statusText: 'Internal Server Error' });
    tick();
    fixture.detectChanges();

    // CTA re-enables
    const btn: HTMLButtonElement = fixture.nativeElement.querySelector('.btn-cta');
    expect(btn?.disabled).toBeFalse();

    // error banner visible
    const err: HTMLElement = fixture.nativeElement.querySelector('.commit-error');
    expect(err).toBeTruthy();
    expect(err?.textContent).toContain('Something went wrong');

    httpTesting.verify();
  }));
});
