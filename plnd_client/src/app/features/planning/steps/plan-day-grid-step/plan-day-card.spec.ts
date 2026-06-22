import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { CdkDragDrop } from '@angular/cdk/drag-drop';
import { PlanDayCardComponent } from './plan-day-card';
import { WeekPlanService } from '../../../../core/services/week-plan.service';
import { DayTypesMealsService } from '../../../../core/services/day-types-meals.service';
import { MealPatternEntry } from '../../../../core/models/meal-pattern';
import { PlannedTask } from '../../../../core/models/week-plan';

const PATTERN_FIXTURE: MealPatternEntry[] = [
  { id: '1', name: 'breakfast', preferred_time: '08:00:00', tolerance_minutes: 60, sort_order: 1, user_id: '', day_type_id: '', created_at: '', updated_at: '' },
  { id: '2', name: 'lunch',     preferred_time: '12:00:00', tolerance_minutes: 60, sort_order: 2, user_id: '', day_type_id: '', created_at: '', updated_at: '' },
  { id: '3', name: 'dinner',    preferred_time: '18:00:00', tolerance_minutes: 60, sort_order: 3, user_id: '', day_type_id: '', created_at: '', updated_at: '' },
];

function makeDayTypesMealsMock() {
  return {
    load: jasmine.createSpy('load'),
    allEntries: signal<MealPatternEntry[]>(PATTERN_FIXTURE).asReadonly(),
    loaded: signal(true).asReadonly(),
    mealsForDate: jasmine.createSpy('mealsForDate').and.callFake(() => PATTERN_FIXTURE),
    clear: jasmine.createSpy('clear'),
  };
}

describe('PlanDayCardComponent', () => {
  let fixture: ComponentFixture<PlanDayCardComponent>;
  let service: WeekPlanService;

  function createComponent(date = '2026-03-31') {
    fixture = TestBed.createComponent(PlanDayCardComponent);
    fixture.componentRef.setInput('date', date);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [PlanDayCardComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: DayTypesMealsService, useValue: makeDayTypesMealsMock() },
      ],
    }).compileComponents();
    service = TestBed.inject(WeekPlanService);
    service.initSession('2026-03-31', '2026-04-06');
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('should create', () => {
    createComponent();
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should call mealsForDate with the card\'s own date input', () => {
    const mockService = TestBed.inject(DayTypesMealsService) as unknown as { mealsForDate: jasmine.Spy };
    createComponent('2026-03-31');
    expect(mockService.mealsForDate).toHaveBeenCalledWith('2026-03-31');
  });

  describe('collapsed state', () => {
    beforeEach(() => createComponent('2026-03-31'));

    it('should render the day name abbreviation', () => {
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('.day-name')?.textContent?.trim()).toBe('Tue');
    });

    it('should render the short date', () => {
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('.day-date')?.textContent?.trim()).toBe('Mar 31');
    });

    it('should render a .card-stats element', () => {
      expect(fixture.nativeElement.querySelector('.card-stats')).toBeTruthy();
    });

    it('should render two .stat-row elements', () => {
      const rows = fixture.nativeElement.querySelectorAll('.stat-row');
      expect(rows.length).toBe(2);
    });

    it('should render a .card-chevron element', () => {
      expect(fixture.nativeElement.querySelector('.card-chevron')).toBeTruthy();
    });

    it('should always render .card-body in the DOM (for CSS animation)', () => {
      expect(fixture.nativeElement.querySelector('.card-body')).toBeTruthy();
    });

    it('should NOT have .expanded class when collapsed', () => {
      const card: HTMLElement = fixture.nativeElement.querySelector('.day-card');
      expect(card.classList.contains('expanded')).toBeFalse();
    });
  });

  describe('zero-value badge styling', () => {
    beforeEach(() => {
      // '2026-04-06' is the last day of the horizon; no tasks or meals are scheduled for it
      // initSession initialises an empty draft, so this date will always have zero counts
      createComponent('2026-04-06');
    });

    it('should apply .zero class to tasks badge when task count is 0', () => {
      const statVals = fixture.nativeElement.querySelectorAll('.stat-val');
      const tasksBadge: HTMLElement = statVals[0];
      expect(tasksBadge.classList.contains('zero')).toBeTrue();
    });

    it('should apply .zero class to meals badge when meal count is 0', () => {
      const statVals = fixture.nativeElement.querySelectorAll('.stat-val');
      const mealsBadge: HTMLElement = statVals[1];
      expect(mealsBadge.classList.contains('zero')).toBeTrue();
    });
  });

  describe('expand/collapse toggle', () => {
    beforeEach(() => createComponent());

    it('should add .expanded class to .day-card on click', () => {
      const card: HTMLElement = fixture.nativeElement.querySelector('.day-card');
      card.click();
      fixture.detectChanges();
      expect(card.classList.contains('expanded')).toBeTrue();
    });

    it('should remove .expanded class on second click', () => {
      const card: HTMLElement = fixture.nativeElement.querySelector('.day-card');
      card.click();
      fixture.detectChanges();
      card.click();
      fixture.detectChanges();
      expect(card.classList.contains('expanded')).toBeFalse();
    });
  });

  describe('keyboard activation', () => {
    beforeEach(() => createComponent('2026-03-31'));

    it('should toggle expanded on Enter key', () => {
      const card: HTMLElement = fixture.nativeElement.querySelector('.day-card');
      card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      fixture.detectChanges();
      expect(card.classList.contains('expanded')).toBeTrue();
    });

    it('should toggle expanded on Space key', () => {
      const card: HTMLElement = fixture.nativeElement.querySelector('.day-card');
      card.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
      fixture.detectChanges();
      expect(card.classList.contains('expanded')).toBeTrue();
    });

    it('should collapse on second Enter key press', () => {
      const card: HTMLElement = fixture.nativeElement.querySelector('.day-card');
      card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      fixture.detectChanges();
      card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      fixture.detectChanges();
      expect(card.classList.contains('expanded')).toBeFalse();
    });
  });

  describe('energyClass() helper', () => {
    beforeEach(() => createComponent());

    it('returns "energy-low" for low', () => {
      expect(fixture.componentInstance.energyClass('low')).toBe('energy-low');
    });

    it('returns "energy-medium" for medium', () => {
      expect(fixture.componentInstance.energyClass('medium')).toBe('energy-medium');
    });

    it('returns "energy-high" for high', () => {
      expect(fixture.componentInstance.energyClass('high')).toBe('energy-high');
    });
  });

  describe('energyLabel() helper', () => {
    beforeEach(() => createComponent());

    it('returns "low" for low', () => {
      expect(fixture.componentInstance.energyLabel('low')).toBe('low');
    });

    it('returns "med" for medium', () => {
      expect(fixture.componentInstance.energyLabel('medium')).toBe('med');
    });

    it('returns "high" for high', () => {
      expect(fixture.componentInstance.energyLabel('high')).toBe('high');
    });
  });

  describe('onDrop() cross-day duplicate regression', () => {
    it('cross-day drop leaves EXACTLY ONE instance of the task on the new date', () => {
      // Regression: the old onDrop called moveTaskToDay then updateTaskSlot with the
      // original (stale) task reference. After moveTaskToDay replaced the object in the
      // signal, filter(t => t !== task) in updateTaskSlot would remove nothing, and
      // splice would insert a second copy — duplicating the task.
      //
      // Fix: onDrop calls updateTaskSlot only; it handles date+slot atomically.
      service.initSession('2026-03-31', '2026-04-06');
      service.addTask({ date: '2026-03-31', title: 'Walk', energy: 'low', paired_meal_name: 'breakfast' } as PlannedTask);
      service.addTask({ date: '2026-03-31', title: 'Run',  energy: 'medium' } as PlannedTask);

      // Card represents '2026-04-01' (day 2); task is dragged from '2026-03-31'.
      createComponent('2026-04-01');

      const task = service.scheduledTasks().find(t => t.title === 'Walk')!;
      const dropEvent = {
        item: { data: task },
        previousIndex: 0,
        currentIndex: 0,
        container: { data: [] },
        previousContainer: { data: [task] },
        isPointerOverContainer: true,
        distance: { x: 0, y: 0 },
        dropPoint: { x: 0, y: 0 },
      } as unknown as CdkDragDrop<PlannedTask[]>;

      // Call protected onDrop via cast
      (fixture.componentInstance as unknown as { onDrop(e: CdkDragDrop<PlannedTask[]>, s: string): void })
        .onDrop(dropEvent, 'lunch');

      const allWalks = service.scheduledTasks().filter(t => t.title === 'Walk');
      expect(allWalks.length).toBe(1);
      expect(allWalks[0].date).toBe('2026-04-01');
      expect(allWalks[0].paired_meal_name).toBe('lunch');
    });
  });
});
