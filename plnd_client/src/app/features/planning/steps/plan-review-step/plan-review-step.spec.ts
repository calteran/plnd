import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { PlanReviewStepComponent } from './plan-review-step';
import { WeekPlanService } from '../../../../core/services/week-plan.service';

describe('PlanReviewStepComponent', () => {
  let fixture: ComponentFixture<PlanReviewStepComponent>;
  let httpMock: HttpTestingController;
  let service: WeekPlanService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PlanReviewStepComponent, HttpClientTestingModule]
    }).compileComponents();
    service = TestBed.inject(WeekPlanService);
    service.initSession('2026-03-24', '2026-03-30');
    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(PlanReviewStepComponent);
  });

  afterEach(() => httpMock.verify());

  it('should create', () => {
    fixture.detectChanges();
    httpMock.expectOne(r => r.url.includes('/schedule/period')).flush({ entries: [], carryover: [] });
    fixture.detectChanges();
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should show empty state when no carryover', () => {
    fixture.detectChanges();
    httpMock.expectOne(r => r.url.includes('/schedule/period')).flush({ entries: [], carryover: [] });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Nothing to carry over');
  });

  it('should show carryover items', () => {
    fixture.detectChanges();
    httpMock.expectOne(r => r.url.includes('/schedule/period')).flush({
      entries: [],
      carryover: [{ entry_id: 'e1', title: 'Morning walk', task_type: 'custom',
                    date: '2026-03-20', status: 'planned',
                    scheduled_start: '2026-03-20T09:00:00Z' }]
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Morning walk');
  });

  it('should call setCarryoverDecision on Defer click', () => {
    spyOn(service, 'setCarryoverDecision');
    fixture.detectChanges();
    httpMock.expectOne(r => r.url.includes('/schedule/period')).flush({
      entries: [],
      carryover: [{ entry_id: 'e1', title: 'Walk', task_type: 'custom',
                    date: '2026-03-20', status: 'planned',
                    scheduled_start: '2026-03-20T09:00:00Z' }]
    });
    fixture.detectChanges();
    const deferBtn = fixture.nativeElement.querySelector('[data-action="defer"]');
    deferBtn?.click();
    expect(service.setCarryoverDecision).toHaveBeenCalledWith('e1', 'defer');
  });
});
