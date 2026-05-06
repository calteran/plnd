import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { WritableSignal, signal } from '@angular/core';
import { PlanningWizardComponent } from './planning-wizard';
import { MealPatternService } from '../../../core/services/meal-pattern.service';
import { MealPatternEntry } from '../../../core/models/meal-pattern';

const PATTERN_FIXTURE: MealPatternEntry[] = [
  { id: '1', name: 'breakfast', preferred_time: '08:00:00', tolerance_minutes: 60, sort_order: 1, user_id: '', created_at: '' },
  { id: '2', name: 'lunch',     preferred_time: '12:00:00', tolerance_minutes: 60, sort_order: 2, user_id: '', created_at: '' },
  { id: '3', name: 'dinner',    preferred_time: '18:00:00', tolerance_minutes: 60, sort_order: 3, user_id: '', created_at: '' },
];

describe('PlanningWizardComponent', () => {
  let fixture: ComponentFixture<PlanningWizardComponent>;
  let mealEntries: WritableSignal<MealPatternEntry[]>;
  let mealLoaded: WritableSignal<boolean>;

  beforeEach(async () => {
    localStorage.clear();
    mealEntries = signal<MealPatternEntry[]>([]);
    mealLoaded  = signal(false);
    const mealPatternMock = {
      load: jasmine.createSpy('load'),
      entries: mealEntries.asReadonly(),
      loaded: mealLoaded.asReadonly(),
    };

    await TestBed.configureTestingModule({
      imports: [PlanningWizardComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: MealPatternService, useValue: mealPatternMock },
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(PlanningWizardComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should show a progress bar', () => {
    const bar = fixture.nativeElement.querySelector('.wizard-progress');
    expect(bar).toBeTruthy();
  });

  it('aria-valuemax equals the number of enabled steps', () => {
    // Default: Meals (step 3) and Exercise (step 4) are both disabled → 4 enabled
    const bar: HTMLElement = fixture.nativeElement.querySelector('.wizard-progress');
    expect(bar.getAttribute('aria-valuemax')).toBe('4');
  });

  it('aria-valuemax reflects enabled steps when Meals step becomes enabled', () => {
    mealEntries.set(PATTERN_FIXTURE);
    fixture.detectChanges();
    const bar: HTMLElement = fixture.nativeElement.querySelector('.wizard-progress');
    // Exercise (step 4) still disabled → 5 enabled
    expect(bar.getAttribute('aria-valuemax')).toBe('5');
  });

  it('aria-valuenow is 1-indexed position among enabled steps on step 1', () => {
    const bar: HTMLElement = fixture.nativeElement.querySelector('.wizard-progress');
    expect(bar.getAttribute('aria-valuenow')).toBe('1');
  });

  it('aria-valuenow advances correctly when navigating to step 5 with both 3 and 4 disabled', () => {
    // Enabled steps: [1,2,5,6]. Step 5 is position 3.
    fixture.componentInstance.weekPlanService.goToStep(5);
    fixture.detectChanges();
    const bar: HTMLElement = fixture.nativeElement.querySelector('.wizard-progress');
    expect(bar.getAttribute('aria-valuenow')).toBe('3');
  });

  it('aria-valuenow is 4 on step 5 when only Exercise (step 4) is disabled', () => {
    // Enabled steps: [1,2,3,5,6]. Step 5 is position 4.
    mealEntries.set(PATTERN_FIXTURE);
    fixture.componentInstance.weekPlanService.goToStep(5);
    fixture.detectChanges();
    const bar: HTMLElement = fixture.nativeElement.querySelector('.wizard-progress');
    expect(bar.getAttribute('aria-valuenow')).toBe('4');
  });

  it('should show Back button when step > 1', () => {
    fixture.componentInstance.weekPlanService.goToStep(2);
    fixture.detectChanges();
    const back = fixture.nativeElement.querySelector('.nav-btn--back');
    expect(back).toBeTruthy();
  });

  it('should not show Back button on step 1', () => {
    const back = fixture.nativeElement.querySelector('.nav-btn--back');
    expect(back).toBeFalsy();
  });

  it('should render all 6 step labels', () => {
    const labels = fixture.nativeElement.querySelectorAll('.pill-label');
    const texts = Array.from(labels as HTMLElement[]).map((el) => el.textContent?.trim());
    expect(texts).toEqual(['Carryover', 'Tasks', 'Meals', 'Exercise', 'Review', 'Confirm']);
  });

  it('should mark the Exercise step pill as disabled', () => {
    const pills = fixture.nativeElement.querySelectorAll('.progress-pill');
    // Exercise is step 4, zero-indexed as pills[3]
    expect(pills[3].classList).toContain('disabled');
  });

  it('should mark the Meals step pill as disabled when entries are empty', () => {
    fixture.detectChanges();
    const pills = fixture.nativeElement.querySelectorAll('.progress-pill');
    // Meals is step 3, zero-indexed as pills[2]
    expect(pills[2].classList).toContain('disabled');
  });

  it('should not mark the Meals step pill as disabled when entries are non-empty', () => {
    mealEntries.set(PATTERN_FIXTURE);
    fixture.detectChanges();
    const pills = fixture.nativeElement.querySelectorAll('.progress-pill');
    expect(pills[2].classList).not.toContain('disabled');
  });

  it('next() from step 2 skips meals step and lands on step 5 when entries are empty', () => {
    fixture.componentInstance.weekPlanService.goToStep(2);
    fixture.detectChanges();
    fixture.componentInstance.next();
    expect(fixture.componentInstance.weekPlanService.currentStep()).toBe(5);
  });

  it('next() from step 2 lands on step 3 when entries are non-empty', () => {
    mealEntries.set(PATTERN_FIXTURE);
    fixture.componentInstance.weekPlanService.goToStep(2);
    fixture.detectChanges();
    fixture.componentInstance.next();
    expect(fixture.componentInstance.weekPlanService.currentStep()).toBe(3);
  });

  it('next() from step 3 skips disabled step 4 and lands on step 5', () => {
    mealEntries.set(PATTERN_FIXTURE); // keep step 3 enabled so guard does not fire
    fixture.componentInstance.weekPlanService.goToStep(3);
    fixture.detectChanges();
    fixture.componentInstance.next();
    expect(fixture.componentInstance.weekPlanService.currentStep()).toBe(5);
  });

  it('back() from step 5 skips meals step and lands on step 2 when entries are empty', () => {
    fixture.componentInstance.weekPlanService.goToStep(5);
    fixture.detectChanges();
    fixture.componentInstance.back();
    expect(fixture.componentInstance.weekPlanService.currentStep()).toBe(2);
  });

  it('back() from step 5 skips disabled step 4 and lands on step 3 when entries are non-empty', () => {
    mealEntries.set(PATTERN_FIXTURE);
    fixture.componentInstance.weekPlanService.goToStep(5);
    fixture.detectChanges();
    fixture.componentInstance.back();
    expect(fixture.componentInstance.weekPlanService.currentStep()).toBe(3);
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

  // ── Carryover auto-skip ──────────────────────────────────────────────────

  describe('carryover auto-skip', () => {
    afterEach(() => {
      TestBed.inject(HttpTestingController).verify();
    });

    function initSession(httpMock: HttpTestingController) {
      // Flush preferences → triggers session-init effect
      httpMock.expectOne(r => r.url.includes('/preferences/me')).flush({
        user_id: 'u1', week_start_day: 1, planning_trigger_offset: 0,
        default_plan_length_days: 7, email_notifications_enabled: false,
        sms_notifications_enabled: false, push_notifications_enabled: false,
        phone_number: null, created_at: '', updated_at: '',
      });
      // Run change detection so the session-init effect executes and fires HTTP requests
      fixture.detectChanges();
      // Flush weekly-plan task POST
      httpMock.expectOne(r => r.url.includes('/tasks/weekly-plan')).flush({ task_id: 'tid' });
    }

    it('advances to step 2 and marks step 1 disabled when carryover is empty', () => {
      const httpMock = TestBed.inject(HttpTestingController);
      initSession(httpMock);
      fixture.detectChanges();
      httpMock.expectOne(r => r.url.includes('/schedule/plan/carryover')).flush({ carryover: [] });
      fixture.detectChanges();

      expect(fixture.componentInstance.weekPlanService.currentStep()).toBe(2);
      const pills = fixture.nativeElement.querySelectorAll('.progress-pill');
      expect(pills[0].classList).toContain('disabled');
    });

    it('stays on step 1 and keeps it enabled when carryover has items', () => {
      const httpMock = TestBed.inject(HttpTestingController);
      initSession(httpMock);
      fixture.detectChanges();
      httpMock.expectOne(r => r.url.includes('/schedule/plan/carryover')).flush({
        carryover: [{ entry_id: 'e1', title: 'Walk', task_type: 'general',
                      date: '2026-03-20', status: 'planned', scheduled_start: null }],
      });
      fixture.detectChanges();

      expect(fixture.componentInstance.weekPlanService.currentStep()).toBe(1);
      const pills = fixture.nativeElement.querySelectorAll('.progress-pill');
      expect(pills[0].classList).not.toContain('disabled');
      // PlanReviewStepComponent also calls loadCarryover on init; flush it to keep the test clean
      httpMock.match(r => r.url.includes('/schedule/plan/carryover'));
    });

    it('does not show Back button on step 2 when step 1 is disabled', () => {
      const httpMock = TestBed.inject(HttpTestingController);
      initSession(httpMock);
      fixture.detectChanges();
      httpMock.expectOne(r => r.url.includes('/schedule/plan/carryover')).flush({ carryover: [] });
      fixture.detectChanges();

      // step 2 is now current; step 1 is the only "previous" step but is disabled
      const back = fixture.nativeElement.querySelector('.nav-btn--back');
      expect(back).toBeFalsy();
    });

    it('shows Back button on step 3 when step 2 is a valid previous step', () => {
      const httpMock = TestBed.inject(HttpTestingController);
      initSession(httpMock);
      fixture.detectChanges();
      httpMock.expectOne(r => r.url.includes('/schedule/plan/carryover')).flush({ carryover: [] });
      fixture.detectChanges();
      fixture.componentInstance.weekPlanService.goToStep(3);
      fixture.detectChanges();

      const back = fixture.nativeElement.querySelector('.nav-btn--back');
      expect(back).toBeTruthy();
      // PlanMealsStepComponent fires meal-pattern and agent/meal-plan requests on render; discard them
      httpMock.match(() => true);
    });
  });

  it('guard effect does not auto-advance when meal-pattern is not yet loaded', () => {
    mealEntries.set([]);
    mealLoaded.set(false);
    fixture.componentInstance.weekPlanService.goToStep(3);
    fixture.detectChanges();
    expect(fixture.componentInstance.weekPlanService.currentStep()).toBe(3);
  });

  it('guard effect auto-advances past disabled step once meal-pattern loads', () => {
    mealLoaded.set(false);
    fixture.componentInstance.weekPlanService.goToStep(3);
    fixture.detectChanges();
    expect(fixture.componentInstance.weekPlanService.currentStep()).toBe(3);

    mealLoaded.set(true);
    fixture.detectChanges();
    expect(fixture.componentInstance.weekPlanService.currentStep()).toBe(5);
  });
});
