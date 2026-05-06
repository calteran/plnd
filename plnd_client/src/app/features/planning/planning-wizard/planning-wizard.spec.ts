import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { PlanningWizardComponent } from './planning-wizard';

describe('PlanningWizardComponent', () => {
  let fixture: ComponentFixture<PlanningWizardComponent>;

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [PlanningWizardComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])]
    }).compileComponents();
    fixture = TestBed.createComponent(PlanningWizardComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should show a progress bar', () => {
    const bar = fixture.nativeElement.querySelector('.wizard-progress');
    expect(bar).toBeTruthy();
  });

  it('should show Back button when step > 1', () => {
    fixture.componentInstance.weekPlanService.goToStep(2);
    fixture.detectChanges();
    const back = fixture.nativeElement.querySelector('.nav-btn--back');
    expect(back).toBeTruthy();
  });

  it('should not show Back button on step 1', () => {
    const back = fixture.nativeElement.querySelector('.nav-btn--back');
    expect(back).toBeFalsy();
  });

  it('should render all 6 step labels', () => {
    const labels = fixture.nativeElement.querySelectorAll('.pill-label');
    const texts = Array.from(labels as HTMLElement[]).map((el) => el.textContent?.trim());
    expect(texts).toEqual(['Carryover', 'Tasks', 'Meals', 'Exercise', 'Review', 'Confirm']);
  });

  it('should mark the Exercise step pill as disabled', () => {
    const pills = fixture.nativeElement.querySelectorAll('.progress-pill');
    // Exercise is step 4, zero-indexed as pills[3]
    expect(pills[3].classList).toContain('disabled');
  });

  it('next() from step 3 skips disabled step 4 and lands on step 5', () => {
    fixture.componentInstance.weekPlanService.goToStep(3);
    fixture.detectChanges();
    fixture.componentInstance.next();
    expect(fixture.componentInstance.weekPlanService.currentStep()).toBe(5);
  });

  it('back() from step 5 skips disabled step 4 and lands on step 3', () => {
    fixture.componentInstance.weekPlanService.goToStep(5);
    fixture.detectChanges();
    fixture.componentInstance.back();
    expect(fixture.componentInstance.weekPlanService.currentStep()).toBe(3);
  });

  it('should mark step 1 as active on init', () => {
    const pills = fixture.nativeElement.querySelectorAll('.progress-pill');
    expect(pills[0].classList).toContain('active');
    expect(pills[1].classList).not.toContain('active');
  });

  it('should mark step 1 as done and step 2 as active when on step 2', () => {
    fixture.componentInstance.weekPlanService.goToStep(2);
    fixture.detectChanges();
    const pills = fixture.nativeElement.querySelectorAll('.progress-pill');
    expect(pills[0].classList).toContain('done');
    expect(pills[1].classList).toContain('active');
  });
});
