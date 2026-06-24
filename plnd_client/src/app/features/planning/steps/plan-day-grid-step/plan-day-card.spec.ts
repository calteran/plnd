import { type Mock } from '../../../../../testing/spy';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { By } from '@angular/platform-browser';
import { CdkDragDrop } from '@angular/cdk/drag-drop';
import { LiveAnnouncer } from '@angular/cdk/a11y';
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
    load: vi.fn(),
    allEntries: signal<MealPatternEntry[]>(PATTERN_FIXTURE).asReadonly(),
    loaded: signal(true).asReadonly(),
    mealsForDate: vi.fn().mockImplementation(() => PATTERN_FIXTURE),
    clear: vi.fn(),
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
    const mockService = TestBed.inject(DayTypesMealsService) as unknown as { mealsForDate: Mock };
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
      expect(card.classList.contains('expanded')).toBe(false);
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
      expect(tasksBadge.classList.contains('zero')).toBe(true);
    });

    it('should apply .zero class to meals badge when meal count is 0', () => {
      const statVals = fixture.nativeElement.querySelectorAll('.stat-val');
      const mealsBadge: HTMLElement = statVals[1];
      expect(mealsBadge.classList.contains('zero')).toBe(true);
    });
  });

  describe('expand/collapse toggle', () => {
    beforeEach(() => createComponent());

    it('should add .expanded class to .day-card on click', () => {
      const card: HTMLElement = fixture.nativeElement.querySelector('.day-card');
      card.click();
      fixture.detectChanges();
      expect(card.classList.contains('expanded')).toBe(true);
    });

    it('should remove .expanded class on second click', () => {
      const card: HTMLElement = fixture.nativeElement.querySelector('.day-card');
      card.click();
      fixture.detectChanges();
      card.click();
      fixture.detectChanges();
      expect(card.classList.contains('expanded')).toBe(false);
    });
  });

  describe('keyboard activation', () => {
    beforeEach(() => createComponent('2026-03-31'));

    it('should toggle expanded on Enter key', () => {
      const card: HTMLElement = fixture.nativeElement.querySelector('.day-card');
      card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      fixture.detectChanges();
      expect(card.classList.contains('expanded')).toBe(true);
    });

    it('should toggle expanded on Space key', () => {
      const card: HTMLElement = fixture.nativeElement.querySelector('.day-card');
      card.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
      fixture.detectChanges();
      expect(card.classList.contains('expanded')).toBe(true);
    });

    it('should collapse on second Enter key press', () => {
      const card: HTMLElement = fixture.nativeElement.querySelector('.day-card');
      card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      fixture.detectChanges();
      card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      fixture.detectChanges();
      expect(card.classList.contains('expanded')).toBe(false);
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

  describe('allDropListIds() same-day connections', () => {
    it('includes same-day sibling slot IDs so cross-slot drag on the same card is permitted', () => {
      createComponent('2026-03-31');
      fixture.componentRef.setInput('horizonDays', ['2026-03-31', '2026-04-01']);
      fixture.detectChanges();

      const ids: string[] = (fixture.componentInstance as unknown as { allDropListIds(): string[] }).allDropListIds();

      // PATTERN_FIXTURE has breakfast/lunch/dinner; same-day lunch and sched IDs must be present
      expect(ids).toContain('wizard-slot-2026-03-31-lunch');
      expect(ids).toContain('wizard-slot-2026-03-31-<sched>');
      // Cross-day IDs should still be present
      expect(ids).toContain('wizard-slot-2026-04-01-lunch');
    });
  });

  describe('tasksForSlot() case-insensitive matching (#1005)', () => {
    const CAPITALIZED_PATTERN: MealPatternEntry[] = [
      { id: '1', name: 'Breakfast', preferred_time: '08:00:00', tolerance_minutes: 60, sort_order: 1, user_id: '', day_type_id: '', created_at: '', updated_at: '' },
      { id: '2', name: 'Lunch',     preferred_time: '12:00:00', tolerance_minutes: 60, sort_order: 2, user_id: '', day_type_id: '', created_at: '', updated_at: '' },
    ];

    it('renders a drifted lower-case task in its Capitalized meal slot (not invisible)', () => {
      // Production meal names are Capitalized; if the agent drifts to 'breakfast', the task
      // must still appear in the 'Breakfast' slot. With a raw === comparison it would match
      // neither the meal slot nor '<sched>' and render in no slot at all.
      const mock = TestBed.inject(DayTypesMealsService) as unknown as { mealsForDate: Mock };
      mock.mealsForDate.mockReturnValue(CAPITALIZED_PATTERN);

      service.initSession('2026-03-31', '2026-04-06');
      service.addTask({ date: '2026-03-31', title: 'Pills', energy: 'low', paired_meal_name: 'breakfast' } as PlannedTask);

      createComponent('2026-03-31');

      const breakfast = (fixture.componentInstance as unknown as { tasksForSlot(s: string): PlannedTask[] }).tasksForSlot('Breakfast');
      expect(breakfast.map(t => t.title)).toEqual(['Pills']);
      // And it is NOT double-counted in the unanchored slot.
      const sched = (fixture.componentInstance as unknown as { tasksForSlot(s: string): PlannedTask[] }).tasksForSlot('<sched>');
      expect(sched.map(t => t.title)).toEqual([]);
    });
  });

  describe('onDrop() same-day cross-slot (into-meal pairing)', () => {
    it('same-day drop from <sched> into meal slot sets paired_meal_name and leaves exactly ONE instance', () => {
      service.initSession('2026-03-31', '2026-04-06');
      service.addTask({ date: '2026-03-31', title: 'Morning Walk', energy: 'low' } as PlannedTask);

      createComponent('2026-03-31');

      const task = service.scheduledTasks().find(t => t.title === 'Morning Walk')!;
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

      // Drop into 'lunch' slot on the SAME date (same-day cross-slot)
      (fixture.componentInstance as unknown as { onDrop(e: CdkDragDrop<PlannedTask[]>, s: string): void })
        .onDrop(dropEvent, 'lunch');

      const allWalks = service.scheduledTasks().filter(t => t.title === 'Morning Walk');
      // (a) exactly ONE instance
      expect(allWalks.length).toBe(1);
      // (b) date unchanged
      expect(allWalks[0].date).toBe('2026-03-31');
      // (c) now paired with lunch
      expect(allWalks[0].paired_meal_name).toBe('lunch');
    });
  });

  describe('keyboard reorder + day jump', () => {
    it('keyboard down on a sched task calls reorderTask with the next index', () => {
      service.initSession('2026-03-19', '2026-03-25');
      service.addTask({ date: '2026-03-19', title: 'First',  energy: 'low' } as PlannedTask);
      service.addTask({ date: '2026-03-19', title: 'Second', energy: 'low' } as PlannedTask);

      createComponent('2026-03-19');
      fixture.componentRef.setInput('horizonDays', ['2026-03-19', '2026-03-20']);
      const reorderTaskSpy = vi.spyOn(service, 'reorderTask');

      fixture.componentInstance['toggle']();
      fixture.detectChanges();

      fixture.debugElement.queryAll(By.css('[data-testid="reorder-down"]'))[0].nativeElement.click();

      expect(reorderTaskSpy).toHaveBeenCalledWith('2026-03-19', '<sched>', 0, 1);
    });

    it('next-day jump calls updateTaskSlot with the following date', () => {
      service.initSession('2026-03-19', '2026-03-20');
      service.addTask({ date: '2026-03-19', title: 'Only', energy: 'low' } as PlannedTask);

      createComponent('2026-03-19');
      fixture.componentRef.setInput('horizonDays', ['2026-03-19', '2026-03-20']);
      const updateTaskSlotSpy = vi.spyOn(service, 'updateTaskSlot');

      fixture.componentInstance['toggle']();
      fixture.detectChanges();

      fixture.debugElement.queryAll(By.css('[data-testid="reorder-next-day"]'))[0].nativeElement.click();

      expect(updateTaskSlotSpy).toHaveBeenCalledWith(
        expect.anything(),
        '2026-03-20',
        '<sched>',
        0,
      );
    });

    it('day-jump announces a friendly date label (not the raw ISO string)', () => {
      // 2026-03-20 is a Friday — the announcement must contain a human-readable
      // weekday/month string and must NOT contain the raw ISO date "2026-03-20".
      service.initSession('2026-03-19', '2026-03-20');
      service.addTask({ date: '2026-03-19', title: 'Only', energy: 'low' } as PlannedTask);

      createComponent('2026-03-19');
      fixture.componentRef.setInput('horizonDays', ['2026-03-19', '2026-03-20']);

      const announcer = TestBed.inject(LiveAnnouncer);
      const announceSpy = vi.spyOn(announcer, 'announce');

      fixture.componentInstance['toggle']();
      fixture.detectChanges();

      fixture.debugElement.queryAll(By.css('[data-testid="reorder-next-day"]'))[0].nativeElement.click();

      expect(announceSpy).toHaveBeenCalled();
      const announced: string = announceSpy.mock.calls[0][0] as string;
      // Must contain a weekday abbreviation or month name — not the raw ISO string.
      expect(announced).not.toContain('2026-03-20');
      expect(announced).toMatch(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/);
      expect(announced).toMatch(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/);
    });

    it('clicking a reorder button does NOT collapse the card', () => {
      service.initSession('2026-03-19', '2026-03-25');
      service.addTask({ date: '2026-03-19', title: 'First',  energy: 'low' } as PlannedTask);
      service.addTask({ date: '2026-03-19', title: 'Second', energy: 'low' } as PlannedTask);

      createComponent('2026-03-19');
      fixture.componentRef.setInput('horizonDays', ['2026-03-19', '2026-03-20']);
      fixture.componentInstance['toggle']();
      fixture.detectChanges();

      const card: HTMLElement = fixture.nativeElement.querySelector('.day-card');
      expect(card.classList.contains('expanded')).toBe(true);

      fixture.debugElement.queryAll(By.css('[data-testid="reorder-down"]'))[0].nativeElement.click();
      fixture.detectChanges();

      expect(card.classList.contains('expanded')).toBe(true);
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
