import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { MealRowComponent } from './meal-row';
import { MealAnchor } from '../../../../core/models/schedule';
import { ConfigService } from '../../../../core/services/config.service';

const mockConfig = { getConfig: () => ({ api: { baseUrl: 'http://test' } }) };

const doneMeal: MealAnchor = {
  id: 'm1', name: 'Breakfast', emoji: '🥑',
  description: 'Avocado toast', status: 'done', duringMealTasks: []
};
const unplanned: MealAnchor = {
  id: 'm2', name: 'Lunch', emoji: '🥗',
  status: 'unplanned', duringMealTasks: []
};
const withTasks: MealAnchor = {
  id: 'm3', name: 'Breakfast', emoji: '🥑', status: 'planned',
  duringMealTasks: [
    { id: 'dt1', type: 'general', label: '💊 Vitamins', status: 'pending', oneShot: false, floating: false }
  ]
};
const skippedMeal: MealAnchor = {
  id: 'm4', name: 'Dinner', emoji: '🍽',
  status: 'skipped', duringMealTasks: []
};

async function setup(meal: MealAnchor, date = '2026-04-20') {
  await TestBed.configureTestingModule({
    imports: [MealRowComponent],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: ConfigService, useValue: mockConfig },
    ],
  }).compileComponents();
  const f = TestBed.createComponent(MealRowComponent);
  f.componentRef.setInput('meal', meal);
  f.componentRef.setInput('date', date);
  f.detectChanges();
  return f;
}

describe('MealRowComponent', () => {
  it('renders meal name and emoji', async () => {
    const f = await setup(doneMeal);
    expect(f.nativeElement.textContent).toContain('Breakfast');
    expect(f.nativeElement.textContent).toContain('🥑');
  });

  it('renders description when provided', async () => {
    const f = await setup(doneMeal);
    expect(f.nativeElement.textContent).toContain('Avocado toast');
  });

  it('shows done checkbox checked for a done meal', async () => {
    const f = await setup(doneMeal);
    const checkbox: HTMLInputElement = f.debugElement.query(By.css('.done-checkbox')).nativeElement;
    expect(checkbox.checked).toBeTrue();
  });

  it('shows done checkbox unchecked for an unplanned meal', async () => {
    const f = await setup(unplanned);
    const checkbox: HTMLInputElement = f.debugElement.query(By.css('.done-checkbox')).nativeElement;
    expect(checkbox.checked).toBeFalse();
  });

  it('emits doneToggle when checkbox clicked without opening the pane', async () => {
    const f = await setup(doneMeal);
    let emitted: string | undefined;
    f.componentInstance.doneToggle.subscribe((id: string) => emitted = id);
    f.debugElement.query(By.css('.done-checkbox')).nativeElement.click();
    f.detectChanges();
    expect(emitted).toBe('m1');
    expect(f.debugElement.query(By.css('app-meal-review-pane'))).toBeNull();
  });

  it('shows Review button', async () => {
    const f = await setup(unplanned);
    expect(f.debugElement.query(By.css('.review-btn'))).toBeTruthy();
  });

  it('opens review pane when Review button clicked', async () => {
    const f = await setup(unplanned);
    f.debugElement.query(By.css('.review-btn')).nativeElement.click();
    f.detectChanges();
    expect(f.debugElement.query(By.css('app-meal-review-pane'))).toBeTruthy();
  });

  it('closes review pane when closePane() is called', async () => {
    const f = await setup(unplanned);
    f.debugElement.query(By.css('.review-btn')).nativeElement.click();
    f.detectChanges();
    f.componentInstance.closePane();
    f.detectChanges();
    expect(f.debugElement.query(By.css('app-meal-review-pane'))).toBeNull();
  });

  it('renders during-meal tasks inside the band', async () => {
    const f = await setup(withTasks);
    const taskRows = f.debugElement.queryAll(By.css('app-task-row'));
    expect(taskRows.length).toBe(1);
  });

  it('emits toggled when a during-meal task fires', async () => {
    const f = await setup(withTasks);
    let emitted: string | undefined;
    f.componentInstance.toggled.subscribe((id: string) => emitted = id);
    f.debugElement.query(By.css('app-task-row .checkbox')).nativeElement.click();
    expect(emitted).toBe('dt1');
  });

  it('applies the skipped modifier class for a skipped meal', async () => {
    const f = await setup(skippedMeal);
    const band = f.debugElement.query(By.css('.meal-band')).nativeElement as HTMLElement;
    expect(band.classList).toContain('meal-band--skipped');
  });

  it('does not apply the skipped modifier for a done meal', async () => {
    const f = await setup(doneMeal);
    const band = f.debugElement.query(By.css('.meal-band')).nativeElement as HTMLElement;
    expect(band.classList).not.toContain('meal-band--skipped');
  });
});
