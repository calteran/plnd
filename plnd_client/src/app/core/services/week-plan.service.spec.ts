import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { WeekPlanService } from './week-plan.service';
import { PostSchedulePlanRequest, SKIP_SENTINEL } from '../models/week-plan';

describe('WeekPlanService', () => {
  let service: WeekPlanService;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
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
    expect(service.currentStep()).toBe(3);
  });

  it('should not restore draft when plan_start does not match', () => {
    const draft = {
      schemaVersion: 1,
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
    service.setMeal('2026-03-24', 'breakfast', { type: 'mock', title: 'Oatmeal' });
    expect(service.scheduledMeals()['2026-03-24']?.['breakfast']?.title).toBe('Oatmeal');
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
      service.addFloatingTask({ title: 'Call dentist', energy: 'low', task_type: 'custom' });
      expect(service.floatingTasks().length).toBe(1);
      expect(service.floatingTasks()[0].title).toBe('Call dentist');
    });

    it('should remove a task by index via removeFloatingTask', () => {
      service.addFloatingTask({ title: 'Task A', energy: 'low', task_type: 'custom' });
      service.addFloatingTask({ title: 'Task B', energy: 'medium', task_type: 'custom' });
      service.removeFloatingTask(0);
      expect(service.floatingTasks().length).toBe(1);
      expect(service.floatingTasks()[0].title).toBe('Task B');
    });

    it('should include floatingTasks in saveDraft', () => {
      service.initSession('2026-03-24', '2026-03-30');
      service.addFloatingTask({ title: 'Call dentist', energy: 'low', task_type: 'custom' });
      service.saveDraft();
      const draft = service.loadDraft();
      expect(draft?.floatingTasks?.length).toBe(1);
      expect(draft?.floatingTasks?.[0].title).toBe('Call dentist');
    });

    it('should restore floatingTasks from draft on initSession', () => {
      const draft = {
        schemaVersion: 1 as const,
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
        schemaVersion: 1,
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

  it('buildCommitRequest includes mock suggestion for a pending (no-entry) slot', () => {
    service.initSession('2026-03-24', '2026-03-24'); // single day
    // No explicit meal set — all slots are pending
    service.commitPlan('task-1').subscribe();
    const req = httpMock.expectOne(r => r.url.includes('/schedule/plan') && r.method === 'POST');
    const body = req.request.body as PostSchedulePlanRequest;
    const breakfast = body.entries.find(
      e => e.date === '2026-03-24' && e.after_milepost === 'breakfast',
    );
    expect(breakfast).toBeTruthy();
    expect(breakfast!.title).toBeTruthy(); // mock suggestion title present
    expect(breakfast!.task_type).toBe('meal');
    req.flush({ committed: 3, planning_task_status: 'completed' });
  });

  it('buildCommitRequest excludes slots with __skipped__ sentinel', () => {
    service.initSession('2026-03-24', '2026-03-24');
    service.setMeal('2026-03-24', 'breakfast', { type: 'mock', title: SKIP_SENTINEL });
    service.commitPlan('task-1').subscribe();
    const req = httpMock.expectOne(r => r.url.includes('/schedule/plan') && r.method === 'POST');
    const body = req.request.body as PostSchedulePlanRequest;
    const breakfast = body.entries.find(
      e => e.date === '2026-03-24' && e.after_milepost === 'breakfast',
    );
    expect(breakfast).toBeUndefined();
    req.flush({ committed: 2, planning_task_status: 'completed' });
  });

  it('buildCommitRequest includes user_meal entries as-is', () => {
    service.initSession('2026-03-24', '2026-03-24');
    service.setMeal('2026-03-24', 'lunch', { type: 'user_meal', title: 'Greek yogurt' });
    service.commitPlan('task-1').subscribe();
    const req = httpMock.expectOne(r => r.url.includes('/schedule/plan') && r.method === 'POST');
    const body = req.request.body as PostSchedulePlanRequest;
    const lunch = body.entries.find(
      e => e.date === '2026-03-24' && e.after_milepost === 'lunch',
    );
    expect(lunch).toBeTruthy();
    expect(lunch!.task_ref_type).toBe('user_meal');
    expect(lunch!.title).toBeUndefined(); // title omitted for user_meal
    req.flush({ committed: 3, planning_task_status: 'completed' });
  });
});
