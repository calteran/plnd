import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { PlanReviewStepComponent } from './plan-review-step';
import { WeekPlanService } from '../../../../core/services/week-plan.service';

const MOCK_ITEM = {
  entry_id: 'e1', title: 'Morning walk', task_type: 'custom',
  date: '2026-03-20', status: 'planned',
  scheduled_start: '2026-03-20T09:00:00Z'
};

describe('PlanReviewStepComponent', () => {
  let fixture: ComponentFixture<PlanReviewStepComponent>;
  let httpMock: HttpTestingController;
  let service: WeekPlanService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PlanReviewStepComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()]
    }).compileComponents();
    service = TestBed.inject(WeekPlanService);
    service.initSession('2026-03-24', '2026-03-30');
    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(PlanReviewStepComponent);
  });

  afterEach(() => httpMock.verify());

  function flush(carryover: typeof MOCK_ITEM[] = []) {
    fixture.detectChanges();
    httpMock.expectOne(r => r.url.includes('/schedule/period')).flush({ entries: [], carryover });
    fixture.detectChanges();
  }

  it('should create', () => {
    flush();
    expect(fixture.componentInstance).toBeTruthy();
  });

  // ── Empty state ──────────────────────────────────────────────────────────

  it('shows "All caught up!" when there are no carryover items', () => {
    flush([]);
    expect(fixture.nativeElement.textContent).toContain('All caught up!');
  });

  it('does not show the carryover list when empty', () => {
    flush([]);
    expect(fixture.nativeElement.querySelector('.carryover-list')).toBeNull();
  });

  // ── Populated state ──────────────────────────────────────────────────────

  it('shows the item title', () => {
    flush([MOCK_ITEM]);
    expect(fixture.nativeElement.textContent).toContain('Morning walk');
  });

  it('does not show the empty state when items exist', () => {
    flush([MOCK_ITEM]);
    expect(fixture.nativeElement.querySelector('.empty-state')).toBeNull();
  });

  // ── Date formatting ──────────────────────────────────────────────────────

  it('formats the date as "Mon, Mar 24" style (not raw ISO)', () => {
    flush([MOCK_ITEM]);
    const dateEl = fixture.nativeElement.querySelector('.item-date') as HTMLElement;
    // 2026-03-20 is a Friday
    expect(dateEl.textContent?.trim()).toBe('Fri, Mar 20');
  });

  // ── Decision badge default ───────────────────────────────────────────────

  it('defaults to "Accept" decision before any tap', () => {
    flush([MOCK_ITEM]);
    const badge = fixture.nativeElement.querySelector('.decision-badge') as HTMLElement;
    expect(badge.getAttribute('data-decision')).toBe('accept');
    expect(badge.textContent).toContain('Accept');
  });

  // ── Cycling behavior ─────────────────────────────────────────────────────

  it('cycles Accept → Defer on first badge tap', () => {
    spyOn(service, 'setCarryoverDecision');
    flush([MOCK_ITEM]);
    const badge: HTMLButtonElement = fixture.nativeElement.querySelector('.decision-badge');
    badge.click();
    expect(service.setCarryoverDecision).toHaveBeenCalledWith('e1', 'defer');
  });

  it('cycles Defer → Dismiss on second badge tap', () => {
    flush([MOCK_ITEM]);
    // Set state to defer via the real impl BEFORE spying (spy replaces without calling through)
    service.setCarryoverDecision('e1', 'defer');
    fixture.detectChanges();
    spyOn(service, 'setCarryoverDecision');
    const badge: HTMLButtonElement = fixture.nativeElement.querySelector('.decision-badge');
    badge.click();
    expect(service.setCarryoverDecision).toHaveBeenCalledWith('e1', 'dismiss');
  });

  it('cycles Dismiss → Accept on third badge tap', () => {
    flush([MOCK_ITEM]);
    service.setCarryoverDecision('e1', 'dismiss');
    fixture.detectChanges();
    spyOn(service, 'setCarryoverDecision');
    const badge: HTMLButtonElement = fixture.nativeElement.querySelector('.decision-badge');
    badge.click();
    expect(service.setCarryoverDecision).toHaveBeenCalledWith('e1', 'accept');
  });
});
