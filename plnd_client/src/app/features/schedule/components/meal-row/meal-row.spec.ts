import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { CdkDrag, type CdkDragStart, type CdkDragEnd } from '@angular/cdk/drag-drop';
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
    expect(checkbox.checked).toBe(true);
  });

  it('shows done checkbox unchecked for an unplanned meal', async () => {
    const f = await setup(unplanned);
    const checkbox: HTMLInputElement = f.debugElement.query(By.css('.done-checkbox')).nativeElement;
    expect(checkbox.checked).toBe(false);
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

  // Re-emitting CDK's drag lifecycle lets the day view open the floating-task
  // slot gaps while a *during-meal* task is being dragged (its target may be an
  // empty slot). This wiring has no other automated coverage — the slot-gap e2e
  // drags a slot task, not a meal task — so guard the re-emit here.
  it('re-emits dragStarted/dragEnded from a during-meal task drag', async () => {
    const f = await setup(withTasks);
    const drag = f.debugElement.query(By.directive(CdkDrag)).injector.get(CdkDrag);
    let started = false;
    let ended = false;
    f.componentInstance.dragStarted.subscribe(() => started = true);
    f.componentInstance.dragEnded.subscribe(() => ended = true);

    drag.started.emit({ source: drag } as unknown as CdkDragStart);
    expect(started).toBe(true);

    drag.ended.emit({ source: drag } as unknown as CdkDragEnd);
    expect(ended).toBe(true);
  });

  it('hosts the task-edit form for the during-meal task named by editingId', async () => {
    const f = await setup(withTasks);
    expect(f.debugElement.query(By.css('app-task-edit-form'))).toBeNull();
    f.componentRef.setInput('editingId', 'dt1');
    f.detectChanges();
    expect(f.debugElement.query(By.css('app-task-edit-form'))).toBeTruthy();
  });

  it('does not host the edit form when editingId names a different task', async () => {
    const f = await setup(withTasks);
    f.componentRef.setInput('editingId', 'other');
    f.detectChanges();
    expect(f.debugElement.query(By.css('app-task-edit-form'))).toBeNull();
  });

  it('re-emits editRequested from a during-meal task row', async () => {
    const f = await setup(withTasks);
    let emitted: string | undefined;
    f.componentInstance.editRequested.subscribe((id: string) => emitted = id);
    f.debugElement.query(By.css('app-task-row .label')).nativeElement.click();
    expect(emitted).toBe('dt1');
  });

  it('re-emits closed when the hosted edit form closes', async () => {
    const f = await setup(withTasks);
    f.componentRef.setInput('editingId', 'dt1');
    f.detectChanges();
    let closed = false;
    f.componentInstance.closed.subscribe(() => closed = true);
    f.debugElement.query(By.css('app-task-edit-form'))
      .triggerEventHandler('closed', undefined);
    expect(closed).toBe(true);
  });

  it('dims and inerts sibling during-meal tasks while one is being edited', async () => {
    const twoTasks: MealAnchor = {
      id: 'm5', name: 'Lunch', emoji: '🥗', status: 'planned',
      duringMealTasks: [
        { id: 'dt1', type: 'general', label: 'Vitamins', status: 'pending', oneShot: false, floating: false },
        { id: 'dt2', type: 'general', label: 'Water', status: 'pending', oneShot: false, floating: false },
      ],
    };
    const f = await setup(twoTasks);
    f.componentRef.setInput('editingId', 'dt1');
    f.detectChanges();
    const rows = f.debugElement.queryAll(By.css('app-task-row'));
    const [edited, sibling] = rows.map(r => r.nativeElement as HTMLElement);
    expect(edited.classList).not.toContain('dimmed');   // the edited task stays lit
    expect(edited.hasAttribute('inert')).toBe(false);
    expect(sibling.classList).toContain('dimmed');       // its sibling is spotlit out
    expect(sibling.hasAttribute('inert')).toBe(true);
  });

  it('does not dim during-meal tasks when the edit target is outside this meal', async () => {
    const f = await setup(withTasks);
    f.componentRef.setInput('editingId', 'top-level-task');
    f.detectChanges();
    const row = f.debugElement.query(By.css('app-task-row')).nativeElement as HTMLElement;
    // The day view dims the whole meal-row host in this case; dimming here too
    // would stack opacity, so the nested row must stay un-dimmed.
    expect(row.classList).not.toContain('dimmed');
    expect(row.hasAttribute('inert')).toBe(false);
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
