import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { PlanningWizardComponent } from './planning-wizard';

describe('PlanningWizardComponent', () => {
  let fixture: ComponentFixture<PlanningWizardComponent>;

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [PlanningWizardComponent, HttpClientTestingModule, RouterTestingModule]
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

  it('should render all 5 step labels', () => {
    const labels = fixture.nativeElement.querySelectorAll('.pill-label');
    const texts = Array.from(labels).map((el: any) => el.textContent.trim());
    expect(texts).toEqual(['Carryover', 'Tasks', 'Meals', 'Review', 'Confirm']);
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
