import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { WeekPlanService } from './week-plan.service';
import { PostSchedulePlanRequest } from '../models/week-plan';

describe('WeekPlanService', () => {
  let service: WeekPlanService;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
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
      const breakfast = body.entries.find(e => e.after_milepost === 'breakfast');
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

    it('buildCommitRequest includes an explicit snack entry', () => {
      service.initSession('2026-03-24', '2026-03-24');
      service.setMeal('2026-03-24', 'snack', { approvalState: 'approved', mealRef: null, title: 'Apple' });
      service.commitPlan('task-1').subscribe();

      const req = httpMock.expectOne(r => r.url.includes('/schedule/plan') && r.method === 'POST');
      const body = req.request.body as PostSchedulePlanRequest;
      const snack = body.entries.find(e => e.after_anchor === 'snack');
      expect(snack).toBeTruthy();
      expect(snack!.title).toBe('Apple');
      req.flush({ committed: 4, planning_task_status: 'completed' });
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

    it('buildCommitRequest uses task_ref_id and type for approved meals with a mealRef', () => {
      service.initSession('2026-03-24', '2026-03-24');
      service.setMealRef('2026-03-24', 'lunch', { type: 'user', id: 'u1' }, 'Greek yogurt');
      service.commitPlan('task-1').subscribe();

      const req = httpMock.expectOne(r => r.url.includes('/schedule/plan') && r.method === 'POST');
      const body = req.request.body as PostSchedulePlanRequest;
      const lunch = body.entries.find(e => e.after_anchor === 'lunch');
      expect(lunch).toBeTruthy();
      expect(lunch!.task_ref_id).toBe('u1');
      expect(lunch!.task_ref_type).toBe('user');
      expect(lunch!.title).toBeUndefined();
      req.flush({ committed: 3, planning_task_status: 'completed' });
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
      { date: '2026-03-24', occasion: 'breakfast' as const, meal_ref: null },
      { date: '2026-03-24', occasion: 'lunch'     as const, meal_ref: null },
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
      service.applyAgentMeals([{ date: '2026-03-24', occasion: 'breakfast' as const, meal_ref: null }]);
      expect(service.scheduledMeals()['2026-03-24']?.['breakfast']?.title).toBe('');
    });
  });

  describe('currentState()', () => {
    it('returns a MealPlanState with all horizon days × standard slots', () => {
      service.initSession('2026-03-24', '2026-03-24');
      const state = service.currentState();
      expect(state.week_start).toBe('2026-03-24');
      expect(state.meals.length).toBe(3); // 1 day × 3 slots
    });

    it('marks an approved meal correctly in currentState', () => {
      service.initSession('2026-03-24', '2026-03-24');
      service.approveMeal('2026-03-24', 'breakfast');
      // approveMeal on a non-existent cell is a no-op; pre-seed first
      service.setMeal('2026-03-24', 'breakfast', { approvalState: 'proposed', mealRef: null, title: 'Oatmeal' });
      service.approveMeal('2026-03-24', 'breakfast');
      const state = service.currentState();
      const entry = state.meals.find(m => m.occasion === 'breakfast');
      expect(entry?.approved).toBeTrue();
      expect(entry?.skipped).toBeFalse();
    });

    it('marks a skipped meal correctly in currentState', () => {
      service.initSession('2026-03-24', '2026-03-24');
      service.setMeal('2026-03-24', 'dinner', { approvalState: 'proposed', mealRef: null, title: 'Pasta' });
      service.skipMeal('2026-03-24', 'dinner');
      const state = service.currentState();
      const entry = state.meals.find(m => m.occasion === 'dinner');
      expect(entry?.skipped).toBeTrue();
      expect(entry?.approved).toBeFalse();
    });
  });
});
