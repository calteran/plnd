import { Component, DestroyRef, EventEmitter, Injector, OnInit, Output, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { Subject, forkJoin, from, mergeMap, of } from 'rxjs';
import { debounceTime, distinctUntilChanged, filter, map, switchMap, take } from 'rxjs/operators';
import { CatalogService, IngredientSearchResponse, LocalIngredientResult } from '../../../../../core/services/catalog.service';
import { DietaryRestrictionsService } from '../../../../../core/services/dietary-restrictions.service';
import { UserIngredientPrefsService } from '../../../../../core/services/user-ingredient-prefs.service';
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

const PREDEFINED_LIFESTYLE_KEYS = new Set(
  LIFESTYLE_GROUPS.flatMap(g => g.items.map(i => i.key))
);

interface IngredientRating {
  name: string;
  score: number;
  catalogIngredientId: string | null;
}

const EMPTY_SEARCH: IngredientSearchResponse = { local: [], external: [], providers_queried: [], providers_from_cache: [] };

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
              @if (customLifestyles().length) {
                <div class="chip-row">
                  @for (key of customLifestyles(); track key) {
                    <span class="chip chip--amber">
                      {{ key }}
                      <button type="button" (click)="toggleLifestyle(key)" [attr.aria-label]="'Remove ' + key">✕</button>
                    </span>
                  }
                </div>
              }
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
          <div class="search-wrap">
            <input type="text" class="text-input flex-1" placeholder="Search ingredient…"
              [value]="ingredientInput()"
              (input)="onIngredientInput(asText($event))"
              (keydown.escape)="ingredientSearchResults.set([])"
              (blur)="ingredientSearchResults.set([])" />
            @if (ingredientSearchResults().length) {
              <div class="search-dropdown">
                @for (r of ingredientSearchResults(); track r.ingredient_id) {
                  <button type="button" class="search-result" (mousedown)="$event.preventDefault()" (click)="selectIngredientResult(r)">
                    <span class="result-name">{{ r.name }}</span>
                    @if (r.allergens.length) {
                      <span class="result-allergens">{{ r.allergens.join(', ') }}</span>
                    }
                  </button>
                }
              </div>
            }
          </div>
          <div class="emoji-row">
            @for (e of emojis; track $index) {
              <button type="button" class="emoji-btn"
                [class.emoji-btn--selected]="pendingIngredientScore() === $index"
                (click)="pendingIngredientScore.set($index)"
              >{{ e }}</button>
            }
          </div>
          <button type="button" class="btn-add"
            [disabled]="!ingredientInput().trim() || pendingIngredientScore() === null || savingIngredient()"
            (click)="addIngredientRating()">Add</button>
        </div>
        @for (r of ingredientRatings(); track (r.catalogIngredientId ?? r.name)) {
          <div class="rated-row">
            <span class="rated-name flex-1">
              <button type="button" class="btn-remove-inline" (click)="removeIngredientRating(r)">✕</button>
              {{ r.name }}
            </span>
            <div class="emoji-row">
              @for (e of emojis; track $index) {
                <button type="button" class="emoji-btn"
                  [class.emoji-btn--selected]="r.score === $index"
                  (click)="updateIngredientScore(r, $index)"
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
          <button type="button" class="btn-add"
            [disabled]="!mealInput().trim() || pendingMealScore() === null || savingMeal()"
            (click)="addMealRating()">Add</button>
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
    .banner { background: var(--color-accent-light); border: 1.5px solid var(--color-accent-border); border-radius: 8px; padding: 10px 14px; font-size: 13px; color: var(--color-accent-dark); }
    .section { border: 1.5px solid var(--color-btn-neutral-border); border-radius: 10px; overflow: hidden; }
    .section-header { width: 100%; background: var(--color-surface-base); color: var(--color-text-body); border: none; border-bottom: 1.5px solid var(--color-btn-neutral-border); padding: 10px 14px; font-size: 13px; font-weight: 700; cursor: pointer; display: flex; justify-content: space-between; }
    .section-header-static { background: var(--color-surface-base); border-bottom: 1.5px solid var(--color-btn-neutral-border); padding: 10px 14px; font-size: 13px; font-weight: 700; }
    .section-subtitle { padding: 8px 14px 0; font-size: 12px; color: var(--color-text-muted); }
    .selected-chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px 14px; }
    .lifestyle-expanded { padding: 12px 14px; display: flex; flex-direction: column; gap: 12px; }
    .group { display: flex; flex-direction: column; gap: 6px; }
    .group-label { font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--color-text-muted); letter-spacing: 0.05em; }
    .chip-row { display: flex; flex-wrap: wrap; gap: 6px; }
    .chip { border: 1.5px solid var(--color-btn-neutral-border); background: var(--color-surface-white); color: var(--color-text-body); border-radius: 20px; padding: 4px 10px; font-size: 12px; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; }
    .chip--amber { background: var(--color-accent-light); border-color: var(--color-accent); font-weight: 700; color: var(--color-accent-dark); }
    .chip--muted { background: none; color: var(--color-text-muted); border-color: var(--color-btn-neutral-border); }
    .custom-add { display: flex; flex-direction: column; gap: 6px; }
    .field-label { font-size: 12px; font-weight: 700; color: var(--color-text-body); }
    .row { display: flex; gap: 8px; }
    .text-input { border: 1.5px solid var(--color-border-input); border-radius: 6px; padding: 7px 10px; font-size: 13px; }
    .flex-1 { flex: 1; }
    .btn-add { background: var(--color-accent); color: var(--color-btn-accent-text); border: none; border-radius: 6px; padding: 7px 14px; font-size: 13px; font-weight: 700; cursor: pointer; }
    .btn-add:disabled { opacity: 0.5; cursor: not-allowed; }
    .legend { padding: 8px 14px 0; font-size: 11px; color: var(--color-text-muted); text-align: right; }
    .rating-entry-row { display: flex; align-items: center; gap: 8px; padding: 10px 14px; flex-wrap: wrap; }
    .search-wrap { position: relative; flex: 1; display: flex; }
    .search-wrap .text-input { width: 100%; }
    .search-dropdown { position: absolute; top: 100%; left: 0; right: 0; background: var(--color-surface-white); border: 1.5px solid var(--color-border-input); border-radius: 6px; box-shadow: var(--shadow-dropdown); z-index: 10; max-height: 200px; overflow-y: auto; margin-top: 2px; }
    .search-result { display: flex; flex-direction: column; width: 100%; background: none; border: none; border-bottom: 1px solid var(--color-border-row); padding: 8px 10px; text-align: left; cursor: pointer; gap: 2px; }
    .search-result:last-child { border-bottom: none; }
    .search-result:hover { background: var(--color-surface-base); }
    .result-name { font-size: 13px; color: var(--color-text-body); }
    .result-allergens { font-size: 11px; color: var(--color-text-muted); }
    .emoji-row { display: flex; gap: 2px; }
    .emoji-btn { background: none; border: 1.5px solid transparent; border-radius: 6px; padding: 2px 4px; font-size: 18px; cursor: pointer; line-height: 1; }
    .emoji-btn--selected { border-color: var(--color-accent); background: var(--color-accent-light); }
    .rated-row { display: flex; align-items: center; gap: 8px; padding: 6px 14px; border-top: 1px solid var(--color-border-row); }
    .rated-name { font-size: 13px; }
    .btn-remove-inline { background: none; border: none; color: var(--color-text-muted); cursor: pointer; font-size: 11px; }
    .error { color: var(--color-destructive); font-size: 12px; margin: 0; }
  `],
})
export class DietaryPreferencesSubstepComponent implements OnInit {
  @Output() complete = new EventEmitter<void>();

  private readonly dietaryService = inject(DietaryRestrictionsService);
  private readonly mealsService = inject(UserMealsService);
  private readonly catalogService = inject(CatalogService);
  private readonly ingredientPrefsService = inject(UserIngredientPrefsService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);

  private readonly ingredientSearch$ = new Subject<string>();

  readonly lifestyleExpanded = signal(false);
  readonly selectedLifestyles = signal<string[]>([]);
  readonly customLifestyleInput = signal('');
  readonly customLifestyles = computed(() =>
    this.selectedLifestyles().filter(key => !PREDEFINED_LIFESTYLE_KEYS.has(key))
  );

  readonly ingredientInput = signal('');
  readonly pendingIngredientScore = signal<number | null>(null);
  readonly pendingIngredientId = signal<string | null>(null);
  readonly ingredientSearchResults = signal<LocalIngredientResult[]>([]);
  readonly savingIngredient = signal(false);
  readonly ingredientRatings = signal<IngredientRating[]>([]);

  readonly mealInput = signal('');
  readonly pendingMealScore = signal<number | null>(null);
  readonly mealRatings = signal<{ name: string; score: number }[]>([]);
  readonly savingMeal = signal(false);
  readonly saveError = signal(false);

  readonly emojis = EMOJIS;
  readonly lifestyleGroups = LIFESTYLE_GROUPS;

  ngOnInit(): void {
    this.dietaryService.load();
    const existing = this.dietaryService.restrictions();
    if (existing) {
      const keys = existing
        .filter(r => r.restriction_type === 'preference')
        .map(r => r.name);
      if (keys.length) this.selectedLifestyles.set(keys);
    }

    this.ingredientPrefsService.load();
    toObservable(this.ingredientPrefsService.prefs, { injector: this.injector }).pipe(
      filter(prefs => prefs.length > 0 && this.ingredientRatings().length === 0),
      take(1),
      switchMap(prefs =>
        forkJoin(prefs.map(p =>
          this.catalogService.getIngredient(p.catalog_ingredient_id).pipe(
            map(ing => ({
              name: (ing as { name?: string }).name ?? p.catalog_ingredient_id,
              score: p.preference_score + 2, // API -2..2 → emoji 0..4
              catalogIngredientId: p.catalog_ingredient_id,
            }))
          )
        ))
      ),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(ratings => this.ingredientRatings.set(ratings));

    this.ingredientSearch$.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      switchMap(q => q.length >= 2 ? this.catalogService.searchIngredients(q) : of(EMPTY_SEARCH)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(resp => this.ingredientSearchResults.set(resp.local));
  }

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

  onIngredientInput(value: string): void {
    this.ingredientInput.set(value);
    this.pendingIngredientId.set(null);
    this.ingredientSearch$.next(value.trim());
  }

  selectIngredientResult(result: LocalIngredientResult): void {
    this.ingredientInput.set(result.name);
    this.pendingIngredientId.set(result.ingredient_id);
    this.ingredientSearchResults.set([]);
  }

  addIngredientRating(): void {
    const name  = this.ingredientInput().trim();
    const score = this.pendingIngredientScore();
    const id    = this.pendingIngredientId();
    if (!name || score === null || this.savingIngredient()) return;

    if (!id) {
      // Free-text entry: store locally; will link to catalog after the fact
      this.ingredientRatings.update(r =>
        [...r.filter(x => !(x.name === name && x.catalogIngredientId === null)), { name, score, catalogIngredientId: null }]
      );
      this.resetIngredientEntry();
      return;
    }

    const preferenceScore = score - 2; // emoji index 0-4 → API -2..+2
    this.savingIngredient.set(true);
    this.ingredientPrefsService.upsert(id, { preference_score: preferenceScore }).subscribe({
      next: () => {
        this.ingredientRatings.update(r =>
          [...r.filter(x => x.catalogIngredientId !== id), { name, score, catalogIngredientId: id }]
        );
        this.resetIngredientEntry();
        this.savingIngredient.set(false);
      },
      error: () => {
        this.saveError.set(true);
        this.savingIngredient.set(false);
      },
    });
  }

  /**
   * Clear the ingredient entry row after a successful add. Pushing an empty
   * query through `ingredientSearch$` cancels any in-flight (debounced) search
   * so stale results can't re-open the dropdown over the cleared input.
   */
  private resetIngredientEntry(): void {
    this.ingredientInput.set('');
    this.pendingIngredientScore.set(null);
    this.pendingIngredientId.set(null);
    this.ingredientSearchResults.set([]);
    this.ingredientSearch$.next('');
  }

  removeIngredientRating(rating: IngredientRating): void {
    if (!rating.catalogIngredientId) {
      this.ingredientRatings.update(r => r.filter(x => x.name !== rating.name || x.catalogIngredientId !== null));
      return;
    }
    this.ingredientPrefsService.remove(rating.catalogIngredientId).subscribe({
      next: () => this.ingredientRatings.update(r => r.filter(x => x.catalogIngredientId !== rating.catalogIngredientId)),
      error: () => this.saveError.set(true),
    });
  }

  updateIngredientScore(rating: IngredientRating, score: number): void {
    if (rating.score === score) return;
    const preferenceScore = score - 2;
    if (!rating.catalogIngredientId) {
      this.ingredientRatings.update(r =>
        r.map(x => (x.name === rating.name && x.catalogIngredientId === null) ? { ...x, score } : x)
      );
      return;
    }
    this.ingredientPrefsService.upsert(rating.catalogIngredientId, { preference_score: preferenceScore }).subscribe({
      next: () => this.ingredientRatings.update(r =>
        r.map(x => x.catalogIngredientId === rating.catalogIngredientId ? { ...x, score } : x)
      ),
      error: () => this.saveError.set(true),
    });
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
    const existingNames = new Set(
      (this.dietaryService.restrictions() ?? [])
        .filter(r => r.restriction_type === 'preference')
        .map(r => r.name)
    );
    const toCreate = lifestyles.filter(key => !existingNames.has(key));
    if (!toCreate.length) {
      this.complete.emit();
      return;
    }
    from(toCreate)
      .pipe(mergeMap(key => this.dietaryService.create({ restriction_type: 'preference', name: key })))
      .subscribe({
        error: () => this.saveError.set(true),
        complete: () => this.complete.emit(),
      });
  }
}
