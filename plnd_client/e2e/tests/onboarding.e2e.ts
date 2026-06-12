import { test, expect, Page } from '@playwright/test';
import {
  API_BASE,
  generateTestSub,
  injectAuthToken,
  seedAuth,
  seedTestState,
} from '../helpers/auth';
import {
  MOCK_PLACED_TASKS,
  MOCK_MEAL_PLAN,
  MOCK_MEAL_PLAN_MATCHED,
  seedOnboarding,
} from '../helpers/onboarding-mocks';
import {
  fetchPlannedMeals,
  seedDayType,
  seedDayTypeMeal,
  seedMealAnchor,
} from '../helpers/seed-data';

// ── Mock policy ────────────────────────────────────────────────────────────────
//
// Per docs/architecture.md §9.7, only LLM/agent endpoints may be mocked. Every
// `page.route()` call below targets `/agent/*` (place-tasks, meal-plan). All
// user data, configuration, and schedule state flow through the real backend
// via the seed helpers in ../helpers/seed-data.ts and the /test/seed endpoint.

// ── Spoke completion helpers ──────────────────────────────────────────────────

async function completeAccountSpoke(page: Page): Promise<void> {
  await page.locator('.section-card').first().click();
  await expect(page.locator('.spoke-title')).toHaveText('Account Settings');
  await page.locator('#displayName').fill('Test');
  await page.locator('.btn-continue').click();
  await expect(page).toHaveURL(/\/onboarding$/);
}

// Seeds two pre-existing day types (Weekdays + Weekends) so the day-types substep
// finds them in ngOnInit and renders the two-card layout the tests expect.
async function seedWeekdaysWeekends(sub: string): Promise<void> {
  const weekdays = await seedDayType(sub, {
    name: 'Weekdays',
    days_bitmask: 62, // Mon–Fri: bits 1–5
    wake_time: '07:00',
    sleep_time: '22:00',
  });
  const weekends = await seedDayType(sub, {
    name: 'Weekends',
    days_bitmask: 65, // Sat+Sun: bits 0+6
    wake_time: '08:00',
    sleep_time: '23:00',
  });
  // Three meals per day type so task-placement-review renders meal dividers.
  for (const dt of [weekdays, weekends]) {
    await seedDayTypeMeal(sub, dt.id, { name: 'Breakfast', preferred_time: '08:00', sort_order: 0 });
    await seedDayTypeMeal(sub, dt.id, { name: 'Lunch', preferred_time: '12:00', sort_order: 1 });
    await seedDayTypeMeal(sub, dt.id, { name: 'Dinner', preferred_time: '18:00', sort_order: 2 });
  }
}

// Drives Tasks spoke from hub through Planning Prefs → Schedule Types → Routines & Tasks
// → Task Placement Review → back to hub. Caller must have already mocked /agent/place-tasks
// (the only LLM endpoint here) and seeded any required pre-existing day types.
async function completeTasksSpoke(page: Page): Promise<void> {
  await page.locator('.section-card').nth(1).click();
  await expect(page.locator('.spoke-title')).toHaveText('Tasks & Routines');

  // Step 1: Planning Prefs — accept defaults
  await expect(page.locator('.planning-prefs')).toBeVisible();
  await page.locator('.btn-continue').click();

  // Step 2: Schedule Types — accept seeded Weekdays/Weekends as-is
  await expect(page.locator('.day-types-substep')).toBeVisible();
  await page.locator('.day-types-substep .save-btn').click();

  // Step 3: Routines & Tasks — no inputs needed (real backend persists empty list)
  await expect(page.locator('.routines-tasks-substep')).toBeVisible();
  await page.locator('.routines-tasks-substep .save-btn').click();

  // Step 4: Task Placement Review (host div class is "placement-review")
  await expect(page.locator('.placement-review')).toBeVisible();
  await page.locator('.placement-review .save-btn').click();

  await expect(page).toHaveURL(/\/onboarding$/);
}

// Navigates to tasks spoke and completes the Planning Prefs substep.
// Page must be at /onboarding after seedOnboarding.
async function landAtScheduleTypes(page: Page): Promise<void> {
  await page.locator('.section-card').nth(1).click();
  await expect(page.locator('.planning-prefs')).toBeVisible();
  await page.locator('.btn-continue').click();
  await expect(page.locator('.day-types-substep')).toBeVisible();
  // Wait for the initial async card load to settle before callers interact with cards.
  // Without this, a fast test can click "Switch to rotating schedule" before the day-
  // types API response arrives and races with the mode-switch, overwriting cards().
  await expect(page.locator('.schedule-card').first()).toBeVisible({ timeout: 5_000 });
}

// Drives from hub to the Routines & Tasks substep. Caller must have seeded
// Weekdays/Weekends day types beforehand for the substep to render.
async function landAtRoutinesTasks(page: Page): Promise<void> {
  await landAtScheduleTypes(page);
  await page.locator('.day-types-substep .save-btn').click();
  await expect(page.locator('.routines-tasks-substep')).toBeVisible();
}

// Drives to Task Placement Review with one task added ("Morning run").
// Caller must mock /agent/place-tasks before calling.
async function landAtTaskPlacement(page: Page): Promise<void> {
  await landAtRoutinesTasks(page);

  await page.locator('[aria-label="Task name"]').fill('Morning run');
  await page.locator('.add-btn').last().click();
  await expect(page.locator('[aria-label="Added tasks"] .routine-chip')).toHaveCount(1);
  await page.locator('.routines-tasks-substep .save-btn').click();

  await expect(page.locator('.placement-review')).toBeVisible();
}

// Lands on Dietary Restrictions substep. planningPrefsComplete=true after Tasks
// spoke runs, so Food starts directly at restrictions.
async function landAtDietaryRestrictions(page: Page): Promise<void> {
  await completeTasksSpoke(page);

  await page.locator('.section-card').nth(2).click();
  await expect(page.locator('.spoke-title')).toHaveText('Food & Meals');
  await expect(page.locator('.restrictions-substep')).toBeVisible();
}

async function landAtDietaryPreferences(page: Page): Promise<void> {
  await landAtDietaryRestrictions(page);
  await page.locator('.btn-continue').click();
  await expect(page.locator('.prefs-substep')).toBeVisible();
}

async function landAtMealPlanReview(page: Page): Promise<void> {
  await landAtDietaryPreferences(page);
  await page.locator('.btn-continue').click();
}

// Drives Food spoke from hub through Restrictions → Preferences → Meal Plan Review
// → back to hub. Caller must have already mocked /agent/meal-plan (the only LLM
// endpoint here) and run completeTasksSpoke (so planningPrefsComplete=true).
async function completeFoodSpoke(page: Page): Promise<void> {
  await page.locator('.section-card').nth(2).click();
  await expect(page.locator('.spoke-title')).toHaveText('Food & Meals');

  // Step 1: Dietary Restrictions
  await expect(page.locator('.restrictions-substep')).toBeVisible();
  await page.locator('.btn-continue').click();

  // Step 2: Dietary Preferences
  await expect(page.locator('.prefs-substep')).toBeVisible();
  await page.locator('.btn-continue').click();

  // Step 3: Meal Plan Review — wait for /agent/meal-plan response then save
  await expect(page.locator('.btn-continue')).toBeEnabled({ timeout: 10000 });
  await page.locator('.btn-continue').click();

  await expect(page).toHaveURL(/\/onboarding$/);
}

test.describe('Onboarding', () => {
  test('unauthenticated /onboarding visit redirects to /login', async ({ page }) => {
    await page.goto('/onboarding');
    await expect(page).toHaveURL(/\/login/);
  });

  test('authenticated new user lands on onboarding hub', async ({ page }) => {
    await seedOnboarding(page);
    await page.goto('/onboarding');
    await expect(page).toHaveURL(/\/onboarding/);
    await expect(page.locator('h1')).toHaveText('Welcome to PLND!');
  });

  test('authenticated returning user navigating to /onboarding redirects to /today', async ({ page }) => {
    await seedAuth(page);
    await page.goto('/onboarding');
    await expect(page).toHaveURL(/\/day\//);
  });

  test('non-onboarded user navigating to /today is redirected to /onboarding', async ({ page }) => {
    await seedOnboarding(page);
    await page.goto('/today');
    await expect(page).toHaveURL(/\/onboarding/);
  });

  test('new user can navigate to /onboarding/account child route', async ({ page }) => {
    await seedOnboarding(page);
    await page.goto('/onboarding/account');
    await expect(page).toHaveURL(/\/onboarding\/account/);
    await expect(page.locator('.spoke-title')).toHaveText('Account Settings');
  });

  // ── Hub behaviour ────────────────────────────────────────────────────────

  test.describe('Hub section grid', () => {
    test.beforeEach(async ({ page }) => {
      await seedOnboarding(page);
      await page.goto('/onboarding');
      await expect(page.locator('h1')).toHaveText('Welcome to PLND!');
    });

    test('renders 4 section cards: 3 not-started, Exercise disabled', async ({ page }) => {
      const cards = page.locator('.section-card');
      await expect(cards).toHaveCount(4);

      // Account, Tasks, Food — badge--muted (not started)
      const notStarted = page.locator('.card-badge.badge--muted');
      await expect(notStarted).toHaveCount(3);
      await expect(notStarted.nth(0)).toContainText('not started');

      // Exercise — disabled card + badge--disabled
      const exerciseCard = page.locator('.section-card--disabled');
      await expect(exerciseCard).toHaveCount(1);
      await expect(exerciseCard.locator('.card-badge.badge--disabled')).toContainText('coming soon');
    });

    test('Approve Plan → is ghost/disabled when 0 sections done', async ({ page }) => {
      const ghostCta = page.locator('.btn-cta.btn--ghost');
      await expect(ghostCta).toBeVisible();
      await expect(ghostCta).toContainText('Approve Plan →');
      await expect(ghostCta).toBeDisabled();
    });

    test('stats banner absent before all sections complete', async ({ page }) => {
      await expect(page.locator('.stats-banner')).not.toBeVisible();
    });

    test('entering account section navigates to /onboarding/account', async ({ page }) => {
      await page.locator('.section-card').first().click();
      await expect(page).toHaveURL(/\/onboarding\/account/);
    });

    test('← Hub link in spoke chrome returns to hub', async ({ page }) => {
      await page.goto('/onboarding/account');
      await page.locator('.hub-link').click();
      await expect(page).toHaveURL(/\/onboarding$/);
    });

    test('account section card shows ✓ done badge after account spoke completes', async ({ page }) => {
      // Navigate to account, save (PATCH /users/me hits real backend), return to hub.
      await page.goto('/onboarding/account');
      await expect(page.locator('.spoke-title')).toHaveText('Account Settings');
      await page.locator('#displayName').fill('Test');
      await page.locator('.btn-continue').click();

      await expect(page).toHaveURL(/\/onboarding$/);
      const accountCard = page.locator('.section-card').first();
      await expect(accountCard.locator('.card-badge.badge--done')).toContainText('✓ done');
    });
  });

  test.describe('Hub skip modal', () => {
    test.beforeEach(async ({ page }) => {
      await seedOnboarding(page);
      await page.goto('/onboarding');
      await expect(page.locator('h1')).toHaveText('Welcome to PLND!');
    });

    test('Skip button is visible when sections are incomplete', async ({ page }) => {
      await expect(page.locator('.btn-skip')).toBeVisible();
      await expect(page.locator('.btn-skip')).toHaveText('Skip');
    });

    test('clicking Skip opens the skip modal', async ({ page }) => {
      await page.locator('.btn-skip').click();
      await expect(page.locator('.modal-card')).toBeVisible();
      await expect(page.locator('.modal-card')).toContainText('Skip setup for now?');
    });

    test('"Keep going" dismisses the modal', async ({ page }) => {
      await page.locator('.btn-skip').click();
      await expect(page.locator('.modal-card')).toBeVisible();
      await page.locator('.btn-ghost-amber').click();
      await expect(page.locator('.modal-card')).not.toBeVisible();
      await expect(page).toHaveURL(/\/onboarding$/);
    });

    test('Escape key dismisses the modal', async ({ page }) => {
      await page.locator('.btn-skip').click();
      await expect(page.locator('.modal-card')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.locator('.modal-card')).not.toBeVisible();
    });

    test('"Skip for now" calls complete-onboarding and navigates to /day/2026-03-28', async ({ page }) => {
      await page.locator('.btn-skip').click();
      await page.locator('.btn-gray-primary').click();
      await expect(page).toHaveURL(/\/day\/2026-03-28/);
    });
  });

  test.describe('Hub stats banner and commit plan', () => {
    test('stats banner appears with stat labels when all 3 sections complete', async ({ page }) => {
      const { sub } = await seedOnboarding(page);
      await seedWeekdaysWeekends(sub);
      await page.route(`${API_BASE}/agent/place-tasks`, route =>
        route.fulfill({ status: 200, json: MOCK_PLACED_TASKS })
      );
      await page.route(`${API_BASE}/agent/meal-plan`, route =>
        route.fulfill({ status: 200, json: MOCK_MEAL_PLAN })
      );
      await page.goto('/onboarding');

      await completeAccountSpoke(page);
      await completeTasksSpoke(page);
      await completeFoodSpoke(page);

      await expect(page.locator('.stats-banner')).toBeVisible();

      const labels = page.locator('.stat-label');
      await expect(labels.nth(0)).toHaveText('Routines');
      await expect(labels.nth(1)).toHaveText('Tasks');
      await expect(labels.nth(2)).toHaveText('Meals');
      await expect(labels.nth(3)).toHaveText('Days');
    });

    test('Approve Plan → is amber/enabled when all 3 sections complete', async ({ page }) => {
      const { sub } = await seedOnboarding(page);
      await seedWeekdaysWeekends(sub);
      await page.route(`${API_BASE}/agent/place-tasks`, route =>
        route.fulfill({ status: 200, json: MOCK_PLACED_TASKS })
      );
      await page.route(`${API_BASE}/agent/meal-plan`, route =>
        route.fulfill({ status: 200, json: MOCK_MEAL_PLAN })
      );
      await page.goto('/onboarding');

      await completeAccountSpoke(page);
      await completeTasksSpoke(page);
      await completeFoodSpoke(page);

      await expect(page.locator('.btn-cta.btn--accent')).toBeVisible();
      await expect(page.locator('.btn-cta.btn--ghost')).not.toBeVisible();
      await expect(page.locator('.btn-skip')).not.toBeVisible();
    });

    test('commit plan: POST /schedule/plan + complete-onboarding → navigates to /day/plan-start', async ({ page }) => {
      const { sub } = await seedOnboarding(page);
      await seedWeekdaysWeekends(sub);
      await page.route(`${API_BASE}/agent/place-tasks`, route =>
        route.fulfill({ status: 200, json: MOCK_PLACED_TASKS })
      );
      await page.route(`${API_BASE}/agent/meal-plan`, route =>
        route.fulfill({ status: 200, json: MOCK_MEAL_PLAN })
      );
      await page.goto('/onboarding');

      await completeAccountSpoke(page);
      await completeTasksSpoke(page);
      await completeFoodSpoke(page);

      await page.locator('.btn-cta.btn--accent').click();
      // Commit navigates to plan_start (the day after today), not today.
      await expect(page).toHaveURL(/\/day\/2026-03-29/);
    });

    test('POST /schedule/plan 500 → error banner shown; CTA re-enables', async ({ page }) => {
      const { sub } = await seedOnboarding(page);
      await seedWeekdaysWeekends(sub);
      await page.route(`${API_BASE}/agent/place-tasks`, route =>
        route.fulfill({ status: 200, json: MOCK_PLACED_TASKS })
      );
      await page.route(`${API_BASE}/agent/meal-plan`, route =>
        route.fulfill({ status: 200, json: MOCK_MEAL_PLAN })
      );
      await page.goto('/onboarding');

      await completeAccountSpoke(page);
      await completeTasksSpoke(page);
      await completeFoodSpoke(page);

      // Force the commit POST to fail. This is the test's contract — not a generic
      // mock — so we keep it as a page.route() override on the real endpoint.
      await page.route(`${API_BASE}/schedule/plan`, route =>
        route.fulfill({ status: 500, body: 'Internal Server Error' })
      );

      await page.locator('.btn-cta.btn--accent').click();

      await expect(page.locator('.commit-error')).toBeVisible();
      await expect(page.locator('.commit-error')).toContainText('Something went wrong');
      await expect(page.locator('.hub--submitting')).not.toBeVisible();
      await expect(page.locator('.btn-cta.btn--accent')).toBeEnabled();
    });
  });

  // ── Meal persistence end-to-end (#887) ─────────────────────────────────────
  //
  // The "commit plan" / "full happy path" tests above forward an EMPTY
  // meal_entries list — lowercase MOCK_MEAL_PLAN never matches the capitalized
  // seeded slots, so buildMealPlanResponse() drops every cell — and therefore
  // assert navigation only, never persistence. These tests close that gap: they
  // drive the slot-aligned MOCK_MEAL_PLAN_MATCHED plus seeded meal_anchor_instances
  // so the real commit_plan pairs each staged meal against an instance and writes
  // planned_meals, then read those rows back from GET /schedule/period to prove
  // they survived the round-trip — across both the Approve and Skip exits, which
  // share persistPlanThenComplete().
  //
  // The Approve test also asserts the dishes render in the day-view DOM (#889:
  // schedule.service now joins /schedule/period's planned_meals onto the anchor
  // rows). The Skip test keeps the API-only assertion to cover that exit path.
  test.describe('Onboarding meal persistence', () => {
    // commit_plan pairs each staged meal against an existing meal_anchor_instance
    // matching (user_id, date, name); the mocked /agent/meal-plan flow never
    // materializes them, so seed the two the matched mock proposes on the
    // plan-start date. With the clock fixed to Sat 2026-03-28, the first plan
    // window starts the day after (Sun 2026-03-29) per #888 — a Sunday, so the
    // seeded Weekends day type (Breakfast/Lunch/Dinner) applies. Without these
    // instances the commit 500s.
    async function seedDayMealAnchors(sub: string): Promise<void> {
      await seedMealAnchor(sub, { date: '2026-03-29', name: 'Breakfast', preferred_time: '08:00' });
      await seedMealAnchor(sub, { date: '2026-03-29', name: 'Lunch', preferred_time: '12:00' });
    }

    test('Approve Plan persists generated meals to the backend', async ({ page }) => {
      const { sub } = await seedOnboarding(page);
      await seedWeekdaysWeekends(sub);
      await seedDayMealAnchors(sub);
      await page.route(`${API_BASE}/agent/place-tasks`, route =>
        route.fulfill({ status: 200, json: MOCK_PLACED_TASKS })
      );
      await page.route(`${API_BASE}/agent/meal-plan`, route =>
        route.fulfill({ status: 200, json: MOCK_MEAL_PLAN_MATCHED })
      );
      await page.goto('/onboarding');

      await completeAccountSpoke(page);
      await completeTasksSpoke(page);
      await completeFoodSpoke(page);

      await page.locator('.btn-cta.btn--accent').click();
      await expect(page).toHaveURL(/\/day\/2026-03-29/, { timeout: 15_000 });

      // Day view renders the committed dish on each anchor row (#889).
      await expect(page.locator('.meal-desc').filter({ hasText: 'Oatmeal' })).toBeVisible();
      await expect(page.locator('.meal-desc').filter({ hasText: 'Salad' })).toBeVisible();

      const meals = await fetchPlannedMeals(sub, '2026-03-29', '2026-03-29');
      expect(meals).toHaveLength(2);
      const byName = new Map(meals.map(m => [m.anchor_name, m.title]));
      expect(byName.get('Breakfast')).toBe('Oatmeal');
      expect(byName.get('Lunch')).toBe('Salad');
    });

    test('Skip persists already-completed meals (Account left incomplete)', async ({ page }) => {
      const { sub } = await seedOnboarding(page);
      await seedWeekdaysWeekends(sub);
      await seedDayMealAnchors(sub);
      await page.route(`${API_BASE}/agent/place-tasks`, route =>
        route.fulfill({ status: 200, json: MOCK_PLACED_TASKS })
      );
      await page.route(`${API_BASE}/agent/meal-plan`, route =>
        route.fulfill({ status: 200, json: MOCK_MEAL_PLAN_MATCHED })
      );
      await page.goto('/onboarding');

      // Complete Tasks (sets planning prefs) + Food (generates meals) but leave
      // Account incomplete, so the Skip affordance stays — Approve replaces Skip
      // only once all three sections are done.
      await completeTasksSpoke(page);
      await completeFoodSpoke(page);

      await page.locator('.btn-skip').click();
      await page.locator('.btn-gray-primary').click();
      await expect(page).toHaveURL(/\/day\/2026-03-29/, { timeout: 15_000 });

      const meals = await fetchPlannedMeals(sub, '2026-03-29', '2026-03-29');
      expect(meals).toHaveLength(2);
      const byName = new Map(meals.map(m => [m.anchor_name, m.title]));
      expect(byName.get('Breakfast')).toBe('Oatmeal');
      expect(byName.get('Lunch')).toBe('Salad');
    });
  });

  test.describe('Account spoke', () => {
    test.beforeEach(async ({ page }) => {
      await seedOnboarding(page);
      await page.goto('/onboarding/account');
      await expect(page.locator('.spoke-title')).toHaveText('Account Settings');
    });

    test('display name input is empty (user has no display_name)', async ({ page }) => {
      await expect(page.locator('#displayName')).toHaveValue('');
    });

    test('email is shown as static text from user data', async ({ page }) => {
      // Real backend issues `${sub}@mock.plnd` for newly-minted users (see
      // plnd_api/src/routes/auth.rs). Match that shape rather than a fixture string.
      await expect(page.locator('.email-display')).toHaveText(/@mock\.plnd$/);
    });

    test('SMS input is hidden until SMS toggle is switched on', async ({ page }) => {
      await expect(page.locator('[aria-label="Phone number"]')).not.toBeVisible();
      await page.locator('[aria-label="SMS notifications"]').check();
      await expect(page.locator('[aria-label="Phone number"]')).toBeVisible();
    });

    test('Save & Continue → navigates to hub and marks account complete', async ({ page }) => {
      await page.locator('#displayName').fill('Test User');
      await page.locator('.btn-continue').click();
      await expect(page).toHaveURL(/\/onboarding$/);

      const accountCard = page.locator('.section-card').first();
      await expect(accountCard.locator('.card-badge.badge--done')).toContainText('✓ done');
    });
  });

  test.describe('Planning Prefs (shared)', () => {
    test('shown on first entry into Tasks spoke', async ({ page }) => {
      await seedOnboarding(page);
      await page.goto('/onboarding/tasks');
      await expect(page.locator('.planning-prefs')).toBeVisible();
      await expect(page.locator('.dot')).toHaveCount(4);
      await expect(page.locator('.dot.dot--current')).toHaveCount(1);
    });

    test('skipped on Food after Tasks spoke completed planning prefs', async ({ page }) => {
      const { sub } = await seedOnboarding(page);
      await seedWeekdaysWeekends(sub);
      await page.route(`${API_BASE}/agent/place-tasks`, route =>
        route.fulfill({ status: 200, json: MOCK_PLACED_TASKS })
      );

      await page.goto('/onboarding');
      await completeTasksSpoke(page);

      await page.locator('.section-card').nth(2).click();
      await expect(page.locator('.spoke-title')).toHaveText('Food & Meals');
      await expect(page.locator('.planning-prefs')).not.toBeVisible();
      await expect(page.locator('.restrictions-substep')).toBeVisible();
    });

    test('shown on first entry into Food spoke; skipped on Tasks entered after', async ({ page }) => {
      const { sub } = await seedOnboarding(page);
      await seedWeekdaysWeekends(sub);

      await page.goto('/onboarding/food');
      await expect(page.locator('.planning-prefs')).toBeVisible();

      await page.locator('.btn-continue').click();
      await expect(page.locator('.restrictions-substep')).toBeVisible();

      await page.locator('.hub-link').click();
      await expect(page).toHaveURL(/\/onboarding$/);
      await page.locator('.section-card').nth(1).click();
      await expect(page.locator('.spoke-title')).toHaveText('Tasks & Routines');

      await expect(page.locator('.planning-prefs')).not.toBeVisible();
      await expect(page.locator('.day-types-substep')).toBeVisible();
    });
  });

  test.describe('Tasks spoke — Day Types', () => {
    test.beforeEach(async ({ page }) => {
      const { sub } = await seedOnboarding(page);
      await seedWeekdaysWeekends(sub);
      await page.goto('/onboarding');
      await landAtScheduleTypes(page);
    });

    test('two pre-configured cards (Weekdays + Weekends) are visible', async ({ page }) => {
      const cards = page.locator('.schedule-card');
      await expect(cards).toHaveCount(2);
      await expect(cards.nth(0).locator('.card-name-input')).toHaveValue('Weekdays');
      await expect(cards.nth(1).locator('.card-name-input')).toHaveValue('Weekends');
    });

    test('Weekdays card has M T W T F selected (5 active day pills)', async ({ page }) => {
      const weekdays = page.locator('.schedule-card').nth(0);
      const activePills = weekdays.locator('.day-pill.day-pill--active');
      await expect(activePills).toHaveCount(5);
    });

    test('Add new day type via "+ Add day type"', async ({ page }) => {
      await page.getByRole('button', { name: '+ Add day type' }).click();
      const cards = page.locator('.schedule-card');
      await expect(cards).toHaveCount(3);
      await expect(cards.nth(2).locator('.card-name-input')).toHaveValue('');
    });

    test('✕ disabled while days assigned; shows inline hint on click', async ({ page }) => {
      const firstCard = page.locator('.schedule-card').nth(0);
      await expect(firstCard.locator('.remove-btn')).toBeDisabled();
      // Disabled buttons don't fire click events; dispatch manually to reach Angular handler.
      await firstCard.locator('.remove-btn').dispatchEvent('click');
      await expect(firstCard.locator('.remove-hint')).toBeVisible();
      await expect(firstCard.locator('.remove-hint')).toContainText('Uncheck all days before removing this type');
    });

    test('Switch to rotating schedule wipes DOW cards and seeds a single cycle card', async ({ page }) => {
      // Mode is a user-level binary: switching wipes the DOW setup and starts over with
      // a single cycle card that claims every position in the default 7-day cycle.
      await page.getByRole('button', { name: 'Switch to rotating schedule' }).click();
      const cards = page.locator('.schedule-card');
      await expect(cards).toHaveCount(1);
      // Substep-level cycle params appear once, not per-card.
      await expect(page.locator('.cycle-input[type="number"]')).toHaveValue('7');
      await expect(page.locator('.cycle-input[type="date"]')).not.toHaveValue('');
      // All 7 numbered position pills are active on the lone cycle card (top card claims all).
      const positionPills = cards.nth(0).locator('.day-pill');
      await expect(positionPills).toHaveCount(7);
      for (let i = 0; i < 7; i++) {
        await expect(positionPills.nth(i)).toHaveAttribute('aria-pressed', 'true');
      }
    });

    test('Switch to weekday schedule reverts cycle setup to default DOW cards', async ({ page }) => {
      await page.getByRole('button', { name: 'Switch to rotating schedule' }).click();
      await expect(page.locator('.schedule-card')).toHaveCount(1);
      await page.getByRole('button', { name: 'Switch to weekday schedule' }).click();
      const cards = page.locator('.schedule-card');
      await expect(cards).toHaveCount(2);
      await expect(cards.nth(0).locator('.card-name-input')).toHaveValue('Weekdays');
      await expect(cards.nth(1).locator('.card-name-input')).toHaveValue('Weekends');
      // Cycle params are gone.
      await expect(page.locator('.cycle-fields')).not.toBeVisible();
    });
  });

  test.describe('Tasks spoke — Routines & Tasks', () => {
    test.beforeEach(async ({ page }) => {
      const { sub } = await seedOnboarding(page);
      await seedWeekdaysWeekends(sub);
      await page.goto('/onboarding');
      await landAtRoutinesTasks(page);
    });

    test('add routine via form: name + recurrence chip appears', async ({ page }) => {
      await page.locator('[aria-label="Routine name"]').fill('Morning yoga');
      await page.locator('.add-btn').first().click();

      const routineChips = page.locator('[aria-label="Added routines"] .routine-chip');
      await expect(routineChips).toHaveCount(1);
      await expect(routineChips.nth(0)).toContainText('Morning yoga');
      await expect(routineChips.nth(0)).toContainText('daily');
    });

    test('add routine via inspiration chip (Morning walk)', async ({ page }) => {
      await page.locator('.inspiration-chip').filter({ hasText: 'Morning walk' }).click();

      const routineChips = page.locator('[aria-label="Added routines"] .routine-chip');
      await expect(routineChips).toHaveCount(1);
      await expect(routineChips.nth(0)).toContainText('Morning walk');
      await expect(page.locator('.inspiration-chip').filter({ hasText: 'Morning walk' })).not.toBeVisible();
    });

    test('tap chip opens inline recurrence editor', async ({ page }) => {
      await page.locator('[aria-label="Routine name"]').fill('Morning yoga');
      await page.locator('.add-btn').first().click();

      await page.locator('.chip-body--clickable').click();
      await expect(page.locator('.routine-edit-card')).toBeVisible();
    });

    test('add upcoming task appears as chip without recurrence label', async ({ page }) => {
      await page.locator('[aria-label="Task name"]').fill('Buy groceries');
      await page.locator('.add-btn').last().click();

      const taskChips = page.locator('[aria-label="Added tasks"] .routine-chip');
      await expect(taskChips).toHaveCount(1);
      await expect(taskChips.nth(0)).toContainText('Buy groceries');
      await expect(taskChips.nth(0)).not.toContainText('·');
    });
  });

  test.describe('Tasks spoke — Task Placement Review', () => {
    test('loading state shown while POST /agent/place-tasks completes', async ({ page }) => {
      const { sub } = await seedOnboarding(page);
      await seedWeekdaysWeekends(sub);
      await page.route(`${API_BASE}/agent/place-tasks`, async route => {
        await new Promise(r => setTimeout(r, 200));
        route.fulfill({ status: 200, json: MOCK_PLACED_TASKS });
      });
      await page.goto('/onboarding');
      await landAtTaskPlacement(page);

      const loadingOrGrid = page.locator('.loading-state, .day-card');
      await expect(loadingOrGrid.first()).toBeVisible();
    });

    test('AI-placed tasks visible in day cards with meal dividers', async ({ page }) => {
      const { sub } = await seedOnboarding(page);
      await seedWeekdaysWeekends(sub);
      await page.route(`${API_BASE}/agent/place-tasks`, route =>
        route.fulfill({ status: 200, json: MOCK_PLACED_TASKS })
      );
      await page.goto('/onboarding');
      await landAtTaskPlacement(page);

      await expect(page.locator('.day-card').first()).toBeVisible();
      await expect(page.locator('.meal-divider').first()).toBeVisible();
      await expect(page.locator('.meal-label').first()).toBeVisible();
      await expect(page.locator('.task-row').first()).toBeVisible();
      await expect(page.locator('.task-title').first()).toHaveText('Morning run');
      await expect(page.locator('.energy-badge').first()).toBeVisible();
    });

    test('tap Edit → change energy → Save updates the task row', async ({ page }) => {
      const { sub } = await seedOnboarding(page);
      await seedWeekdaysWeekends(sub);
      await page.route(`${API_BASE}/agent/place-tasks`, route =>
        route.fulfill({ status: 200, json: MOCK_PLACED_TASKS })
      );
      await page.goto('/onboarding');
      await landAtTaskPlacement(page);

      await expect(page.locator('.task-row').first()).toBeVisible();
      await page.locator('.edit-btn').first().click();
      await expect(page.locator('.task-row--editing')).toBeVisible();

      await page.locator('[aria-label="Energy level"]').selectOption('low');
      await page.locator('.save-edit-btn').click();

      await expect(page.locator('.task-row--editing')).not.toBeVisible();
      await expect(page.locator('.energy-badge').first()).toHaveClass(/energy-badge--low/);
    });

    test('Save & Return to Hub marks Tasks complete and navigates to hub', async ({ page }) => {
      const { sub } = await seedOnboarding(page);
      await seedWeekdaysWeekends(sub);
      await page.route(`${API_BASE}/agent/place-tasks`, route =>
        route.fulfill({ status: 200, json: MOCK_PLACED_TASKS })
      );
      await page.goto('/onboarding');
      await landAtTaskPlacement(page);

      await page.locator('.placement-review .save-btn').click();
      await expect(page).toHaveURL(/\/onboarding$/);

      const tasksCard = page.locator('.section-card').nth(1);
      await expect(tasksCard.locator('.card-badge.badge--done')).toContainText('✓ done');
    });
  });

  test.describe('Food spoke — Dietary Restrictions', () => {
    test.beforeEach(async ({ page }) => {
      const { sub } = await seedOnboarding(page);
      await seedWeekdaysWeekends(sub);
      await page.route(`${API_BASE}/agent/place-tasks`, route =>
        route.fulfill({ status: 200, json: MOCK_PLACED_TASKS })
      );
      await page.goto('/onboarding');
      await landAtDietaryRestrictions(page);
      await expect(page.locator('.restrictions-substep')).toBeVisible();
    });

    test('add Allergy entry shows Allergy badge', async ({ page }) => {
      await page.locator('.type-btn').filter({ hasText: 'Allergy' }).click();
      await expect(page.locator('.type-btn').filter({ hasText: 'Allergy' })).toHaveClass(/type-btn--active/);

      await page.locator('.name-row .name-input').fill('Peanuts');
      await page.locator('.btn-add').click();

      await expect(page.locator('.restriction-card')).toHaveCount(1);
      await expect(page.locator('.type-badge')).toContainText('Allergy');
    });

    test('tap restriction card opens inline edit mode', async ({ page }) => {
      await page.locator('.name-row .name-input').fill('Peanuts');
      await page.locator('.btn-add').click();
      await expect(page.locator('.restriction-card')).toHaveCount(1);

      await page.locator('.card-default').click();
      await expect(page.locator('.card-edit')).toBeVisible();
    });

    test('cancel edit returns to default card view', async ({ page }) => {
      await page.locator('.name-row .name-input').fill('Peanuts');
      await page.locator('.btn-add').click();

      await page.locator('.card-default').click();
      await expect(page.locator('.card-edit')).toBeVisible();
      await page.locator('.btn-cancel').click();
      await expect(page.locator('.card-edit')).not.toBeVisible();
      await expect(page.locator('.card-default')).toBeVisible();
    });
  });

  test.describe('Food spoke — Dietary Preferences', () => {
    test.beforeEach(async ({ page }) => {
      const { sub } = await seedOnboarding(page);
      await seedWeekdaysWeekends(sub);
      await page.route(`${API_BASE}/agent/place-tasks`, route =>
        route.fulfill({ status: 200, json: MOCK_PLACED_TASKS })
      );
      await page.goto('/onboarding');
      await landAtDietaryPreferences(page);
    });

    test('Lifestyle panel is collapsed by default; expands on click', async ({ page }) => {
      await expect(page.locator('.lifestyle-expanded')).not.toBeVisible();
      await page.locator('.section-header').first().click();
      await expect(page.locator('.lifestyle-expanded')).toBeVisible();
    });

    test('selecting Vegan chip marks it amber', async ({ page }) => {
      await page.locator('.section-header').first().click();
      await expect(page.locator('.lifestyle-expanded')).toBeVisible();
      const veganChip = page.locator('.chip').filter({ hasText: 'Vegan' });
      await veganChip.click();
      await expect(veganChip).toHaveClass(/chip--amber/);
    });

    // Acceptance criterion for #858: searching "cheese" in the Ingredient Ratings
    // field returns a recognizable catalog result that can be selected. The backend
    // serves /catalog/search from real USDA fixtures seeded at startup, so no
    // page.route() mock is needed here per the e2e mock policy (§9.7).
    // The cheese fixture is seeded into the catalog, so this exercises the *local*
    // result path; the external→promote flow is covered by the component spec and
    // the backend integration tests.
    test('ingredient search for "cheese" returns a recognizable result and can be selected (#858)', async ({ page }) => {
      const search = page.getByPlaceholder('Search ingredient…');
      await search.fill('cheese');

      const dropdown = page.locator('.search-dropdown');
      await expect(dropdown).toBeVisible({ timeout: 5_000 });
      const cheeseResult = dropdown.locator('.search-result', { hasText: /Cheese/i }).first();
      await expect(cheeseResult).toBeVisible();
      await cheeseResult.click();

      await expect(search).toHaveValue(/Cheese/i);
      // Selecting a result clears ingredientSearchResults in the component, so the
      // dropdown closing proves the selection handler actually ran (not just that
      // the input mirrored the typed text).
      await expect(dropdown).not.toBeVisible();
    });
  });

  test.describe('Food spoke — Meal Plan Review', () => {
    test('Save & Continue disabled during generation; enabled after plan loads', async ({ page }) => {
      const { sub } = await seedOnboarding(page);
      await seedWeekdaysWeekends(sub);
      await page.route(`${API_BASE}/agent/place-tasks`, route =>
        route.fulfill({ status: 200, json: MOCK_PLACED_TASKS })
      );
      // Gate the meal-plan response behind a manually-resolved promise rather
      // than a fixed setTimeout. A fixed delay races the disabled assertion —
      // under parallel load the response can resolve before Playwright polls —
      // whereas an explicit gate holds the in-flight (generating) window open
      // until the test releases it, making the disabled state deterministic.
      // Definite assignment: the Promise executor runs synchronously, so
      // releaseMealPlan is assigned before the route handler can read it.
      let releaseMealPlan!: () => void;
      const mealPlanGate = new Promise<void>(resolve => {
        releaseMealPlan = resolve;
      });
      await page.route(`${API_BASE}/agent/meal-plan`, async route => {
        await mealPlanGate;
        await route.fulfill({ status: 200, json: MOCK_MEAL_PLAN });
      });

      await page.goto('/onboarding');
      await landAtMealPlanReview(page);

      // Button is disabled while generation is in flight (response gated open).
      await expect(page.locator('.btn-continue')).toBeDisabled();
      // Releasing the gated response transitions the button to enabled.
      releaseMealPlan();
      await expect(page.locator('.btn-continue')).toBeEnabled({ timeout: 10000 });
    });

    test('Save & Continue → navigates to hub with Food marked complete', async ({ page }) => {
      const { sub } = await seedOnboarding(page);
      await seedWeekdaysWeekends(sub);
      await page.route(`${API_BASE}/agent/place-tasks`, route =>
        route.fulfill({ status: 200, json: MOCK_PLACED_TASKS })
      );
      await page.route(`${API_BASE}/agent/meal-plan`, route =>
        route.fulfill({ status: 200, json: MOCK_MEAL_PLAN })
      );

      await page.goto('/onboarding');
      await landAtMealPlanReview(page);

      // Wait for generation to finish, then click Save & Continue
      await expect(page.locator('.btn-continue')).toBeEnabled({ timeout: 10000 });
      await page.locator('.btn-continue').click();

      // Should return to the hub
      await expect(page).toHaveURL(/\/onboarding$/);
      // Food card (index 2) should be marked done
      const foodCard = page.locator('.section-card').nth(2);
      await expect(foodCard.locator('.card-badge.badge--done')).toContainText('✓ done');
    });
  });

  // Regression: a user who opens the Food spoke before the Tasks spoke (and
  // therefore has no day-type template yet) must still be routed through the
  // shared day-types substep before meal planning. Without it, meal generation
  // has zero anchor slots and silently produces an empty plan.
  test.describe('Food spoke — shared day-types substep (food-first)', () => {
    test('day-types substep appears before meal plan when no day types exist', async ({ page }) => {
      await seedOnboarding(page); // no day types seeded
      await page.route(`${API_BASE}/agent/meal-plan`, route =>
        route.fulfill({ status: 200, json: MOCK_MEAL_PLAN })
      );

      await page.goto('/onboarding/food');

      // Shared planning-prefs substep on first entry to either spoke.
      await expect(page.locator('.planning-prefs')).toBeVisible();
      await page.locator('.btn-continue').click();

      await expect(page.locator('.restrictions-substep')).toBeVisible();
      await page.locator('.btn-continue').click();

      await expect(page.locator('.prefs-substep')).toBeVisible();
      await page.locator('.btn-continue').click();

      // The fix: day-types is inserted before plan-meals. Previously the spoke
      // jumped straight to meal planning with no anchors → zero meals.
      await expect(page.locator('.day-types-substep')).toBeVisible();
      await expect(page.locator('.schedule-card').first()).toBeVisible({ timeout: 5_000 });
      await page.locator('.day-types-substep .save-btn').click();

      // Saving the default day types unblocks meal generation; the meal-plan
      // review step renders and its Save & Continue enables once the plan loads.
      await expect(page.locator('.btn-continue')).toBeEnabled({ timeout: 10_000 });
    });
  });

  test.describe('Full happy path', () => {
    test('complete all 3 sections → stats banner → Approve Plan → /day/plan-start', async ({ page }) => {
      const { sub } = await seedOnboarding(page);
      await seedWeekdaysWeekends(sub);
      await page.route(`${API_BASE}/agent/place-tasks`, route =>
        route.fulfill({ status: 200, json: MOCK_PLACED_TASKS })
      );
      await page.route(`${API_BASE}/agent/meal-plan`, route =>
        route.fulfill({ status: 200, json: MOCK_MEAL_PLAN })
      );

      await page.goto('/onboarding');

      await completeAccountSpoke(page);
      await completeTasksSpoke(page);
      await completeFoodSpoke(page);

      await expect(page.locator('.stats-banner')).toBeVisible();
      await expect(page.locator('.btn-cta.btn--accent')).toBeVisible();

      await page.locator('.btn-cta.btn--accent').click();
      // Approve Plan commits via the real backend before redirecting; give the
      // redirect a generous timeout so the assertion survives CPU starvation
      // when the full suite runs in parallel under `just verify`. Redirect target
      // is plan_start (the day after today), Sun 2026-03-29.
      await expect(page).toHaveURL(/\/day\/2026-03-29/, { timeout: 15_000 });
    });
  });

  test.describe('Guard: already-onboarded user', () => {
    test('onboarded user visiting /onboarding/tasks redirects to /today', async ({ page }) => {
      await page.clock.setFixedTime('2026-03-28T00:00:00');
      const sub = generateTestSub();
      await injectAuthToken(page, sub);
      await seedTestState(sub, { preset: 'onboarded' });

      await page.goto('/onboarding/tasks');
      await expect(page).toHaveURL(/\/day\//);
    });
  });
});
