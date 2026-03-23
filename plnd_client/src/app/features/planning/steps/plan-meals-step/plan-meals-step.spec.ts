import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { PlanMealsStepComponent } from './plan-meals-step';
import { WeekPlanService } from '../../../../core/services/week-plan.service';

describe('PlanMealsStepComponent', () => {
  let fixture: ComponentFixture<PlanMealsStepComponent>;
  let service: WeekPlanService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PlanMealsStepComponent, HttpClientTestingModule]
    }).compileComponents();
    service = TestBed.inject(WeekPlanService);
    service.initSession('2026-03-24', '2026-03-30');
    fixture = TestBed.createComponent(PlanMealsStepComponent);
    fixture.detectChanges();
  });

  it('should create', () => expect(fixture.componentInstance).toBeTruthy());

  it('should show meal slots for each day', () => {
    const slots = fixture.nativeElement.querySelectorAll('.meal-slot');
    // 7 days × 3 slots (B/L/D) = 21 minimum
    expect(slots.length).toBeGreaterThanOrEqual(21);
  });

  it('should pre-populate mock suggestions', () => {
    const firstSuggestion = fixture.nativeElement.querySelector('.meal-suggestion');
    expect(firstSuggestion?.textContent?.trim().length).toBeGreaterThan(0);
  });

  it('should call setMeal when Accept is clicked', () => {
    spyOn(service, 'setMeal');
    const acceptBtn = fixture.nativeElement.querySelector('[data-action="accept"]');
    acceptBtn?.click();
    expect(service.setMeal).toHaveBeenCalled();
  });
});
