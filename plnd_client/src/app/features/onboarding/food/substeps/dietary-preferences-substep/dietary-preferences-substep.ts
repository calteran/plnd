import { Component, EventEmitter, Output, inject, signal } from '@angular/core';
import { from, mergeMap } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { DietaryRestrictionsService } from '../../../../../core/services/dietary-restrictions.service';
import { UserMealsService } from '../../../../../core/services/user-meals.service';

const EMOJIS = ['😖', '😕', '😐', '🙂', '😍'] as const;

const LIFESTYLE_GROUPS: { group: string; items: { key: string; emoji: string; label: string; tooltip: string }[] }[] = [
  {
    group: 'Plant-based',
    items: [
      { key: 'lacto_vegetarian',  emoji: '🥛', label: 'Lacto-vegetarian',       tooltip: 'Vegetarian diet that includes dairy products but excludes eggs and meat.' },
      { key: 'ovo_vegetarian',    emoji: '🥚', label: 'Ovo-vegetarian',         tooltip: 'Vegetarian diet that includes eggs but excludes dairy and meat.' },
      { key: 'pescatarian',       emoji: '🐟', label: 'Pescatarian',            tooltip: 'Plant-based diet that includes fish and seafood.' },
      { key: 'vegan',             emoji: '🌿', label: 'Vegan',                  tooltip: 'Excludes all animal products including dairy, eggs, and honey.' },
      { key: 'vegetarian',        emoji: '🌱', label: 'Vegetarian',             tooltip: 'No meat or fish; may include dairy and eggs.' },
      { key: 'whole_food_plant',  emoji: '🥦', label: 'Whole food plant-based', tooltip: 'Emphasizes whole, minimally processed plant foods.' },
    ],
  },
  {
    group: 'Dietary patterns',
    items: [
      { key: 'dash',          emoji: '🫀', label: 'DASH',          tooltip: 'Dietary Approaches to Stop Hypertension; low sodium, high potassium.' },
      { key: 'low_carb',      emoji: '🥑', label: 'Low-carb',      tooltip: 'Reduces carbohydrate intake, often below 100g/day.' },
      { key: 'mediterranean', emoji: '🫒', label: 'Mediterranean', tooltip: 'Emphasizes vegetables, legumes, whole grains, olive oil, and fish.' },
      { key: 'paleo',         emoji: '🥩', label: 'Paleo',         tooltip: 'Focuses on foods presumed available to pre-agricultural humans.' },
    ],
  },
  {
    group: 'Religious / Cultural',
    items: [
      { key: 'halal',  emoji: '☪️', label: 'Halal',  tooltip: 'Permitted under Islamic dietary law; excludes pork and alcohol.' },
      { key: 'kosher', emoji: '✡️', label: 'Kosher', tooltip: 'Complies with Jewish dietary law; separates meat and dairy.' },
    ],
  },
  {
    group: 'Avoidance',
    items: [
      { key: 'gluten_free', emoji: '🌾', label: 'Gluten-free', tooltip: 'Excludes gluten-containing grains (wheat, barley, rye).' },
    ],
  },
];

@Component({
  selector: 'app-dietary-preferences-substep',
  standalone: true,
  imports: [],
  template: `
    <div class="prefs-substep">
      <div class="banner">Your choices here reflect your tastes and practices, and will be considered when planning your meals.</div>

      <!-- Lifestyle section -->
      <section class="section">
        <button type="button" class="section-header" (click)="lifestyleExpanded.set(!lifestyleExpanded())">
          <span>Lifestyle</span>
          <span>{{ lifestyleExpanded() ? '▲' : '▼' }}</span>
        </button>

        @if (!lifestyleExpanded() && selectedLifestyles().length) {
          <div class="selected-chips">
            @for (key of selectedLifestyles(); track key) {
              <span class="chip chip--amber">
                {{ labelFor(key) }}
                <button type="button" (click)="toggleLifestyle(key)">✕</button>
              </span>
            }
            <button type="button" class="chip chip--muted" (click)="lifestyleExpanded.set(true)">+ Add more</button>
          </div>
        }

        @if (lifestyleExpanded()) {
          <div class="lifestyle-expanded">
            @for (grp of lifestyleGroups; track grp.group) {
              <div class="group">
                <div class="group-label">{{ grp.group }}</div>
                <div class="chip-row">
                  @for (item of grp.items; track item.key) {
                    <button type="button" class="chip"
                      [class.chip--amber]="selectedLifestyles().includes(item.key)"
                      [title]="item.tooltip"
                      (click)="toggleLifestyle(item.key)"
                    >{{ item.emoji }} {{ item.label }}</button>
                  }
                </div>
              </div>
            }
            <div class="custom-add">
              <span class="field-label">Add your own</span>
              <div class="row">
                <input type="text" class="text-input" placeholder="e.g. low FODMAP, raw food…"
                  [value]="customLifestyleInput()"
                  (input)="customLifestyleInput.set(asText($event))" />
                <button type="button" class="btn-add" (click)="addCustomLifestyle()">Add</button>
              </div>
            </div>
          </div>
        }
      </section>

      <!-- Ingredient Ratings -->
      <section class="section">
        <div class="section-header-static">Ingredient Ratings</div>
        <div class="legend">hate — meh — love</div>
        <div class="rating-entry-row">
          <input type="text" class="text-input flex-1" placeholder="Ingredient…"
            [value]="ingredientInput()"
            (input)="ingredientInput.set(asText($event))" />
          <div class="emoji-row">
            @for (e of emojis; track $index) {
              <button type="button" class="emoji-btn"
                [class.emoji-btn--selected]="pendingIngredientScore() === $index"
                (click)="pendingIngredientScore.set($index)"
              >{{ e }}</button>
            }
          </div>
          <button type="button" class="btn-add" (click)="addIngredientRating()">Add</button>
        </div>
        @for (r of ingredientRatings(); track r.name) {
          <div class="rated-row">
            <span class="rated-name flex-1">
              <button type="button" class="btn-remove-inline" (click)="removeIngredientRating(r.name)">✕</button>
              {{ r.name }}
            </span>
            <div class="emoji-row">
              @for (e of emojis; track $index) {
                <button type="button" class="emoji-btn"
                  [class.emoji-btn--selected]="r.score === $index"
                  (click)="updateIngredientScore(r.name, $index)"
                >{{ e }}</button>
              }
            </div>
          </div>
        }
      </section>

      <!-- Meal Ratings -->
      <section class="section">
        <div class="section-header-static">Meal Ratings</div>
        <div class="section-subtitle">Rate specific meals you love or want to avoid.</div>
        <div class="rating-entry-row">
          <input type="text" class="text-input flex-1" placeholder="Meal…"
            [value]="mealInput()"
            (input)="mealInput.set(asText($event))" />
          <div class="emoji-row">
            @for (e of emojis; track $index) {
              <button type="button" class="emoji-btn"
                [class.emoji-btn--selected]="pendingMealScore() === $index"
                (click)="pendingMealScore.set($index)"
              >{{ e }}</button>
            }
          </div>
          <button type="button" class="btn-add" [disabled]="savingMeal()" (click)="addMealRating()">Add</button>
        </div>
        @for (r of mealRatings(); track r.name) {
          <div class="rated-row">
            <span class="rated-name flex-1">{{ r.name }}</span>
            <div class="emoji-row">
              @for (e of emojis; track $index) {
                <button type="button" class="emoji-btn"
                  [class.emoji-btn--selected]="r.score === $index"
                >{{ e }}</button>
              }
            </div>
          </div>
        }
      </section>

      @if (saveError()) {
        <p class="error">Something went wrong saving your preferences — please try again.</p>
      }
    </div>
  `,
  styles: [`
    .prefs-substep { display: flex; flex-direction: column; gap: 20px; }
    .banner { background: var(--color-accent-light,#fef3c7); border: 1.5px solid var(--color-accent-border,#fde68a); border-radius: 8px; padding: 10px 14px; font-size: 13px; color: var(--color-accent-dark,#78350f); }
    .section { border: 1.5px solid #e5e7eb; border-radius: 10px; overflow: hidden; }
    .section-header { width: 100%; background: #f9fafb; border: none; border-bottom: 1.5px solid #e5e7eb; padding: 10px 14px; font-size: 13px; font-weight: 700; cursor: pointer; display: flex; justify-content: space-between; }
    .section-header-static { background: #f9fafb; border-bottom: 1.5px solid #e5e7eb; padding: 10px 14px; font-size: 13px; font-weight: 700; }
    .section-subtitle { padding: 8px 14px 0; font-size: 12px; color: #6b7280; }
    .selected-chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px 14px; }
    .lifestyle-expanded { padding: 12px 14px; display: flex; flex-direction: column; gap: 12px; }
    .group { display: flex; flex-direction: column; gap: 6px; }
    .group-label { font-size: 11px; font-weight: 700; text-transform: uppercase; color: #6b7280; letter-spacing: 0.05em; }
    .chip-row { display: flex; flex-wrap: wrap; gap: 6px; }
    .chip { border: 1.5px solid #e5e7eb; background: #fff; border-radius: 20px; padding: 4px 10px; font-size: 12px; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; }
    .chip--amber { background: var(--color-accent-light,#fef3c7); border-color: var(--color-accent,#d97706); font-weight: 700; color: var(--color-accent-dark,#78350f); }
    .chip--muted { background: none; color: #9ca3af; border-color: #e5e7eb; }
    .custom-add { display: flex; flex-direction: column; gap: 6px; }
    .field-label { font-size: 12px; font-weight: 700; color: #374151; }
    .row { display: flex; gap: 8px; }
    .text-input { border: 1.5px solid #d1d5db; border-radius: 6px; padding: 7px 10px; font-size: 13px; }
    .flex-1 { flex: 1; }
    .btn-add { background: var(--color-accent,#d97706); color: #fff; border: none; border-radius: 6px; padding: 7px 14px; font-size: 13px; font-weight: 700; cursor: pointer; }
    .btn-add:disabled { opacity: 0.5; cursor: not-allowed; }
    .legend { padding: 8px 14px 0; font-size: 11px; color: #9ca3af; text-align: right; }
    .rating-entry-row { display: flex; align-items: center; gap: 8px; padding: 10px 14px; flex-wrap: wrap; }
    .emoji-row { display: flex; gap: 2px; }
    .emoji-btn { background: none; border: 1.5px solid transparent; border-radius: 6px; padding: 2px 4px; font-size: 18px; cursor: pointer; line-height: 1; }
    .emoji-btn--selected { border-color: #d97706; background: #fef3c7; }
    .rated-row { display: flex; align-items: center; gap: 8px; padding: 6px 14px; border-top: 1px solid #f3f4f6; }
    .rated-name { font-size: 13px; }
    .btn-remove-inline { background: none; border: none; color: #9ca3af; cursor: pointer; font-size: 11px; }
    .error { color: #dc2626; font-size: 12px; margin: 0; }
  `],
})
export class DietaryPreferencesSubstepComponent {
  @Output() complete = new EventEmitter<void>();

  private readonly dietaryService = inject(DietaryRestrictionsService);
  private readonly mealsService = inject(UserMealsService);

  readonly lifestyleExpanded = signal(false);
  readonly selectedLifestyles = signal<string[]>([]);
  readonly customLifestyleInput = signal('');

  // Ingredient ratings are local-only; persistence requires catalog ID resolution.
  // Tracked in https://github.com/calteran/plnd/issues/560
  readonly ingredientInput = signal('');
  readonly pendingIngredientScore = signal<number | null>(null);
  readonly ingredientRatings = signal<{ name: string; score: number }[]>([]);

  readonly mealInput = signal('');
  readonly pendingMealScore = signal<number | null>(null);
  readonly mealRatings = signal<{ name: string; score: number }[]>([]);
  readonly savingMeal = signal(false);
  readonly saveError = signal(false);

  readonly emojis = EMOJIS;
  readonly lifestyleGroups = LIFESTYLE_GROUPS;

  protected asText(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  protected labelFor(key: string): string {
    for (const grp of LIFESTYLE_GROUPS) {
      const item = grp.items.find(i => i.key === key);
      if (item) return `${item.emoji} ${item.label}`;
    }
    return key;
  }

  toggleLifestyle(key: string): void {
    this.selectedLifestyles.update(s =>
      s.includes(key) ? s.filter(x => x !== key) : [...s, key]
    );
  }

  addCustomLifestyle(): void {
    const name = this.customLifestyleInput().trim();
    if (!name || this.selectedLifestyles().includes(name)) return;
    this.selectedLifestyles.update(s => [...s, name]);
    this.customLifestyleInput.set('');
  }

  addIngredientRating(): void {
    const name = this.ingredientInput().trim();
    const score = this.pendingIngredientScore();
    if (!name || score === null) return;
    this.ingredientRatings.update(r => [...r.filter(x => x.name !== name), { name, score }]);
    this.ingredientInput.set('');
    this.pendingIngredientScore.set(null);
  }

  removeIngredientRating(name: string): void {
    this.ingredientRatings.update(r => r.filter(x => x.name !== name));
  }

  updateIngredientScore(name: string, score: number): void {
    this.ingredientRatings.update(r => r.map(x => x.name === name ? { ...x, score } : x));
  }

  addMealRating(): void {
    const name = this.mealInput().trim();
    const score = this.pendingMealScore();
    if (!name || score === null || this.savingMeal()) return;
    this.savingMeal.set(true);
    const rating = score + 1; // emoji index 0-4 → API rating 1-5
    this.mealsService.createFromScratch({ name }).pipe(
      switchMap(meal => this.mealsService.updateMetadata(meal.user_meal_pref_id, { rating }))
    ).subscribe({
      next: () => {
        this.mealRatings.update(r => [...r, { name, score }]);
        this.mealInput.set('');
        this.pendingMealScore.set(null);
        this.savingMeal.set(false);
      },
      error: () => this.savingMeal.set(false),
    });
  }

  save(): void {
    this.saveError.set(false);
    const lifestyles = this.selectedLifestyles();
    if (!lifestyles.length) {
      this.complete.emit();
      return;
    }
    from(lifestyles)
      .pipe(mergeMap(key => this.dietaryService.create({ restriction_type: 'preference', name: key })))
      .subscribe({
        error: () => this.saveError.set(true),
        complete: () => this.complete.emit(),
      });
  }
}
