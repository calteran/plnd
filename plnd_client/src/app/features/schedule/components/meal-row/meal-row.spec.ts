import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MealRowComponent } from './meal-row';
import { MealAnchor } from '../../../../core/models/schedule';

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
    { id: 'dt1', type: 'task', label: '💊 Vitamins', status: 'pending' }
  ]
};

describe('MealRowComponent', () => {
  async function setup(meal: MealAnchor) {
    await TestBed.configureTestingModule({ imports: [MealRowComponent] }).compileComponents();
    const f = TestBed.createComponent(MealRowComponent);
    f.componentRef.setInput('meal', meal);
    f.detectChanges();
    return f;
  }

  it('renders meal name and emoji', async () => {
    const f = await setup(doneMeal);
    expect(f.nativeElement.textContent).toContain('Breakfast');
    expect(f.nativeElement.textContent).toContain('🥑');
  });

  it('renders description when provided', async () => {
    const f = await setup(doneMeal);
    expect(f.nativeElement.textContent).toContain('Avocado toast');
  });

  it('shows Done badge for completed meal', async () => {
    const f = await setup(doneMeal);
    expect(f.nativeElement.textContent).toContain('Done');
  });

  it('shows Plan button for unplanned meal', async () => {
    const f = await setup(unplanned);
    const btn = f.debugElement.query(By.css('.badge--plan'));
    expect(btn).toBeTruthy();
  });

  it('emits planMeal when Plan button clicked', async () => {
    const f = await setup(unplanned);
    let emitted: string | undefined;
    f.componentInstance.planMeal.subscribe((id: string) => emitted = id);
    f.debugElement.query(By.css('.badge--plan')).nativeElement.click();
    expect(emitted).toBe('m2');
  });

  it('renders during-meal tasks inside the band', async () => {
    const f = await setup(withTasks);
    const taskRows = f.debugElement.queryAll(By.css('app-task-row'));
    expect(taskRows.length).toBe(1);
  });

  it('emits toggle when a during-meal task checkbox fires', async () => {
    const f = await setup(withTasks);
    let emitted: string | undefined;
    f.componentInstance.toggle.subscribe((id: string) => emitted = id);
    f.debugElement.query(By.css('app-task-row .checkbox')).nativeElement.click();
    expect(emitted).toBe('dt1');
  });
});
