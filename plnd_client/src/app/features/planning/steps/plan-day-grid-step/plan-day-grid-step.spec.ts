import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { PlanDayGridStepComponent } from './plan-day-grid-step';
import { WeekPlanService } from '../../../../core/services/week-plan.service';

describe('PlanDayGridStepComponent', () => {
  let fixture: ComponentFixture<PlanDayGridStepComponent>;
  let service: WeekPlanService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PlanDayGridStepComponent, HttpClientTestingModule]
    }).compileComponents();
    service = TestBed.inject(WeekPlanService);
    service.initSession('2026-03-24', '2026-03-30');
    fixture = TestBed.createComponent(PlanDayGridStepComponent);
    fixture.detectChanges();
  });

  it('should create', () => expect(fixture.componentInstance).toBeTruthy());

  it('should render 7 day cards', () => {
    const cards = fixture.nativeElement.querySelectorAll('app-plan-day-card');
    expect(cards.length).toBe(7);
  });

  describe('signal inputs: planStart / planEnd / firstRun', () => {
    function createWithInputs(opts: {
      planStart?: string;
      planEnd?: string;
      firstRun?: boolean;
    }): ComponentFixture<PlanDayGridStepComponent> {
      service.clear();
      service.initSession('2026-03-24', '2026-03-30');
      const f = TestBed.createComponent(PlanDayGridStepComponent);
      if (opts.planStart !== undefined) f.componentRef.setInput('planStart', opts.planStart);
      if (opts.planEnd   !== undefined) f.componentRef.setInput('planEnd',   opts.planEnd);
      if (opts.firstRun  !== undefined) f.componentRef.setInput('firstRun',  opts.firstRun);
      f.detectChanges();
      return f;
    }

    it('should show no .first-run-callout by default', () => {
      expect(createWithInputs({}).nativeElement.querySelector('.first-run-callout')).toBeNull();
    });

    it('should show .first-run-callout when firstRun=true', () => {
      expect(createWithInputs({ firstRun: true }).nativeElement.querySelector('.first-run-callout')).toBeTruthy();
    });

    it('should use service horizonDays (7 cards) when inputs are not set', () => {
      expect(createWithInputs({}).nativeElement.querySelectorAll('app-plan-day-card').length).toBe(7);
    });

    it('should render 3 cards when planStart/planEnd span 3 days', () => {
      const f = createWithInputs({ planStart: '2026-03-24', planEnd: '2026-03-26' });
      expect(f.nativeElement.querySelectorAll('app-plan-day-card').length).toBe(3);
    });

    it('horizonDays() returns the overridden range', () => {
      const f = createWithInputs({ planStart: '2026-03-24', planEnd: '2026-03-26' });
      expect(f.componentInstance.horizonDays()).toEqual([
        '2026-03-24', '2026-03-25', '2026-03-26',
      ]);
    });
  });
});
