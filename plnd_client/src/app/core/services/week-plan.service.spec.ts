import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { WeekPlanService } from './week-plan.service';
import { MealRef, PostSchedulePlanRequest, SchedulePeriodResponse } from '../models/week-plan';
import { DayTypesMealsService } from './day-types-meals.service';

describe('WeekPlanService', () => {
  let service: WeekPlanService;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: DayTypesMealsService,
          useValue: {
            load: jasmine.createSpy('load'),
            loaded: signal(true).asReadonly(),
            mealsForDate: jasmine.createSpy('mealsForDate').and.callFake(() => [
              { id: '1', name: 'breakfast', preferred_time: '08:00:00', tolerance_minutes: 60, sort_order: 1, user_id: '', day_type_id: '', created_at: '', updated_at: '' },
              { id: '2', name: 'lunch',     preferred_time: '12:00:00', tolerance_minutes: 60, sort_order: 2, user_id: '', day_type_id: '', created_at: '', updated_at: '' },
              { id: '3', name: 'dinner',    preferred_time: '18:00:00', tolerance_minutes: 60, sort_order: 3, user_id: '', day_type_id: '', created_at: '', updated_at: '' },
            ]),
          },
        },
      ],
    }).compileComponents();
    service = TestBed.inject(WeekPlanService);
    httpMock = TestBed.inject(HttpTestingController);
    localStorage.clear();
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
  });

  it('should initialise with step 1 when no draft exists', () => {
    service.initSession('2026-03-24', '2026-03-30');
    expect(service.currentStep()).toBe(1);
    expect(service.planStart()).toBe('2026-03-24');
  });

  it('should restore step from valid draft', () => {
    const draft = {
      schemaVersion: 2,
      planStart: '2026-03-24',
      planEnd: '2026-03-30',
      currentStep: 3,
      carryoverDecisions: {},
      scheduledMeals: {},
      scheduledTasks: [],
      savedAt: '2026-03-23T12:00:00Z',
    };
    localStorage.setItem('plnd:plan-draft', JSON.stringify(draft));
    service.initSession('2026-03-24', '2026-03-30');
    expect(service.currentStep()).toBe(3);
  });

  it('should NOT restore a v1 draft (schema version mismatch)', () => {
    const draft = {
      schemaVersion: 1,
      planStart: '2026-03-24',
      planEnd: '2026-03-30',
      currentStep: 3,
      carryoverDecisions: {},
      scheduledMeals: {},
      scheduledTasks: [],
      savedAt: '2026-03-23T12:00:00Z',
    };
    localStorage.setItem('plnd:plan-draft', JSON.stringify(draft));
    service.initSession('2026-03-24', '2026-03-30');
    expect(service.currentStep()).toBe(1);
  });

  it('should not restore draft when plan_start does not match', () => {
    const draft = {
      schemaVersion: 2,
      planStart: '2026-03-17',
      planEnd: '2026-03-23',
      currentStep: 3,
      carryoverDecisions: {},
      scheduledMeals: {},
      scheduledTasks: [],
      savedAt: '2026-03-23T12:00:00Z',
    };
    localStorage.setItem('plnd:plan-draft', JSON.stringify(draft));
    service.initSession('2026-03-24', '2026-03-30');
    expect(service.currentStep()).toBe(1);
  });

  it('should save and load draft round-trip', () => {
    service.initSession('2026-03-24', '2026-03-30');
    service.goToStep(2);
    const loaded = service.loadDraft();
    expect(loaded?.currentStep).toBe(2);
    expect(loaded?.planStart).toBe('2026-03-24');
    expect(loaded?.schemaVersion).toBe(2);
  });

  it('clearDraft should remove localStorage entry', () => {
    service.initSession('2026-03-24', '2026-03-30');
    service.saveDraft();
    expect(localStorage.getItem('plnd:plan-draft')).not.toBeNull();
    service.clearDraft();
    expect(localStorage.getItem('plnd:plan-draft')).toBeNull();
  });

  it('setCarryoverDecision updates decisions signal', () => {
    service.initSession('2026-03-24', '2026-03-30');
    service.setCarryoverDecision('task-1', 'defer');
    expect(service.carryoverDecisions()['task-1']).toBe('defer');
  });

  it('setMeal updates scheduledMeals signal', () => {
    service.initSession('2026-03-24', '2026-03-30');
    service.setMeal('2026-03-24', 'breakfast', { approvalState: 'proposed', mealRef: null, title: 'Oatmeal' });
    expect(service.scheduledMeals()['2026-03-24']?.['breakfast']?.title).toBe('Oatmeal');
  });

  it('approveMeal transitions approvalState to approved', () => {
    service.initSession('2026-03-24', '2026-03-30');
    service.setMeal('2026-03-24', 'lunch', { approvalState: 'proposed', mealRef: null, title: 'Salad' });
    service.approveMeal('2026-03-24', 'lunch');
    expect(service.scheduledMeals()['2026-03-24']?.['lunch']?.approvalState).toBe('approved');
    expect(service.scheduledMeals()['2026-03-24']?.['lunch']?.title).toBe('Salad');
  });

  it('skipMeal transitions approvalState to skipped', () => {
    service.initSession('2026-03-24', '2026-03-30');
    service.setMeal('2026-03-24', 'dinner', { approvalState: 'proposed', mealRef: null, title: 'Pasta' });
    service.skipMeal('2026-03-24', 'dinner');
    expect(service.scheduledMeals()['2026-03-24']?.['dinner']?.approvalState).toBe('skipped');
  });

  it('setMealRef sets approvalState to approved and stores ref', () => {
    service.initSession('2026-03-24', '2026-03-30');
    service.setMealRef('2026-03-24', 'breakfast', { type: 'user', id: 'u1' }, 'Egg toast');
    const meal = service.scheduledMeals()['2026-03-24']?.['breakfast'];
    expect(meal?.approvalState).toBe('approved');
    expect(meal?.mealRef?.id).toBe('u1');
    expect(meal?.title).toBe('Egg toast');
  });

  it('addTask and removeTask update scheduledTasks signal', () => {
    service.initSession('2026-03-24', '2026-03-30');
    service.addTask({ date: '2026-03-24', title: 'Walk', energy: 'low' });
    expect(service.scheduledTasks().length).toBe(1);
    service.removeTask(0);
    expect(service.scheduledTasks().length).toBe(0);
  });

  it('hasUnplannedHorizon defaults to false', () => {
    expect(service.hasUnplannedHorizon()).toBe(false);
  });

  it('clear resets all signals', () => {
    service.initSession('2026-03-24', '2026-03-30');
    service.addTask({ date: '2026-03-24', title: 'Walk', energy: 'low' });
    service.clear();
    expect(service.planStart()).toBe('');
    expect(service.scheduledTasks().length).toBe(0);
  });

  describe('floating task management', () => {
    it('should start with an empty floatingTasks list', () => {
      expect(service.floatingTasks()).toEqual([]);
    });

    it('should append a task via addFloatingTask', () => {
      service.addFloatingTask({ title: 'Call dentist', energy: 'low', task_type: 'general' });
      expect(service.floatingTasks().length).toBe(1);
      expect(service.floatingTasks()[0].title).toBe('Call dentist');
    });

    it('should remove a task by index via removeFloatingTask', () => {
      service.addFloatingTask({ title: 'Task A', energy: 'low', task_type: 'general' });
      service.addFloatingTask({ title: 'Task B', energy: 'medium', task_type: 'general' });
      service.removeFloatingTask(0);
      expect(service.floatingTasks().length).toBe(1);
      expect(service.floatingTasks()[0].title).toBe('Task B');
    });

    it('should include floatingTasks in saveDraft', () => {
      service.initSession('2026-03-24', '2026-03-30');
      service.addFloatingTask({ title: 'Call dentist', energy: 'low', task_type: 'general' });
      service.saveDraft();
      const draft = service.loadDraft();
      expect(draft?.floatingTasks?.length).toBe(1);
      expect(draft?.floatingTasks?.[0].title).toBe('Call dentist');
    });

    it('should restore floatingTasks from draft on initSession', () => {
      const draft = {
        schemaVersion: 2 as const,
        planStart: '2026-03-24',
        planEnd: '2026-03-30',
        currentStep: 2,
        carryoverDecisions: {},
        scheduledMeals: {},
        scheduledTasks: [],
        floatingTasks: [{ title: 'Gym', energy: 'high' as const, task_type: 'exercise' as const }],
        savedAt: '2026-03-23T12:00:00Z',
      };
      localStorage.setItem('plnd:plan-draft', JSON.stringify(draft));
      service.initSession('2026-03-24', '2026-03-30');
      expect(service.floatingTasks().length).toBe(1);
      expect(service.floatingTasks()[0].title).toBe('Gym');
    });

    it('should default floatingTasks to [] when draft has none', () => {
      const draft = {
        schemaVersion: 2,
        planStart: '2026-03-24',
        planEnd: '2026-03-30',
        currentStep: 1,
        carryoverDecisions: {},
        scheduledMeals: {},
        scheduledTasks: [],
        savedAt: '2026-03-23T12:00:00Z',
      };
      localStorage.setItem('plnd:plan-draft', JSON.stringify(draft));
      service.initSession('2026-03-24', '2026-03-30');
      expect(service.floatingTasks()).toEqual([]);
    });
  });

  describe('loadPeriod', () => {
    it('hydrates scheduledMeals.mealRef from planned_meals keyed by schedule_entry_id', () => {
      service.initSession('2026-03-24', '2026-03-24');
      const resp: SchedulePeriodResponse = {
        entries: [
          {
            entry_id: 'anchor-breakfast',
            task_type: null,
            title: 'Eggs',
            date: '2026-03-24',
            scheduled_start: '2026-03-24T08:00:00Z',
            status: 'scheduled',
            after_anchor: 'breakfast',
          },
          {
            entry_id: 'anchor-lunch',
            task_type: null,
            title: 'Salad',
            date: '2026-03-24',
            scheduled_start: '2026-03-24T12:00:00Z',
            status: 'scheduled',
            after_anchor: 'lunch',
          },
        ],
        carryover: [],
        planned_meals: [
          {
            meal_entry_id: 'pme-1',
            schedule_entry_id: 'anchor-breakfast',
            meal_ref_id: 'u1',
            meal_ref_type: 'user_meal',
            title: 'Eggs',
          },
          {
            meal_entry_id: 'pme-2',
            schedule_entry_id: 'anchor-lunch',
            meal_ref_id: 'c1',
            meal_ref_type: 'catalog_meal',
            title: 'Salad',
          },
        ],
      };
      service.loadPeriod('2026-03-24', '2026-03-24').subscribe();
      const req = httpMock.expectOne(r => r.url.includes('/schedule/period') && r.method === 'GET');
      req.flush(resp);

      const breakfast = service.scheduledMeals()['2026-03-24']?.['breakfast'];
      expect(breakfast?.mealRef).toEqual({ type: 'user', id: 'u1' });
      const lunch = service.scheduledMeals()['2026-03-24']?.['lunch'];
      expect(lunch?.mealRef).toEqual({ type: 'catalog', id: 'c1' });
    });

    it('sets mealRef to null when no planned_meals entry matches the anchor', () => {
      service.initSession('2026-03-24', '2026-03-24');
      const resp: SchedulePeriodResponse = {
        entries: [
          {
            entry_id: 'anchor-breakfast',
            task_type: null,
            title: 'Pending',
            date: '2026-03-24',
            scheduled_start: '2026-03-24T08:00:00Z',
            status: 'scheduled',
            after_anchor: 'breakfast',
          },
        ],
        carryover: [],
        planned_meals: [],
      };
      service.loadPeriod('2026-03-24', '2026-03-24').subscribe();
      const req = httpMock.expectOne(r => r.url.includes('/schedule/period') && r.method === 'GET');
      req.flush(resp);

      expect(service.scheduledMeals()['2026-03-24']?.['breakfast']?.mealRef).toBeNull();
    });
  });

  describe('commitPlan / buildCommitRequest', () => {
    it('commitPlan posts directly to /schedule/plan without waiting for suggestions', () => {
      service.initSession('2026-03-24', '2026-03-24');
      let planPosted = false;
      service.commitPlan('task-1').subscribe(() => { planPosted = true; });

      // Plan POST must fire immediately — no suggestion preloads
      const planReq = httpMock.expectOne(r => r.url.includes('/schedule/plan') && r.method === 'POST');
      planReq.flush({ committed: 3, planning_task_status: 'completed' });
      expect(planPosted).toBeTrue();
    });

    it('buildCommitRequest omits task_type from meal anchor entries', () => {
      service.initSession('2026-03-24', '2026-03-24');
      service.commitPlan('task-1').subscribe();

      const req = httpMock.expectOne(r => r.url.includes('/schedule/plan') && r.method === 'POST');
      const body = req.request.body as PostSchedulePlanRequest;
      const breakfast = body.entries.find(e => e.after_anchor === 'breakfast');
      expect(breakfast).toBeTruthy();
      expect('task_type' in breakfast!).toBeFalse();
      req.flush({ committed: 3, planning_task_status: 'completed' });
    });

    it('buildCommitRequest uses (slot) placeholder for a pending (no-entry) slot', () => {
      service.initSession('2026-03-24', '2026-03-24');
      service.commitPlan('task-1').subscribe();

      const req = httpMock.expectOne(r => r.url.includes('/schedule/plan') && r.method === 'POST');
      const body = req.request.body as PostSchedulePlanRequest;
      const breakfast = body.entries.find(e => e.after_anchor === 'breakfast');
      expect(breakfast).toBeTruthy();
      expect(breakfast!.title).toBe('(breakfast)');
      req.flush({ committed: 3, planning_task_status: 'completed' });
    });

    it('buildCommitRequest uses title from proposed meal when set', () => {
      service.initSession('2026-03-24', '2026-03-24');
      service.setMeal('2026-03-24', 'breakfast', { approvalState: 'proposed', mealRef: null, title: 'Oatmeal' });
      service.commitPlan('task-1').subscribe();

      const req = httpMock.expectOne(r => r.url.includes('/schedule/plan') && r.method === 'POST');
      const body = req.request.body as PostSchedulePlanRequest;
      const breakfast = body.entries.find(e => e.after_anchor === 'breakfast');
      expect(breakfast!.title).toBe('Oatmeal');
      req.flush({ committed: 3, planning_task_status: 'completed' });
    });

    it('buildCommitRequest includes one entry per meal pattern slot', () => {
      service.initSession('2026-03-24', '2026-03-24');
      service.commitPlan('task-1').subscribe();

      const req = httpMock.expectOne(r => r.url.includes('/schedule/plan') && r.method === 'POST');
      const body = req.request.body as PostSchedulePlanRequest;
      // Three pattern entries × one day = three meal anchor entries
      const anchors = body.entries.filter(e => e.after_anchor);
      expect(anchors.length).toBe(3);
      expect(anchors.map(a => a.after_anchor).sort()).toEqual(['breakfast', 'dinner', 'lunch']);
      req.flush({ committed: 3, planning_task_status: 'completed' });
    });

    it('buildCommitRequest uses scheduled_start from the meal pattern preferred_time', () => {
      service.initSession('2026-03-24', '2026-03-24');
      service.commitPlan('task-1').subscribe();

      const req = httpMock.expectOne(r => r.url.includes('/schedule/plan') && r.method === 'POST');
      const body = req.request.body as PostSchedulePlanRequest;
      const breakfast = body.entries.find(e => e.after_anchor === 'breakfast');
      const lunch = body.entries.find(e => e.after_anchor === 'lunch');
      const dinner = body.entries.find(e => e.after_anchor === 'dinner');
      expect(breakfast!.scheduled_start).toBe('08:00');
      expect(lunch!.scheduled_start).toBe('12:00');
      expect(dinner!.scheduled_start).toBe('18:00');
      req.flush({ committed: 3, planning_task_status: 'completed' });
    });

    it('buildCommitRequest excludes skipped meals', () => {
      service.initSession('2026-03-24', '2026-03-24');
      service.setMeal('2026-03-24', 'breakfast', { approvalState: 'skipped', mealRef: null, title: '' });
      service.commitPlan('task-1').subscribe();

      const req = httpMock.expectOne(r => r.url.includes('/schedule/plan') && r.method === 'POST');
      const body = req.request.body as PostSchedulePlanRequest;
      const breakfast = body.entries.find(e => e.after_anchor === 'breakfast');
      expect(breakfast).toBeUndefined();
      req.flush({ committed: 2, planning_task_status: 'completed' });
    });

    it('buildCommitRequest emits meal_entries for approved meals with a mealRef', () => {
      service.initSession('2026-03-24', '2026-03-24');
      service.setMealRef('2026-03-24', 'lunch', { type: 'user', id: 'u1' }, 'Greek yogurt');
      service.commitPlan('task-1').subscribe();

      const req = httpMock.expectOne(r => r.url.includes('/schedule/plan') && r.method === 'POST');
      const body = req.request.body as PostSchedulePlanRequest;
      const lunchAnchor = body.entries.find(e => e.after_anchor === 'lunch');
      expect(lunchAnchor).toBeTruthy();
      expect(lunchAnchor!.title).toBeUndefined();
      const lunchMeal = body.meal_entries.find(m => m.meal_name === 'lunch' && m.date === '2026-03-24');
      expect(lunchMeal).toBeTruthy();
      expect(lunchMeal!.meal_ref_id).toBe('u1');
      expect(lunchMeal!.meal_ref_type).toBe('user_meal');
      expect(lunchMeal!.title).toBe('Greek yogurt');
      req.flush({ committed: 3, planning_task_status: 'completed' });
    });

    it('buildCommitRequest maps catalog mealRef to catalog_meal in meal_entries', () => {
      service.initSession('2026-03-24', '2026-03-24');
      service.setMealRef('2026-03-24', 'breakfast', { type: 'catalog', id: 'c1' }, 'Oatmeal bowl');
      service.commitPlan('task-1').subscribe();

      const req = httpMock.expectOne(r => r.url.includes('/schedule/plan') && r.method === 'POST');
      const body = req.request.body as PostSchedulePlanRequest;
      const breakfastMeal = body.meal_entries.find(m => m.meal_name === 'breakfast');
      expect(breakfastMeal!.meal_ref_id).toBe('c1');
      expect(breakfastMeal!.meal_ref_type).toBe('catalog_meal');
      req.flush({ committed: 3, planning_task_status: 'completed' });
    });

    it('buildCommitRequest omits meal_entries for slots with no mealRef', () => {
      service.initSession('2026-03-24', '2026-03-24');
      service.commitPlan('task-1').subscribe();

      const req = httpMock.expectOne(r => r.url.includes('/schedule/plan') && r.method === 'POST');
      const body = req.request.body as PostSchedulePlanRequest;
      expect(body.meal_entries).toEqual([]);
      req.flush({ committed: 3, planning_task_status: 'completed' });
    });

    it('buildCommitRequest calls mealsForDate for each horizon day and uses per-date slots', () => {
      service.initSession('2026-03-24', '2026-03-25'); // two days
      // Re-configure the spy to return different slots per date
      const mock = TestBed.inject(DayTypesMealsService) as unknown as {
        mealsForDate: jasmine.Spy;
      };
      mock.mealsForDate.and.callFake((date: string) => {
        if (date === '2026-03-24') {
          return [
            { id: 'a', name: 'breakfast', preferred_time: '08:00:00', tolerance_minutes: 30, sort_order: 1, user_id: '', day_type_id: '', created_at: '', updated_at: '' },
          ];
        }
        // 2026-03-25 gets only dinner
        return [
          { id: 'b', name: 'dinner', preferred_time: '18:00:00', tolerance_minutes: 60, sort_order: 1, user_id: '', day_type_id: '', created_at: '', updated_at: '' },
        ];
      });
      service.commitPlan('task-1').subscribe();

      const req = httpMock.expectOne(r => r.url.includes('/schedule/plan') && r.method === 'POST');
      const body = req.request.body as PostSchedulePlanRequest;
      const anchors = body.entries.filter(e => e.after_anchor);
      // Day 1 → breakfast only; Day 2 → dinner only → 2 total entries
      expect(anchors.length).toBe(2);
      expect(anchors.find(e => e.date === '2026-03-24')?.after_anchor).toBe('breakfast');
      expect(anchors.find(e => e.date === '2026-03-25')?.after_anchor).toBe('dinner');
      // Verify mealsForDate was called once for each date
      expect(mock.mealsForDate).toHaveBeenCalledWith('2026-03-24');
      expect(mock.mealsForDate).toHaveBeenCalledWith('2026-03-25');
      req.flush({ committed: 2, planning_task_status: 'completed' });
    });
  });

  describe('undoSkip()', () => {
    it('should restore approvalState to proposed and preserve the original title', () => {
      service.initSession('2026-03-24', '2026-03-24');
      service.setMeal('2026-03-24', 'breakfast', { approvalState: 'proposed', mealRef: null, title: 'Oatmeal' });
      service.skipMeal('2026-03-24', 'breakfast');
      service.undoSkip('2026-03-24', 'breakfast');
      const meal = service.scheduledMeals()['2026-03-24']?.['breakfast'];
      expect(meal?.approvalState).toBe('proposed');
      expect(meal?.title).toBe('Oatmeal');
    });

    it('should be a no-op when the cell is not skipped', () => {
      service.initSession('2026-03-24', '2026-03-24');
      service.setMeal('2026-03-24', 'lunch', { approvalState: 'approved', mealRef: null, title: 'Salad' });
      service.undoSkip('2026-03-24', 'lunch');
      expect(service.scheduledMeals()['2026-03-24']?.['lunch']?.approvalState).toBe('approved');
    });
  });

  describe('applyAgentMeals()', () => {
    const AGENT_MEALS = [
      { date: '2026-03-24', meal_name: 'breakfast' as const, meal_ref: null },
      { date: '2026-03-24', meal_name: 'lunch'     as const, meal_ref: null },
    ];

    it('should overwrite a proposed cell with the agent result', () => {
      service.initSession('2026-03-24', '2026-03-24');
      service.setMeal('2026-03-24', 'breakfast', { approvalState: 'proposed', mealRef: null, title: 'Old title' });
      service.applyAgentMeals(AGENT_MEALS);
      expect(service.scheduledMeals()['2026-03-24']?.['breakfast']?.title).toBe('');
    });

    it('should NOT overwrite an approved cell', () => {
      service.initSession('2026-03-24', '2026-03-24');
      service.setMeal('2026-03-24', 'breakfast', { approvalState: 'approved', mealRef: null, title: 'User approved' });
      service.applyAgentMeals(AGENT_MEALS);
      expect(service.scheduledMeals()['2026-03-24']?.['breakfast']?.title).toBe('User approved');
    });

    it('should NOT overwrite a skipped cell', () => {
      service.initSession('2026-03-24', '2026-03-24');
      service.setMeal('2026-03-24', 'lunch', { approvalState: 'skipped', mealRef: null, title: '' });
      service.applyAgentMeals(AGENT_MEALS);
      expect(service.scheduledMeals()['2026-03-24']?.['lunch']?.approvalState).toBe('skipped');
    });

    it('should set isGenerating to false when complete', () => {
      service.initSession('2026-03-24', '2026-03-24');
      service.setGenerating(true);
      service.applyAgentMeals([]);
      expect(service.isGenerating()).toBeFalse();
    });

    it('should default title to empty string when entry has no title', () => {
      service.initSession('2026-03-24', '2026-03-24');
      service.applyAgentMeals([{ date: '2026-03-24', meal_name: 'breakfast' as const, meal_ref: null }]);
      expect(service.scheduledMeals()['2026-03-24']?.['breakfast']?.title).toBe('');
    });
  });

  describe('drop reason behavior', () => {
    beforeEach(() => {
      service.initSession('2026-03-24', '2026-03-30');
    });

    it('setDropReason selects a reason', () => {
      service.setDropReason('task-1', 'Changed priority');
      expect(service.dropReasons()['task-1']).toBe('Changed priority');
    });

    it('setDropReason toggles off when same reason re-selected', () => {
      service.setDropReason('task-1', 'No longer needed');
      service.setDropReason('task-1', 'No longer needed');
      expect(service.dropReasons()['task-1']).toBeUndefined();
    });

    it('setDropReason replaces when different reason selected', () => {
      service.setDropReason('task-1', 'Changed priority');
      service.setDropReason('task-1', 'Too difficult');
      expect(service.dropReasons()['task-1']).toBe('Too difficult');
    });

    it('setCarryoverDecision clears drop reason when decision changes away from drop', () => {
      service.setCarryoverDecision('task-1', 'drop');
      service.setDropReason('task-1', 'Not ready');
      service.setCarryoverDecision('task-1', 'carry');
      expect(service.dropReasons()['task-1']).toBeUndefined();
    });

    it('setCarryoverDecision does not clear drop reason for other entries', () => {
      service.setCarryoverDecision('task-1', 'drop');
      service.setCarryoverDecision('task-2', 'drop');
      service.setDropReason('task-1', 'Changed priority');
      service.setDropReason('task-2', 'No longer needed');
      service.setCarryoverDecision('task-1', 'carry');
      expect(service.dropReasons()['task-2']).toBe('No longer needed');
    });
  });

  describe('currentState()', () => {
    it('returns empty categorized arrays when no meals are set', () => {
      service.initSession('2026-03-24', '2026-03-24');
      const state = service.currentState();
      expect(state.approved).toEqual([]);
      expect(state.skipped).toEqual([]);
      expect(state.custom).toEqual([]);
    });

    it('puts an approved meal with mealRef into the approved array', () => {
      service.initSession('2026-03-24', '2026-03-24');
      const ref: MealRef = { type: 'catalog', id: '00000000-0000-0000-0000-000000000001' };
      service.setMeal('2026-03-24', 'breakfast', { approvalState: 'approved', mealRef: ref, title: 'Oatmeal' });
      const state = service.currentState();
      const entry = state.approved.find(m => m.meal_name === 'breakfast');
      expect(entry?.meal_ref).toEqual(ref);
      expect(state.skipped.some(s => s.meal_name === 'breakfast')).toBeFalse();
    });

    it('excludes an approved meal with null mealRef from all arrays', () => {
      service.initSession('2026-03-24', '2026-03-24');
      service.setMeal('2026-03-24', 'lunch', { approvalState: 'approved', mealRef: null, title: 'No ref yet' });
      const state = service.currentState();
      expect(state.approved.some(m => m.meal_name === 'lunch')).toBeFalse();
      expect(state.skipped.some(s => s.meal_name === 'lunch')).toBeFalse();
    });

    it('puts a skipped meal into the skipped array', () => {
      service.initSession('2026-03-24', '2026-03-24');
      service.setMeal('2026-03-24', 'dinner', { approvalState: 'proposed', mealRef: null, title: 'Pasta' });
      service.skipMeal('2026-03-24', 'dinner');
      const state = service.currentState();
      const entry = state.skipped.find(s => s.meal_name === 'dinner');
      expect(entry?.date).toBe('2026-03-24');
      expect(state.approved.some(m => m.meal_name === 'dinner')).toBeFalse();
    });
  });
});
