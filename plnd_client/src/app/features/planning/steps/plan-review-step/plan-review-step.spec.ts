import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { PlanReviewStepComponent } from './plan-review-step';
import { WeekPlanService } from '../../../../core/services/week-plan.service';

const MOCK_ITEM = {
  entry_id: 'e1', title: 'Morning walk', task_type: 'general',
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
    service.loadCarryover('2026-03-24').subscribe();
    httpMock.expectOne(r => r.url.includes('/schedule/plan/carryover')).flush({ carryover });
    fixture.detectChanges();
  }

  it('should create', () => {
    flush();
    expect(fixture.componentInstance).toBeTruthy();
  });

  // ── Populated state ──────────────────────────────────────────────────────

  it('shows the item title', () => {
    flush([MOCK_ITEM]);
    expect(fixture.nativeElement.textContent).toContain('Morning walk');
  });

  // ── Date formatting ──────────────────────────────────────────────────────

  it('formats the date as "Mon, Mar 24" style (not raw ISO)', () => {
    flush([MOCK_ITEM]);
    const dateEl = fixture.nativeElement.querySelector('.item-date') as HTMLElement;
    // 2026-03-20 is a Friday
    expect(dateEl.textContent?.trim()).toBe('Fri, Mar 20');
  });

  // ── Decision badge default ───────────────────────────────────────────────

  it('defaults to "Carry" decision before any tap', () => {
    flush([MOCK_ITEM]);
    const badge = fixture.nativeElement.querySelector('.decision-badge') as HTMLElement;
    expect(badge.getAttribute('data-decision')).toBe('carry');
    expect(badge.textContent).toContain('Carry');
  });

  // ── Cycling behavior ─────────────────────────────────────────────────────

  it('cycles Carry → Defer on first badge tap', () => {
    spyOn(service, 'setCarryoverDecision');
    flush([MOCK_ITEM]);
    const badge: HTMLButtonElement = fixture.nativeElement.querySelector('.decision-badge');
    badge.click();
    expect(service.setCarryoverDecision).toHaveBeenCalledWith('e1', 'defer');
  });

  it('cycles Defer → Drop on second badge tap', () => {
    flush([MOCK_ITEM]);
    // Set state to defer via the real impl BEFORE spying (spy replaces without calling through)
    service.setCarryoverDecision('e1', 'defer');
    fixture.detectChanges();
    spyOn(service, 'setCarryoverDecision');
    const badge: HTMLButtonElement = fixture.nativeElement.querySelector('.decision-badge');
    badge.click();
    expect(service.setCarryoverDecision).toHaveBeenCalledWith('e1', 'drop');
  });

  it('cycles Drop → Carry on third badge tap', () => {
    flush([MOCK_ITEM]);
    service.setCarryoverDecision('e1', 'drop');
    fixture.detectChanges();
    spyOn(service, 'setCarryoverDecision');
    const badge: HTMLButtonElement = fixture.nativeElement.querySelector('.decision-badge');
    badge.click();
    expect(service.setCarryoverDecision).toHaveBeenCalledWith('e1', 'carry');
  });

  // ── Drop reason chips ────────────────────────────────────────────────────

  it('reason row is hidden when decision is not drop', () => {
    flush([MOCK_ITEM]);
    // Default decision is 'carry'
    expect(fixture.nativeElement.querySelector('.reason-row')).toBeNull();
  });

  it('reason row is shown when decision is drop', () => {
    flush([MOCK_ITEM]);
    service.setCarryoverDecision('e1', 'drop');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.reason-row')).not.toBeNull();
    const chips = fixture.nativeElement.querySelectorAll('.reason-chip') as NodeListOf<HTMLElement>;
    expect(chips.length).toBeGreaterThan(0);
  });

  it('clicking a chip calls setDropReason with correct entryId and reason', () => {
    flush([MOCK_ITEM]);
    service.setCarryoverDecision('e1', 'drop');
    fixture.detectChanges();
    spyOn(service, 'setDropReason');
    const chip: HTMLButtonElement = fixture.nativeElement.querySelector('.reason-chip');
    const expectedReason = chip.textContent?.trim() ?? '';
    chip.click();
    expect(service.setDropReason).toHaveBeenCalledWith('e1', expectedReason as Parameters<typeof service.setDropReason>[1]);
  });
});
