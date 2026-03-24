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
});
