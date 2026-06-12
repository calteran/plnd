import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { MealReviewPaneComponent } from './meal-review-pane';
import { MealAnchor } from '../../../../core/models/schedule';
import { ConfigService } from '../../../../core/services/config.service';

const mockConfig = { getConfig: () => ({ api: { baseUrl: 'http://test' } }) };

const filledMeal: MealAnchor = {
  id: 'm1', name: 'Breakfast', emoji: '🥑', description: 'Avocado toast',
  status: 'planned', duringMealTasks: [],
  nutrition: { calories: 420, protein_g: 18, carbs_g: 40, fat_g: 14 },
  estimated: false,
};

const estimatedMeal: MealAnchor = {
  id: 'm2', name: 'Lunch', emoji: '🥗', description: 'Custom salad',
  status: 'planned', duringMealTasks: [],
  nutrition: { calories: 350, protein_g: 12, carbs_g: 30, fat_g: 8 },
  estimated: true,
};

const emptyMeal: MealAnchor = {
  id: 'm3', name: 'Dinner', emoji: '🍽️',
  status: 'unplanned', duringMealTasks: [],
};

const doneMeal: MealAnchor = {
  id: 'm5', name: 'Breakfast', emoji: '🥑', description: 'Avocado toast',
  status: 'done', duringMealTasks: [],
};

describe('MealReviewPaneComponent', () => {
  async function setup(meal: MealAnchor, date = '2026-04-20') {
    await TestBed.configureTestingModule({
      imports: [MealReviewPaneComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compileComponents();
    const f = TestBed.createComponent(MealReviewPaneComponent);
    f.componentRef.setInput('meal', meal);
    f.componentRef.setInput('date', date);
    f.detectChanges();
    return { f, http: TestBed.inject(HttpTestingController) };
  }

  it('shows nutrition chips for a filled meal', async () => {
    const { f } = await setup(filledMeal);
    expect(f.nativeElement.textContent).toContain('420');
    expect(f.nativeElement.textContent).toContain('18');
  });

  it('prefixes nutrition values with ~ when estimated', async () => {
    const { f } = await setup(estimatedMeal);
    const chips = f.debugElement.queryAll(By.css('.nutrition-chip'));
    expect(chips.length).toBeGreaterThan(0);
    chips.forEach(chip => expect(chip.nativeElement.textContent).toContain('~'));
  });

  it('applies dashed border class to chips when estimated', async () => {
    const { f } = await setup(estimatedMeal);
    const chips = f.debugElement.queryAll(By.css('.nutrition-chip--estimated'));
    expect(chips.length).toBeGreaterThan(0);
  });

  it('shows filled-meal action row for a planned meal', async () => {
    const { f } = await setup(filledMeal);
    expect(f.debugElement.query(By.css('[data-action="swap"]'))).toBeTruthy();
    expect(f.debugElement.query(By.css('[data-action="skip"]'))).toBeTruthy();
    expect(f.debugElement.query(By.css('[data-action="done"]'))).toBeTruthy();
  });

  it('labels the done button "Mark done" for a not-yet-completed meal', async () => {
    const { f } = await setup(filledMeal);
    const btn = f.debugElement.query(By.css('[data-action="done"]')).nativeElement;
    expect(btn.textContent).toContain('Mark done');
    expect(btn.textContent).not.toContain('Mark not done');
  });

  it('labels the done button "Mark not done" with an x for a completed meal', async () => {
    const { f } = await setup(doneMeal);
    const btn = f.debugElement.query(By.css('[data-action="done"]')).nativeElement;
    expect(btn.textContent).toContain('Mark not done');
    expect(btn.textContent).toContain('✗');
  });

  it('shows empty-meal action row for an unplanned meal', async () => {
    const { f } = await setup(emptyMeal);
    expect(f.debugElement.query(By.css('[data-action="add"]'))).toBeTruthy();
    expect(f.debugElement.query(By.css('[data-action="suggest"]'))).toBeTruthy();
  });

  it('shows text input when Swap is clicked', async () => {
    const { f } = await setup(filledMeal);
    f.debugElement.query(By.css('[data-action="swap"]')).nativeElement.click();
    f.detectChanges();
    expect(f.debugElement.query(By.css('.resolve-input'))).toBeTruthy();
  });

  it('calls resolveText when swap text submitted', async () => {
    const { f, http } = await setup(filledMeal);
    f.debugElement.query(By.css('[data-action="swap"]')).nativeElement.click();
    f.detectChanges();

    const input: HTMLInputElement = f.debugElement.query(By.css('.resolve-input')).nativeElement;
    input.value = 'Greek yogurt bowl';
    input.dispatchEvent(new Event('input'));
    f.detectChanges();

    f.debugElement.query(By.css('.resolve-submit')).nativeElement.click();
    f.detectChanges();

    const req = http.expectOne('http://test/agent/meal-plan/resolve');
    expect(req.request.body).toEqual(jasmine.objectContaining({
      text: 'Greek yogurt bowl',
      meal_name: 'breakfast',
    }));
    req.flush({ meal_ref: null, confirmation: 'Scheduled Greek yogurt bowl' });
  });

  it('passes user-defined meal name through as meal_name (no enum coercion)', async () => {
    const brunchMeal: MealAnchor = {
      id: 'm4', name: 'Brunch', emoji: '🥞', description: 'Pancakes',
      status: 'planned', duringMealTasks: [],
    };
    const { f, http } = await setup(brunchMeal);
    f.debugElement.query(By.css('[data-action="swap"]')).nativeElement.click();
    f.detectChanges();
    const input: HTMLInputElement = f.debugElement.query(By.css('.resolve-input')).nativeElement;
    input.value = 'Eggs benedict';
    input.dispatchEvent(new Event('input'));
    f.detectChanges();
    f.debugElement.query(By.css('.resolve-submit')).nativeElement.click();
    f.detectChanges();

    const req = http.expectOne('http://test/agent/meal-plan/resolve');
    expect(req.request.body).toEqual(jasmine.objectContaining({
      meal_name: 'brunch',
    }));
    req.flush({ meal_ref: null, confirmation: 'ok' });
  });

  it('emits closed after successful swap', async () => {
    const { f, http } = await setup(filledMeal);
    let closed = false;
    f.componentInstance.closed.subscribe(() => closed = true);

    f.debugElement.query(By.css('[data-action="swap"]')).nativeElement.click();
    f.detectChanges();
    const input: HTMLInputElement = f.debugElement.query(By.css('.resolve-input')).nativeElement;
    input.value = 'Greek yogurt bowl';
    input.dispatchEvent(new Event('input'));
    f.detectChanges();
    f.debugElement.query(By.css('.resolve-submit')).nativeElement.click();
    f.detectChanges();

    http.expectOne('http://test/agent/meal-plan/resolve').flush({
      meal_ref: null, confirmation: 'Done'
    });
    f.detectChanges();
    expect(closed).toBeTrue();
  });
});
