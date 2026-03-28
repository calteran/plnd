import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { PlanMealsStepComponent } from './plan-meals-step';
import { WeekPlanService } from '../../../../core/services/week-plan.service';

describe('PlanMealsStepComponent', () => {
  let fixture: ComponentFixture<PlanMealsStepComponent>;
  let service: WeekPlanService;
  let component: PlanMealsStepComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PlanMealsStepComponent, HttpClientTestingModule],
    }).compileComponents();
    service = TestBed.inject(WeekPlanService);
    // Mon 2026-03-23 through Fri 2026-03-27 → 5 days
    service.initSession('2026-03-23', '2026-03-27');
    fixture = TestBed.createComponent(PlanMealsStepComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => expect(component).toBeTruthy());

  it('should render one .gc cell for each day × slot (5 days × 3 slots = 15)', () => {
    const cells = fixture.nativeElement.querySelectorAll('.gc');
    expect(cells.length).toBe(15);
  });

  it('should render 5 day column headers', () => {
    const headers = fixture.nativeElement.querySelectorAll('.cell-day-header');
    expect(headers.length).toBe(5);
  });

  it('should render a slot row label for each slot', () => {
    const labels = fixture.nativeElement.querySelectorAll('.slot-lbl');
    expect(labels.length).toBe(3);
    const text = Array.from(labels).map((l) => (l as HTMLElement).textContent!.trim().toLowerCase());
    expect(text).toContain('breakfast');
    expect(text).toContain('lunch');
    expect(text).toContain('dinner');
  });

  it('should display a suggestion text in a pending cell', () => {
    const firstCell: HTMLElement = fixture.nativeElement.querySelector('.gc');
    const text = firstCell.querySelector('.gc-text');
    expect(text).toBeTruthy();
    expect(text!.textContent!.trim().length).toBeGreaterThan(0);
  });

  it('should display ✏️ Pick and 🔀 Suggest buttons in a pending cell', () => {
    const firstCell: HTMLElement = fixture.nativeElement.querySelector('.gc');
    expect(firstCell.querySelector('.gc-pick')).toBeTruthy();
    expect(firstCell.querySelector('.gc-suggest')).toBeTruthy();
  });

  it('should display the × skip button in a pending cell', () => {
    const firstCell: HTMLElement = fixture.nativeElement.querySelector('.gc');
    expect(firstCell.querySelector('.gc-x')).toBeTruthy();
  });

  it('should apply .skipped-g and show skip text when × is clicked', () => {
    const firstCell: HTMLElement = fixture.nativeElement.querySelector('.gc');
    (firstCell.querySelector('.gc-x') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(firstCell.classList.contains('skipped-g')).toBeTrue();
    expect(firstCell.querySelector('.gc-text.skip-t')).toBeTruthy();
    expect(firstCell.querySelector('.gc-undo')).toBeTruthy();
  });

  it('should restore pending state when undo is clicked on a skipped cell', () => {
    const firstCell: HTMLElement = fixture.nativeElement.querySelector('.gc');
    (firstCell.querySelector('.gc-x') as HTMLButtonElement).click();
    fixture.detectChanges();
    (firstCell.querySelector('.gc-undo') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(firstCell.classList.contains('skipped-g')).toBeFalse();
    expect(firstCell.querySelector('.gc-pick')).toBeTruthy();
  });

  it('should enter editing state and show .mock-input when ✏️ Pick is clicked', () => {
    const firstCell: HTMLElement = fixture.nativeElement.querySelector('.gc');
    (firstCell.querySelector('.gc-pick') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(firstCell.classList.contains('gc-editing')).toBeTrue();
    expect(firstCell.querySelector('.mock-input')).toBeTruthy();
    expect(firstCell.querySelector('.input-hint')).toBeTruthy();
  });

  it('should call setMeal with user_meal on Enter key and exit editing', () => {
    spyOn(service, 'setMeal');
    const firstCell: HTMLElement = fixture.nativeElement.querySelector('.gc');
    (firstCell.querySelector('.gc-pick') as HTMLButtonElement).click();
    fixture.detectChanges();
    const input = firstCell.querySelector('.mock-input') as HTMLInputElement;
    input.value = 'Greek yogurt';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    fixture.detectChanges();
    expect(service.setMeal).toHaveBeenCalledWith(
      '2026-03-23', 'breakfast', { type: 'user_meal', title: 'Greek yogurt' },
    );
    expect(firstCell.classList.contains('gc-editing')).toBeFalse();
  });

  it('should not call setMeal and should exit editing on Escape key', () => {
    spyOn(service, 'setMeal');
    const firstCell: HTMLElement = fixture.nativeElement.querySelector('.gc');
    (firstCell.querySelector('.gc-pick') as HTMLButtonElement).click();
    fixture.detectChanges();
    const input = firstCell.querySelector('.mock-input') as HTMLInputElement;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(service.setMeal).not.toHaveBeenCalled();
    expect(firstCell.querySelector('.gc-pick')).toBeTruthy();
  });

  it('should show .custom-g state when a user_meal is already set', () => {
    service.setMeal('2026-03-23', 'breakfast', { type: 'user_meal', title: 'Greek yogurt' });
    fixture.detectChanges();
    const firstCell: HTMLElement = fixture.nativeElement.querySelector('.gc');
    expect(firstCell.classList.contains('custom-g')).toBeTrue();
    const customText = firstCell.querySelector('.gc-text.custom-t');
    expect(customText).toBeTruthy();
    expect(customText!.textContent!.trim()).toBe('Greek yogurt');
    expect(firstCell.querySelector('.gc-edit-custom')).toBeTruthy();
  });

  it('should change suggestion text when 🔀 Suggest is clicked', () => {
    const firstCell: HTMLElement = fixture.nativeElement.querySelector('.gc');
    const before = firstCell.querySelector('.gc-text')!.textContent!.trim();
    (firstCell.querySelector('.gc-suggest') as HTMLButtonElement).click();
    fixture.detectChanges();
    const after = firstCell.querySelector('.gc-text')!.textContent!.trim();
    expect(after).not.toBe(before);
  });

  it('should persist the cycled suggestion to the service when 🔀 Suggest is clicked', () => {
    const firstCell: HTMLElement = fixture.nativeElement.querySelector('.gc');
    (firstCell.querySelector('.gc-suggest') as HTMLButtonElement).click();
    fixture.detectChanges();
    const stored = service.scheduledMeals()['2026-03-23']?.['breakfast'];
    expect(stored).toBeTruthy();
    expect(stored!.type).toBe('mock');
    const displayed = firstCell.querySelector('.gc-text')!.textContent!.trim();
    expect(stored!.title).toBe(displayed);
  });

  it('should pre-fill edit input with existing custom meal title', () => {
    service.setMeal('2026-03-23', 'breakfast', { type: 'user_meal', title: 'Overnight oats' });
    fixture.detectChanges();
    const firstCell: HTMLElement = fixture.nativeElement.querySelector('.gc');
    (firstCell.querySelector('.gc-edit-custom') as HTMLButtonElement).click();
    fixture.detectChanges();
    const input = firstCell.querySelector('.mock-input') as HTMLInputElement;
    expect(input.value).toBe('Overnight oats');
  });

  it('should clear custom meal back to pending when × is clicked in custom state', () => {
    spyOn(service, 'clearMeal');
    service.setMeal('2026-03-23', 'breakfast', { type: 'user_meal', title: 'Overnight oats' });
    fixture.detectChanges();
    const firstCell: HTMLElement = fixture.nativeElement.querySelector('.gc');
    (firstCell.querySelector('.gc-x') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(service.clearMeal).toHaveBeenCalledWith('2026-03-23', 'breakfast');
  });
});
