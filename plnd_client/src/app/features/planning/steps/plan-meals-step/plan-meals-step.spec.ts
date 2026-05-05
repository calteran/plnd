import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { Subject } from 'rxjs';
import { PlanMealsStepComponent } from './plan-meals-step';
import { WeekPlanService } from '../../../../core/services/week-plan.service';
import { MealPlannerAgentService } from '../../../../core/services/meal-planner-agent.service';
import { MealPatternService } from '../../../../core/services/meal-pattern.service';
import { MealEntry, MealPlanResponse } from '../../../../core/models/week-plan';
import { MealPatternEntry } from '../../../../core/models/meal-pattern';

const PATTERN_FIXTURE: MealPatternEntry[] = [
  { id: '1', name: 'breakfast', preferred_time: '08:00:00', tolerance_minutes: 60, sort_order: 1, user_id: '', created_at: '' },
  { id: '2', name: 'lunch',     preferred_time: '12:00:00', tolerance_minutes: 60, sort_order: 2, user_id: '', created_at: '' },
  { id: '3', name: 'dinner',    preferred_time: '18:00:00', tolerance_minutes: 60, sort_order: 3, user_id: '', created_at: '' },
];

function makeMealPatternMock() {
  return {
    load: jasmine.createSpy('load'),
    entries: signal<MealPatternEntry[]>(PATTERN_FIXTURE).asReadonly(),
  };
}

function makeMockPlanResponse(days: string[]): MealPlanResponse {
  const meals: MealEntry[] = days.flatMap(date =>
    (['breakfast', 'lunch', 'dinner'] as const).map(occasion => ({
      date,
      occasion,
      meal_ref: null,
      title: `${occasion} for ${date}`,
    }))
  );
  return { plan_start: days[0], meals };
}

describe('PlanMealsStepComponent', () => {
  let fixture: ComponentFixture<PlanMealsStepComponent>;
  let service: WeekPlanService;
  let component: PlanMealsStepComponent;
  let agentSpy: jasmine.SpyObj<MealPlannerAgentService>;
  let generateWeek$: Subject<MealPlanResponse>;
  let suggestSlot$: Subject<MealEntry>;

  beforeEach(async () => {
    generateWeek$ = new Subject();
    suggestSlot$  = new Subject();
    agentSpy = jasmine.createSpyObj('MealPlannerAgentService', [
      'generateWeek', 'rebalance', 'suggestSlot', 'resolveText',
    ]);
    agentSpy.generateWeek.and.returnValue(generateWeek$);
    agentSpy.rebalance.and.returnValue(generateWeek$);
    agentSpy.suggestSlot.and.returnValue(suggestSlot$);

    await TestBed.configureTestingModule({
      imports: [PlanMealsStepComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MealPlannerAgentService, useValue: agentSpy },
        { provide: MealPatternService, useValue: makeMealPatternMock() },
      ],
    }).compileComponents();

    service = TestBed.inject(WeekPlanService);
    service.initSession('2026-03-23', '2026-03-27');
    // Pre-seed meals so ngOnInit sees existing meals and does NOT auto-generate.
    // This keeps structural tests independent of the agent flow.
    (['2026-03-23', '2026-03-24', '2026-03-25', '2026-03-26', '2026-03-27'] as const).forEach(date => {
      (['breakfast', 'lunch', 'dinner'] as const).forEach(slot => {
        service.setMeal(date, slot, { approvalState: 'proposed', mealRef: null, title: `${slot}` });
      });
    });
    fixture = TestBed.createComponent(PlanMealsStepComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => expect(component).toBeTruthy());

  it('should render one .gc cell for each day × slot (5 days × 3 slots = 15)', () => {
    const cells = fixture.nativeElement.querySelectorAll('.gc');
    expect(cells.length).toBe(15);
  });

  it('should render 5 day column headers', () => {
    const headers = fixture.nativeElement.querySelectorAll('.cell-day-header');
    expect(headers.length).toBe(5);
  });

  it('should render a slot row label for each slot', () => {
    const labels = fixture.nativeElement.querySelectorAll('.slot-lbl');
    expect(labels.length).toBe(3);
    const text = Array.from(labels).map(l => (l as HTMLElement).textContent!.trim().toLowerCase());
    expect(text).toContain('breakfast');
    expect(text).toContain('lunch');
    expect(text).toContain('dinner');
  });

  it('should display meal title text in a proposed cell', () => {
    const firstCell: HTMLElement = fixture.nativeElement.querySelector('.gc');
    const text = firstCell.querySelector('.gc-text');
    expect(text).toBeTruthy();
    expect(text!.textContent!.trim().length).toBeGreaterThan(0);
  });

  it('should display ✓ approve, ✏️ pick, and 🔀 suggest buttons in a proposed cell', () => {
    const firstCell: HTMLElement = fixture.nativeElement.querySelector('.gc');
    expect(firstCell.querySelector('.gc-approve')).toBeTruthy();
    expect(firstCell.querySelector('.gc-pick')).toBeTruthy();
    expect(firstCell.querySelector('.gc-suggest')).toBeTruthy();
  });

  it('should display the × skip button in a proposed cell', () => {
    const firstCell: HTMLElement = fixture.nativeElement.querySelector('.gc');
    expect(firstCell.querySelector('.gc-x')).toBeTruthy();
  });

  it('should apply .skipped-g and show skip text when × is clicked', () => {
    const firstCell: HTMLElement = fixture.nativeElement.querySelector('.gc');
    (firstCell.querySelector('.gc-x') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(firstCell.classList.contains('skipped-g')).toBeTrue();
    expect(firstCell.querySelector('.gc-text.skip-t')).toBeTruthy();
    expect(firstCell.querySelector('.gc-undo')).toBeTruthy();
  });

  it('should restore proposed state when undo is clicked on a skipped cell', () => {
    const firstCell: HTMLElement = fixture.nativeElement.querySelector('.gc');
    (firstCell.querySelector('.gc-x') as HTMLButtonElement).click();
    fixture.detectChanges();
    (firstCell.querySelector('.gc-undo') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(firstCell.classList.contains('skipped-g')).toBeFalse();
    expect(firstCell.querySelector('.gc-pick')).toBeTruthy();
  });

  it('should enter editing state and show .mock-input when ✏️ Pick is clicked', () => {
    const firstCell: HTMLElement = fixture.nativeElement.querySelector('.gc');
    (firstCell.querySelector('.gc-pick') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(firstCell.classList.contains('gc-editing')).toBeTrue();
    expect(firstCell.querySelector('.mock-input')).toBeTruthy();
    expect(firstCell.querySelector('.input-hint')).toBeTruthy();
  });

  it('should not save on Escape key and should exit editing', () => {
    spyOn(service, 'setMeal');
    spyOn(service, 'setMealRef');
    const firstCell: HTMLElement = fixture.nativeElement.querySelector('.gc');
    (firstCell.querySelector('.gc-pick') as HTMLButtonElement).click();
    fixture.detectChanges();
    const input = firstCell.querySelector('.mock-input') as HTMLInputElement;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(service.setMeal).not.toHaveBeenCalled();
    expect(service.setMealRef).not.toHaveBeenCalled();
    expect(firstCell.querySelector('.gc-pick')).toBeTruthy();
  });

  it('should call resolveText and then setMealRef on Enter key', () => {
    const resolve$ = new Subject<{ meal_ref: null; confirmation: string }>();
    agentSpy.resolveText = jasmine.createSpy('resolveText').and.returnValue(resolve$);
    spyOn(service, 'setMealRef');

    const firstCell: HTMLElement = fixture.nativeElement.querySelector('.gc');
    (firstCell.querySelector('.gc-pick') as HTMLButtonElement).click();
    fixture.detectChanges();

    const input = firstCell.querySelector('.mock-input') as HTMLInputElement;
    input.value = 'Greek yogurt';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    fixture.detectChanges();

    // resolveText should have been called; editing should end
    expect(agentSpy.resolveText).toHaveBeenCalledWith('Greek yogurt', 'breakfast', '2026-03-23');
    expect(firstCell.classList.contains('gc-editing')).toBeFalse();

    // When the observable emits, setMealRef is called
    resolve$.next({ meal_ref: null, confirmation: 'Added Greek yogurt' });
    expect(service.setMealRef).toHaveBeenCalledWith(
      '2026-03-23', 'breakfast', null, 'Greek yogurt', undefined,
    );
  });

  it('should apply .approved-g state when ✓ approve is clicked on a proposed cell', () => {
    const firstCell: HTMLElement = fixture.nativeElement.querySelector('.gc');
    (firstCell.querySelector('.gc-approve') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(firstCell.classList.contains('approved-g')).toBeTrue();
    expect(firstCell.querySelector('.gc-text.approved-t')).toBeTruthy();
    expect(firstCell.querySelector('.gc-edit-custom')).toBeTruthy();
  });

  it('should call suggestSlot when 🔀 Suggest is clicked, passing existing mealRef as avoid', () => {
    // The cell has a proposed meal with no mealRef (mealRef: null), so avoid should be []
    const firstCell: HTMLElement = fixture.nativeElement.querySelector('.gc');
    (firstCell.querySelector('.gc-suggest') as HTMLButtonElement).click();
    expect(agentSpy.suggestSlot).toHaveBeenCalledWith('2026-03-23', 'breakfast', []);
  });

  it('should pass existing mealRef in avoid when refreshing an approved cell with a ref', () => {
    service.setMealRef('2026-03-23', 'breakfast', { type: 'user', id: 'u1' }, 'Egg toast');
    fixture.detectChanges();
    component.refreshSlot('2026-03-23', 'breakfast');
    expect(agentSpy.suggestSlot).toHaveBeenCalledWith('2026-03-23', 'breakfast', [{ type: 'user', id: 'u1' }]);
  });

  it('should apply the suggestSlot result to the cell', () => {
    spyOn(service, 'setMealRef');
    const firstCell: HTMLElement = fixture.nativeElement.querySelector('.gc');
    (firstCell.querySelector('.gc-suggest') as HTMLButtonElement).click();

    suggestSlot$.next({ date: '2026-03-23', occasion: 'breakfast', meal_ref: null, title: 'Avocado toast' });
    expect(service.setMealRef).toHaveBeenCalledWith('2026-03-23', 'breakfast', null, 'Avocado toast', undefined, undefined);
  });

  it('should NOT auto-generate when meals already exist on init', () => {
    // meals were pre-seeded in beforeEach; generateWeek should not have been called
    expect(agentSpy.generateWeek).not.toHaveBeenCalled();
  });

  describe('auto-generate on first entry', () => {
    beforeEach(async () => {
      // Fresh component with empty meals
      service.clear();
      service.initSession('2026-03-23', '2026-03-27');
      generateWeek$ = new Subject();
      agentSpy.generateWeek.and.returnValue(generateWeek$);
      fixture = TestBed.createComponent(PlanMealsStepComponent);
      component = fixture.componentInstance;
      fixture.detectChanges();
    });

    it('should call generateWeek when no meals exist', () => {
      expect(agentSpy.generateWeek).toHaveBeenCalledOnceWith('2026-03-23', jasmine.any(Object));
    });

    it('should set isGenerating while generating', () => {
      expect(service.isGenerating()).toBeTrue();
    });

    it('should populate cells when generateWeek emits', () => {
      const days = ['2026-03-23', '2026-03-24', '2026-03-25', '2026-03-26', '2026-03-27'];
      generateWeek$.next(makeMockPlanResponse(days));
      generateWeek$.complete();
      fixture.detectChanges();
      expect(service.isGenerating()).toBeFalse();
      expect(service.scheduledMeals()['2026-03-23']?.['breakfast']?.title).toBe('breakfast for 2026-03-23');
    });
  });

  describe('Refresh modal', () => {
    it('should show the Refresh button when there are unapproved meals', () => {
      expect(fixture.nativeElement.querySelector('.btn-refresh-all')).toBeTruthy();
    });

    it('should show the unapproved count badge', () => {
      const badge = fixture.nativeElement.querySelector('.badge');
      expect(badge).toBeTruthy();
      expect(Number(badge.textContent.trim())).toBe(component.unapprovedCount());
    });

    it('should open the modal on Refresh button click', () => {
      (fixture.nativeElement.querySelector('.btn-refresh-all') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.modal-overlay')).toBeTruthy();
    });

    it('should close modal on Cancel click', () => {
      (fixture.nativeElement.querySelector('.btn-refresh-all') as HTMLButtonElement).click();
      fixture.detectChanges();
      (fixture.nativeElement.querySelector('.btn-cancel') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.modal-overlay')).toBeNull();
    });

    it('should call rebalance and preserve approved meals on confirm', () => {
      // Approve first cell
      service.setMeal('2026-03-23', 'breakfast', { approvalState: 'approved', mealRef: null, title: 'Approved meal' });
      fixture.detectChanges();

      (fixture.nativeElement.querySelector('.btn-refresh-all') as HTMLButtonElement).click();
      fixture.detectChanges();
      (fixture.nativeElement.querySelector('.btn-confirm') as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(agentSpy.rebalance).toHaveBeenCalled();

      // Emit response with a new meal for breakfast (should be ignored — already approved)
      const days = ['2026-03-23', '2026-03-24', '2026-03-25', '2026-03-26', '2026-03-27'];
      generateWeek$.next(makeMockPlanResponse(days));
      generateWeek$.complete();
      fixture.detectChanges();

      // Approved meal must be unchanged
      expect(service.scheduledMeals()['2026-03-23']?.['breakfast']?.title).toBe('Approved meal');
      expect(service.scheduledMeals()['2026-03-23']?.['breakfast']?.approvalState).toBe('approved');
    });

    it('unapprovedCount should reflect approved meals being excluded', () => {
      const total = component.unapprovedCount();
      service.approveMeal('2026-03-23', 'breakfast');
      fixture.detectChanges();
      expect(component.unapprovedCount()).toBe(total - 1);
    });
  });

  describe('signal inputs: planStart / planEnd / firstRun', () => {
    function createWithInputs(opts: {
      planStart?: string;
      planEnd?: string;
      firstRun?: boolean;
    }): ComponentFixture<PlanMealsStepComponent> {
      service.clear();
      service.initSession('2026-03-23', '2026-03-27');
      (['2026-03-23', '2026-03-24', '2026-03-25'] as const).forEach(date => {
        (['breakfast', 'lunch', 'dinner'] as const).forEach(slot => {
          service.setMeal(date, slot, { approvalState: 'proposed', mealRef: null, title: slot });
        });
      });
      const f = TestBed.createComponent(PlanMealsStepComponent);
      if (opts.planStart !== undefined) f.componentRef.setInput('planStart', opts.planStart);
      if (opts.planEnd   !== undefined) f.componentRef.setInput('planEnd',   opts.planEnd);
      if (opts.firstRun  !== undefined) f.componentRef.setInput('firstRun',  opts.firstRun);
      f.detectChanges();
      return f;
    }

    it('should show no .first-run-callout by default', () => {
      const f = createWithInputs({});
      expect(f.nativeElement.querySelector('.first-run-callout')).toBeNull();
    });

    it('should show .first-run-callout when firstRun=true', () => {
      const f = createWithInputs({ firstRun: true });
      expect(f.nativeElement.querySelector('.first-run-callout')).toBeTruthy();
    });

    it('should use service horizonDays when planStart/planEnd are not set', () => {
      const f = createWithInputs({});
      expect(f.componentInstance.horizonDays().length).toBe(5);
    });

    it('should override horizonDays when planStart and planEnd inputs are provided', () => {
      const f = createWithInputs({ planStart: '2026-03-23', planEnd: '2026-03-25' });
      expect(f.componentInstance.horizonDays()).toEqual([
        '2026-03-23', '2026-03-24', '2026-03-25',
      ]);
      expect(f.nativeElement.querySelectorAll('.cell-day-header').length).toBe(3);
    });

    it('should pass planStart input to generateWeek when meals are empty', () => {
      service.clear();
      service.initSession('2026-03-23', '2026-03-27');
      generateWeek$ = new Subject();
      agentSpy.generateWeek.and.returnValue(generateWeek$);
      const f = TestBed.createComponent(PlanMealsStepComponent);
      f.componentRef.setInput('planStart', '2026-04-01');
      f.componentRef.setInput('planEnd',   '2026-04-03');
      f.detectChanges();
      expect(agentSpy.generateWeek).toHaveBeenCalledWith('2026-04-01', jasmine.any(Object));
    });

    it('should fall back to service.planStart() when planStart input is not set', () => {
      service.clear();
      service.initSession('2026-03-23', '2026-03-27');
      generateWeek$ = new Subject();
      agentSpy.generateWeek.and.returnValue(generateWeek$);
      TestBed.createComponent(PlanMealsStepComponent).detectChanges();
      expect(agentSpy.generateWeek).toHaveBeenCalledWith('2026-03-23', jasmine.any(Object));
    });

    it('should pass planStart input to rebalance when refresh modal is confirmed', () => {
      service.clear();
      service.initSession('2026-03-23', '2026-03-27');
      generateWeek$ = new Subject();
      agentSpy.generateWeek.and.returnValue(generateWeek$);
      agentSpy.rebalance.and.returnValue(generateWeek$);

      const f = TestBed.createComponent(PlanMealsStepComponent);
      f.componentRef.setInput('planStart', '2026-04-01');
      f.componentRef.setInput('planEnd',   '2026-04-03');
      f.detectChanges();

      f.componentInstance.openRefreshModal();
      f.componentInstance.confirmRebalance();

      expect(agentSpy.rebalance).toHaveBeenCalledWith('2026-04-01', jasmine.any(Object));
    });
  });
});
