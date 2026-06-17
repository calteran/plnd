import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { Subject } from 'rxjs';
import { PlanMealsStepComponent } from './plan-meals-step';
import { WeekPlanService } from '../../../../core/services/week-plan.service';
import { MealPlannerAgentService } from '../../../../core/services/meal-planner-agent.service';
import { DayTypesMealsService } from '../../../../core/services/day-types-meals.service';
import { UserMealsService } from '../../../../core/services/user-meals.service';
import { UserDishesService } from '../../../../core/services/user-dishes.service';
import { MealEntry, MealPlanResponse } from '../../../../core/models/week-plan';
import { MealPatternEntry } from '../../../../core/models/meal-pattern';
import { UserMealPref } from '../../../../core/models/user-meal-pref';
import { UserDishPref } from '../../../../core/models/user-dish-pref';

const PATTERN_FIXTURE: MealPatternEntry[] = [
  { id: '1', name: 'breakfast', preferred_time: '08:00:00', tolerance_minutes: 60, sort_order: 1, user_id: '', day_type_id: '', created_at: '', updated_at: '' },
  { id: '2', name: 'lunch',     preferred_time: '12:00:00', tolerance_minutes: 60, sort_order: 2, user_id: '', day_type_id: '', created_at: '', updated_at: '' },
  { id: '3', name: 'dinner',    preferred_time: '18:00:00', tolerance_minutes: 60, sort_order: 3, user_id: '', day_type_id: '', created_at: '', updated_at: '' },
];

function makeDayTypesMealsMock(entries: MealPatternEntry[] = PATTERN_FIXTURE) {
  return {
    load: jasmine.createSpy('load'),
    allEntries: signal<MealPatternEntry[]>(entries).asReadonly(),
    loaded: signal(true).asReadonly(),
    mealsForDate: jasmine.createSpy('mealsForDate').and.callFake(() => entries),
    clear: jasmine.createSpy('clear'),
  };
}

function makeUserMealsMock(meals: UserMealPref[] = []) {
  return {
    load:  jasmine.createSpy('load'),
    meals: signal<UserMealPref[]>(meals).asReadonly(),
  };
}

function makeUserDishesMock(dishes: UserDishPref[] = []) {
  return {
    load:   jasmine.createSpy('load'),
    dishes: signal<UserDishPref[]>(dishes).asReadonly(),
  };
}

function makeMockPlanResponse(days: string[]): MealPlanResponse {
  const meals: MealEntry[] = days.flatMap(date =>
    (['breakfast', 'lunch', 'dinner'] as const).map(name => ({
      date,
      meal_name: name,
      meal_ref: null,
      title: `${name} for ${date}`,
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
        { provide: DayTypesMealsService, useValue: makeDayTypesMealsMock() },
        { provide: UserMealsService,      useValue: makeUserMealsMock() },
        { provide: UserDishesService,     useValue: makeUserDishesMock() },
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

  it('should optimistically show the edited meal text before resolveText responds (#962)', () => {
    const resolve$ = new Subject<{ meal_ref: null; confirmation: string }>();
    agentSpy.resolveText = jasmine.createSpy('resolveText').and.returnValue(resolve$);

    // Start from a known approved meal so a reversion would be visible.
    service.setMealRef('2026-03-23', 'breakfast', { type: 'user', id: 'u1' }, 'Old meal');
    fixture.detectChanges();

    component.confirmEdit('2026-03-23', 'breakfast', 'New meal');
    fixture.detectChanges();

    // Before the agent responds, the cell must already reflect the new text —
    // it must NOT revert to the pre-edit "Old meal".
    const firstCell: HTMLElement = fixture.nativeElement.querySelector('.gc');
    expect(firstCell.textContent).toContain('New meal');
    expect(firstCell.textContent).not.toContain('Old meal');
    expect(service.scheduledMeals()['2026-03-23']?.['breakfast']?.title).toBe('New meal');

    // When the agent resolves, the entry is enriched with the matched ref.
    resolve$.next({ meal_ref: null, confirmation: 'Added New meal' });
    fixture.detectChanges();
    expect(service.scheduledMeals()['2026-03-23']?.['breakfast']?.title).toBe('New meal');
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

  it('should apply the suggestSlot result to the cell as a proposed meal', () => {
    spyOn(service, 'proposeMealRef');
    const firstCell: HTMLElement = fixture.nativeElement.querySelector('.gc');
    (firstCell.querySelector('.gc-suggest') as HTMLButtonElement).click();

    suggestSlot$.next({ date: '2026-03-23', meal_name: 'breakfast', meal_ref: null, title: 'Avocado toast' });
    expect(service.proposeMealRef).toHaveBeenCalledWith('2026-03-23', 'breakfast', null, 'Avocado toast', undefined, undefined);
  });

  it('should keep the cell proposed after suggesting, preserving ✓ approve and 🔀 suggest', () => {
    // Regression: suggesting a meal used to auto-approve it, collapsing the cell to
    // the edit-only approved view and removing the approve/suggest buttons.
    const firstCell: HTMLElement = fixture.nativeElement.querySelector('.gc');
    (firstCell.querySelector('.gc-suggest') as HTMLButtonElement).click();

    suggestSlot$.next({ date: '2026-03-23', meal_name: 'breakfast', meal_ref: null, title: 'Avocado toast' });
    fixture.detectChanges();

    expect(service.scheduledMeals()['2026-03-23']?.['breakfast']?.approvalState).toBe('proposed');
    expect(firstCell.classList.contains('approved-g')).toBeFalse();
    expect(firstCell.querySelector('.gc-approve')).toBeTruthy();
    expect(firstCell.querySelector('.gc-suggest')).toBeTruthy();
    expect(firstCell.querySelector('.gc-text')!.textContent!.trim()).toBe('Avocado toast');
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

    it('should render the meal-plan loader (and not the grid) while generating', () => {
      expect(fixture.nativeElement.querySelector('app-meal-plan-loading')).not.toBeNull();
      expect(fixture.nativeElement.querySelector('.meals-grid')).toBeNull();
    });

    it('should hide the loader and render the grid once generation succeeds', () => {
      const days = ['2026-03-23', '2026-03-24', '2026-03-25', '2026-03-26', '2026-03-27'];
      generateWeek$.next(makeMockPlanResponse(days));
      generateWeek$.complete();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('app-meal-plan-loading')).toBeNull();
      expect(fixture.nativeElement.querySelector('.meals-grid')).not.toBeNull();
    });

    it('should NOT render any per-cell .gc-skeleton placeholders (loader covers that)', () => {
      // Skeleton was deleted as part of the loader work.
      expect(fixture.nativeElement.querySelector('.gc-skeleton')).toBeNull();
    });

    describe('cancel mid-generation', () => {
      it('should hide the loader and show the cancellation card on cancelGeneration()', () => {
        component.cancelGeneration();
        fixture.detectChanges();

        expect(service.isGenerating()).toBeFalse();
        expect(fixture.nativeElement.querySelector('app-meal-plan-loading')).toBeNull();

        const card = fixture.nativeElement.querySelector('.cancel-card');
        expect(card).not.toBeNull();
        expect(card.querySelector('.btn-cancel-primary')).not.toBeNull();   // Try again
        expect(card.querySelector('.btn-cancel-secondary')).not.toBeNull(); // Skip
      });

      it('Try again should re-trigger generateWeek and re-show the loader', () => {
        agentSpy.generateWeek.calls.reset();
        component.cancelGeneration();
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('.cancel-card')).not.toBeNull();

        // Hand the agent a fresh subject so the new subscription has somewhere to land.
        const next$ = new Subject<MealPlanResponse>();
        agentSpy.generateWeek.and.returnValue(next$);

        (fixture.nativeElement.querySelector('.btn-cancel-primary') as HTMLButtonElement).click();
        fixture.detectChanges();

        expect(agentSpy.generateWeek).toHaveBeenCalledTimes(1);
        expect(service.isGenerating()).toBeTrue();
        expect(fixture.nativeElement.querySelector('app-meal-plan-loading')).not.toBeNull();
        expect(fixture.nativeElement.querySelector('.cancel-card')).toBeNull();
      });

      it('Skip should clear the cancellation card and reveal the (empty) grid', () => {
        component.cancelGeneration();
        fixture.detectChanges();

        (fixture.nativeElement.querySelector('.btn-cancel-secondary') as HTMLButtonElement).click();
        fixture.detectChanges();

        expect(fixture.nativeElement.querySelector('.cancel-card')).toBeNull();
        expect(fixture.nativeElement.querySelector('.meals-grid')).not.toBeNull();
      });
    });

    it('should populate cells when generateWeek emits', () => {
      const days = ['2026-03-23', '2026-03-24', '2026-03-25', '2026-03-26', '2026-03-27'];
      generateWeek$.next(makeMockPlanResponse(days));
      generateWeek$.complete();
      fixture.detectChanges();
      expect(service.isGenerating()).toBeFalse();
      expect(service.scheduledMeals()['2026-03-23']?.['breakfast']?.title).toBe('breakfast for 2026-03-23');
    });

    it('should display error banner and stop generating when generateWeek errors', () => {
      generateWeek$.error(new Error('server error'));
      fixture.detectChanges();

      expect(service.isGenerating()).toBeFalse();
      const banner = fixture.nativeElement.querySelector('.gen-error');
      expect(banner).toBeTruthy();
      expect(banner.textContent).toContain("Couldn't generate meal plan");
    });

    describe('partial success (failed_slots)', () => {
      it('should show .partial-banner and apply .gc-failed when failed_slots is non-empty', () => {
        generateWeek$.next({
          plan_start: '2026-03-23',
          meals: [
            { date: '2026-03-23', meal_name: 'breakfast', meal_ref: null, title: 'Eggs' },
            { date: '2026-03-23', meal_name: 'lunch',     meal_ref: null, title: 'Salad' },
          ],
          failed_slots: [{ date: '2026-03-23', meal_name: 'dinner', reason: 'timeout' }],
        });
        generateWeek$.complete();
        fixture.detectChanges();

        const banner = fixture.nativeElement.querySelector('.partial-banner');
        expect(banner).toBeTruthy();
        expect(banner.textContent).toContain('Filled 2 of 3 slots');
        expect(banner.textContent).toContain('Tap a missing meal to retry');

        const failedCells = fixture.nativeElement.querySelectorAll('.gc-failed');
        expect(failedCells.length).toBe(1);
      });

      it('should NOT show .partial-banner when all slots succeed', () => {
        generateWeek$.next(
          makeMockPlanResponse(['2026-03-23', '2026-03-24', '2026-03-25', '2026-03-26', '2026-03-27'])
        );
        generateWeek$.complete();
        fixture.detectChanges();

        expect(fixture.nativeElement.querySelector('.partial-banner')).toBeNull();
      });

      it('should show "Filled 0 of N slots" banner and flag all cells when all slots fail', () => {
        generateWeek$.next({
          plan_start: '2026-03-23',
          meals: [],
          failed_slots: [
            { date: '2026-03-23', meal_name: 'breakfast', reason: 'timeout' },
            { date: '2026-03-23', meal_name: 'lunch',     reason: 'timeout' },
            { date: '2026-03-23', meal_name: 'dinner',    reason: 'timeout' },
          ],
        });
        generateWeek$.complete();
        fixture.detectChanges();

        const banner = fixture.nativeElement.querySelector('.partial-banner');
        expect(banner).toBeTruthy();
        expect(banner.textContent).toContain('Filled 0 of 3 slots');

        const failedCells = fixture.nativeElement.querySelectorAll('.gc-failed');
        expect(failedCells.length).toBe(3);
      });

      it('should show a no-template banner (not an error or partial banner) when unplannable_reason is no_anchor_template', () => {
        generateWeek$.next({
          plan_start: '2026-03-23',
          meals: [],
          failed_slots: [],
          unplannable_reason: 'no_anchor_template',
        });
        generateWeek$.complete();
        fixture.detectChanges();

        const banner = fixture.nativeElement.querySelector('.no-template-banner');
        expect(banner).toBeTruthy();
        expect(banner.textContent.toLowerCase()).toContain('day type');
        // This is a precondition, not a failure or a partial fill.
        expect(fixture.nativeElement.querySelector('.gen-error')).toBeNull();
        expect(fixture.nativeElement.querySelector('.partial-banner')).toBeNull();
      });

      it('should clear the no-template banner on a subsequent successful generation', () => {
        generateWeek$.next({
          plan_start: '2026-03-23', meals: [], failed_slots: [], unplannable_reason: 'no_anchor_template',
        });
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('.no-template-banner')).toBeTruthy();

        component.retryGeneration();
        generateWeek$.next(
          makeMockPlanResponse(['2026-03-23', '2026-03-24', '2026-03-25', '2026-03-26', '2026-03-27'])
        );
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('.no-template-banner')).toBeNull();
      });

      it('should remove .gc-failed from a cell after refreshSlot succeeds', () => {
        // Set up one failed slot
        generateWeek$.next({
          plan_start: '2026-03-23',
          meals: [
            { date: '2026-03-23', meal_name: 'breakfast', meal_ref: null, title: 'Eggs' },
            { date: '2026-03-23', meal_name: 'lunch',     meal_ref: null, title: 'Salad' },
          ],
          failed_slots: [{ date: '2026-03-23', meal_name: 'dinner', reason: 'timeout' }],
        });
        generateWeek$.complete();
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelectorAll('.gc-failed').length).toBe(1);

        // Retry the failed slot
        component.refreshSlot('2026-03-23', 'dinner');
        suggestSlot$.next({ date: '2026-03-23', meal_name: 'dinner', meal_ref: null, title: 'Soup' });
        fixture.detectChanges();

        // Cell should no longer be flagged
        expect(fixture.nativeElement.querySelectorAll('.gc-failed').length).toBe(0);
      });

      it('should remove .gc-failed from a cell when the cell is skipped', () => {
        generateWeek$.next({
          plan_start: '2026-03-23',
          meals: [],
          failed_slots: [{ date: '2026-03-23', meal_name: 'breakfast', reason: 'timeout' }],
        });
        generateWeek$.complete();
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelectorAll('.gc-failed').length).toBe(1);

        component.skipMeal('2026-03-23', 'breakfast');
        fixture.detectChanges();

        expect(fixture.nativeElement.querySelectorAll('.gc-failed').length).toBe(0);
      });

      it('should remove .gc-failed from a cell when the user types in a manual edit', () => {
        const resolve$ = new Subject<{ meal_ref: null; confirmation: string }>();
        agentSpy.resolveText = jasmine.createSpy('resolveText').and.returnValue(resolve$);

        generateWeek$.next({
          plan_start: '2026-03-23',
          meals: [],
          failed_slots: [{ date: '2026-03-23', meal_name: 'breakfast', reason: 'timeout' }],
        });
        generateWeek$.complete();
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelectorAll('.gc-failed').length).toBe(1);

        component.confirmEdit('2026-03-23', 'breakfast', 'Pancakes');
        resolve$.next({ meal_ref: null, confirmation: 'Pancakes' });
        fixture.detectChanges();

        expect(fixture.nativeElement.querySelectorAll('.gc-failed').length).toBe(0);
      });
    });
  });

  describe('swap pending feedback', () => {
    it('should mark the cell as swapping immediately when 🔀 Suggest is clicked, before the agent responds', () => {
      const firstCell: HTMLElement = fixture.nativeElement.querySelector('.gc');
      (firstCell.querySelector('.gc-suggest') as HTMLButtonElement).click();
      fixture.detectChanges();

      // suggestSlot$ has NOT emitted yet — the cell must already signal work in flight.
      expect(firstCell.classList.contains('gc-swapping')).toBeTrue();
      expect(firstCell.querySelector('.gc-swap-pending')).toBeTruthy();
    });

    it('should clear the swapping indicator once suggestSlot emits', () => {
      const firstCell: HTMLElement = fixture.nativeElement.querySelector('.gc');
      (firstCell.querySelector('.gc-suggest') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(firstCell.classList.contains('gc-swapping')).toBeTrue();

      suggestSlot$.next({ date: '2026-03-23', meal_name: 'breakfast', meal_ref: null, title: 'Avocado toast' });
      fixture.detectChanges();

      expect(firstCell.classList.contains('gc-swapping')).toBeFalse();
      expect(firstCell.querySelector('.gc-swap-pending')).toBeNull();
    });

    it('should ignore a second swap while one is already in flight for the same slot', () => {
      const firstCell: HTMLElement = fixture.nativeElement.querySelector('.gc');
      (firstCell.querySelector('.gc-suggest') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(agentSpy.suggestSlot).toHaveBeenCalledTimes(1);

      // A re-trigger while the first request is still pending must be a no-op.
      component.refreshSlot('2026-03-23', 'breakfast');
      expect(agentSpy.suggestSlot).toHaveBeenCalledTimes(1);
    });

    it('should clear the swapping indicator if suggestSlot errors', () => {
      const firstCell: HTMLElement = fixture.nativeElement.querySelector('.gc');
      (firstCell.querySelector('.gc-suggest') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(firstCell.classList.contains('gc-swapping')).toBeTrue();

      suggestSlot$.error(new Error('boom'));
      fixture.detectChanges();

      expect(firstCell.classList.contains('gc-swapping')).toBeFalse();
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

  describe('.gc-na placeholder cells', () => {
    let narrowService: WeekPlanService;
    let narrowAgentSpy: jasmine.SpyObj<MealPlannerAgentService>;
    let narrowGenerateWeek$: Subject<MealPlanResponse>;

    const narrowMock = {
      load: jasmine.createSpy('load'),
      allEntries: signal(PATTERN_FIXTURE).asReadonly(), // 3 rows in union
      loaded: signal(true).asReadonly(),
      // Only 2026-03-23 gets all 3 slots; remaining days get only dinner
      mealsForDate: jasmine.createSpy('mealsForDate').and.callFake((date: string) =>
        date === '2026-03-23' ? PATTERN_FIXTURE : [PATTERN_FIXTURE[2]]
      ),
      clear: jasmine.createSpy('clear'),
    };

    beforeEach(async () => {
      narrowGenerateWeek$ = new Subject();
      narrowAgentSpy = jasmine.createSpyObj('MealPlannerAgentService', [
        'generateWeek', 'rebalance', 'suggestSlot', 'resolveText',
      ]);
      narrowAgentSpy.generateWeek.and.returnValue(narrowGenerateWeek$);
      narrowAgentSpy.rebalance.and.returnValue(narrowGenerateWeek$);
      narrowAgentSpy.suggestSlot.and.returnValue(new Subject());

      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [PlanMealsStepComponent],
        providers: [
          provideHttpClient(),
          provideHttpClientTesting(),
          { provide: MealPlannerAgentService, useValue: narrowAgentSpy },
          { provide: DayTypesMealsService, useValue: narrowMock },
          { provide: UserMealsService,      useValue: makeUserMealsMock() },
          { provide: UserDishesService,     useValue: makeUserDishesMock() },
        ],
      }).compileComponents();

      narrowService = TestBed.inject(WeekPlanService);
      narrowService.initSession('2026-03-23', '2026-03-27');
      (['2026-03-23', '2026-03-24', '2026-03-25', '2026-03-26', '2026-03-27'] as const).forEach(date => {
        ['breakfast', 'lunch', 'dinner'].forEach(slot => {
          narrowService.setMeal(date, slot, { approvalState: 'proposed', mealRef: null, title: slot });
        });
      });
    });

    it('should render .gc-na placeholder cells for days that lack a slot', () => {
      const f = TestBed.createComponent(PlanMealsStepComponent);
      f.detectChanges();
      // 3 rows × 5 days = 15 total cells; 4 days × 2 missing slots = 8 gc-na; 7 real gc
      const naCells = f.nativeElement.querySelectorAll('.gc-na');
      expect(naCells.length).toBe(8);
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
