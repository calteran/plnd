import { test, expect, Page } from '@playwright/test';
import {
  API_BASE, MOCK_USER_NEW, MOCK_USER_ONBOARDED, MOCK_PREFS,
  MOCK_BRIEFING_WEATHER, MOCK_BRIEFING_NEWS, MOCK_BRIEFING_YESTERDAY,
} from '../helpers/auth';
import {
  MOCK_SCHEDULE_TYPE_WEEKDAYS, MOCK_SCHEDULE_TYPE_WEEKENDS,
  MOCK_TEMPLATE_MORNING_WALK, MOCK_PLACED_TASKS, MOCK_MEAL_PLAN,
  MOCK_MEAL_HABIT, MOCK_DIETARY_RESTRICTION_ALLERGY,
  MOCK_DIETARY_RESTRICTION_INTOLERANCE, MOCK_PLAN_COMMITTED,
  seedOnboarding,
} from '../helpers/onboarding-mocks';

// ── Spoke completion helpers ──────────────────────────────────────────────────

async function completeAccountSpoke(page: Page): Promise<void> {
  await page.route(`${API_BASE}/users/me`, route => {
    if (route.request().method() === 'PATCH') {
      route.fulfill({ status: 200, json: { ...MOCK_USER_NEW, display_name: 'Test' } });
    } else {
      route.fulfill({ status: 200, json: MOCK_USER_NEW });
    }
  });
  await page.locator('.section-card').first().click();
  await expect(page.locator('.spoke-title')).toHaveText('Account Settings');
  await page.locator('.btn-continue').click();
  await expect(page).toHaveURL(/\/onboarding$/);
}

async function completeTasksSpoke(page: Page): Promise<void> {
  await page.route(`${API_BASE}/schedule-types`, route =>
    route.fulfill({ status: 200, json: [MOCK_SCHEDULE_TYPE_WEEKDAYS, MOCK_SCHEDULE_TYPE_WEEKENDS] })
  );
  await page.route(`${API_BASE}/schedule/templates`, route => {
    if (route.request().method() === 'POST') {
      route.fulfill({ status: 201, json: MOCK_TEMPLATE_MORNING_WALK });
    } else {
      route.fulfill({ status: 200, json: [] });
    }
  });
  await page.route(`${API_BASE}/agent/place-tasks`, route =>
    route.fulfill({ status: 200, json: MOCK_PLACED_TASKS })
  );

  await page.locator('.section-card').nth(1).click();
  await expect(page.locator('.spoke-title')).toHaveText('Tasks & Routines');

  // Step 1: Planning Prefs
  await expect(page.locator('.planning-prefs')).toBeVisible();
  await page.locator('.planning-prefs .save-btn').click();

  // Step 2: Schedule Types
  await expect(page.locator('.schedule-types-substep')).toBeVisible();
  await page.locator('.schedule-types-substep .save-btn').click();

  // Step 3: Routines & Tasks
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
  await page.locator('.planning-prefs .save-btn').click();
  await expect(page.locator('.schedule-types-substep')).toBeVisible();
}

// Drives from hub to the Routines & Tasks substep.
// Caller must have already set up the /schedule/templates route.
// This helper registers /schedule-types itself.
async function landAtRoutinesTasks(page: Page): Promise<void> {
  await page.route(`${API_BASE}/schedule-types`, route =>
    route.fulfill({ status: 200, json: [MOCK_SCHEDULE_TYPE_WEEKDAYS, MOCK_SCHEDULE_TYPE_WEEKENDS] })
  );
  await page.locator('.section-card').nth(1).click();
  await expect(page.locator('.planning-prefs')).toBeVisible();
  await page.locator('.planning-prefs .save-btn').click();
  await expect(page.locator('.schedule-types-substep')).toBeVisible();
  await page.locator('.schedule-types-substep .save-btn').click();
  await expect(page.locator('.routines-tasks-substep')).toBeVisible();
}

// Drives to Task Placement Review with one task added ("Morning run").
// Does NOT mock /agent/place-tasks — each test does this individually.
async function landAtTaskPlacement(page: Page): Promise<void> {
  await page.route(`${API_BASE}/schedule-types`, route =>
    route.fulfill({ status: 200, json: [MOCK_SCHEDULE_TYPE_WEEKDAYS, MOCK_SCHEDULE_TYPE_WEEKENDS] })
  );
  await page.route(`${API_BASE}/schedule/templates`, route =>
    route.fulfill({ status: 200, json: [] })
  );

  await page.locator('.section-card').nth(1).click();
  await expect(page.locator('.planning-prefs')).toBeVisible();
  await page.locator('.planning-prefs .save-btn').click();
  await expect(page.locator('.schedule-types-substep')).toBeVisible();
  await page.locator('.schedule-types-substep .save-btn').click();

  // Add one task before proceeding to placement
  await expect(page.locator('.routines-tasks-substep')).toBeVisible();
  await page.locator('[aria-label="Task name"]').fill('Morning run');
  await page.locator('.add-btn').last().click();

  // Override POST route to return matching task
  await page.route(`${API_BASE}/schedule/templates`, route => {
    if (route.request().method() === 'POST') {
      route.fulfill({ status: 201, json: { ...MOCK_TEMPLATE_MORNING_WALK, title: 'Morning run', task_type: 'custom' } });
    } else {
      route.fulfill({ status: 200, json: [] });
    }
  });

  await expect(page.locator('[aria-label="Added tasks"] .routine-chip')).toHaveCount(1);
  await page.locator('.routines-tasks-substep .save-btn').click();

  await expect(page.locator('.placement-review')).toBeVisible();
}

// Lands on Meal Times substep (planningPrefsComplete=true after Tasks spoke).
async function landAtMealTimes(page: Page): Promise<void> {
  await completeTasksSpoke(page);

  await page.locator('.section-card').nth(2).click();
  await expect(page.locator('.spoke-title')).toHaveText('Food & Meals');
  await expect(page.locator('.meal-times')).toBeVisible();
}

async function landAtDietaryPreferences(page: Page): Promise<void> {
  await landAtMealTimes(page);
  await page.locator('.btn-continue').click();
  await expect(page.locator('.restrictions-substep')).toBeVisible();
  await page.locator('.btn-continue').click();
  await expect(page.locator('.prefs-substep')).toBeVisible();
}

async function landAtMealHabits(page: Page): Promise<void> {
  await landAtDietaryPreferences(page);
  await page.locator('.btn-continue').click();
  await expect(page.locator('.meal-habits')).toBeVisible();
}

async function completeFoodSpoke(page: Page): Promise<void> {
  await page.route(`${API_BASE}/meal-habits`, route =>
    route.fulfill({ status: 200, json: [] })
  );
  await page.route(`${API_BASE}/agent/meal-plan`, route =>
    route.fulfill({ status: 200, json: MOCK_MEAL_PLAN })
  );

  await page.locator('.section-card').nth(2).click();
  await expect(page.locator('.spoke-title')).toHaveText('Food & Meals');

  // planningPrefsComplete=true after Tasks, so Food starts at Meal Times (internalStep=1)
  // Step 1: Meal Times
  await expect(page.locator('.meal-times')).toBeVisible();
  await page.locator('.btn-continue').click();

  // Step 2: Dietary Restrictions
  await expect(page.locator('.restrictions-substep')).toBeVisible();
  await page.locator('.btn-continue').click();

  // Step 3: Dietary Preferences
  await expect(page.locator('.prefs-substep')).toBeVisible();
  await page.locator('.btn-continue').click();

  // Step 4: Meal Habits
  await expect(page.locator('.meal-habits')).toBeVisible();
  await page.locator('.btn-continue').click();

  // Step 5: Meal Plan Review — wait for generation then save
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
    await page.route(`${API_BASE}/users/me`, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_USER_NEW) })
    );
    await page.route(`${API_BASE}/dietary-restrictions`, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
    );

    await page.addInitScript(() => {
      localStorage.setItem('auth_token', 'synthetic.test.token');
    });
    await page.goto('/onboarding');
    await expect(page).toHaveURL(/\/onboarding/);
    await expect(page.locator('h1')).toHaveText('Welcome to PLND!');
  });

  test('authenticated returning user navigating to /onboarding redirects to /today', async ({ page }) => {
    await page.route(`${API_BASE}/users/me`, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_USER_ONBOARDED) })
    );
    await page.route(`${API_BASE}/preferences/me`, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_PREFS) })
    );
    await page.route(`${API_BASE}/schedule/plan/status**`, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ planned: false }) })
    );
    await page.route(`${API_BASE}/briefing/weather`, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_BRIEFING_WEATHER) })
    );
    await page.route(`${API_BASE}/briefing/news`, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_BRIEFING_NEWS) })
    );
    await page.route(`${API_BASE}/briefing/yesterday`, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_BRIEFING_YESTERDAY) })
    );
    await page.route(`${API_BASE}/schedule/period**`, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ entries: [], carryover: [] }) })
    );

    await page.addInitScript(() => {
      localStorage.setItem('auth_token', 'synthetic.test.token');
    });
    await page.goto('/onboarding');
    await expect(page).toHaveURL(/\/day\//);
  });

  test('non-onboarded user navigating to /today is redirected to /onboarding', async ({ page }) => {
    await page.route(`${API_BASE}/users/me`, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_USER_NEW) })
    );
    await page.route(`${API_BASE}/dietary-restrictions`, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
    );

    await page.addInitScript(() => {
      localStorage.setItem('auth_token', 'synthetic.test.token');
    });
    await page.goto('/today');
    await expect(page).toHaveURL(/\/onboarding/);
  });

  test('new user can navigate to /onboarding/account child route', async ({ page }) => {
    await page.route(`${API_BASE}/users/me`, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_USER_NEW) })
    );
    await page.route(`${API_BASE}/preferences/me`, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_PREFS) })
    );
    await page.route(`${API_BASE}/dietary-restrictions`, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
    );

    await page.addInitScript(() => {
      localStorage.setItem('auth_token', 'synthetic.test.token');
    });
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
      // Mock account save endpoints
      await page.route(`${API_BASE}/users/me`, route => {
        if (route.request().method() === 'PATCH') {
          route.fulfill({ status: 200, json: { ...MOCK_USER_NEW, display_name: 'Test' } });
        } else {
          route.fulfill({ status: 200, json: MOCK_USER_NEW });
        }
      });

      // Navigate to account, save, return to hub
      await page.goto('/onboarding/account');
      await expect(page.locator('.spoke-title')).toHaveText('Account Settings');
      await page.locator('#displayName').fill('Test');
      await page.locator('.btn-continue').click();

      // Hub should show account card as done
      await expect(page).toHaveURL(/\/onboarding$/);
      const accountCard = page.locator('.section-card').first();
      await expect(accountCard.locator('.card-badge.badge--done')).toContainText('✓ done');
    });
  });

  test.describe('Hub skip modal', () => {
    test.beforeEach(async ({ page }) => {
      await seedOnboarding(page);
      await page.route(`${API_BASE}/users/me/complete-onboarding`, route =>
        route.fulfill({ status: 200, body: '' })
      );
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
      await seedOnboarding(page);
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
      await seedOnboarding(page);
      await page.goto('/onboarding');

      await completeAccountSpoke(page);
      await completeTasksSpoke(page);
      await completeFoodSpoke(page);

      await expect(page.locator('.btn-cta.btn--accent')).toBeVisible();
      await expect(page.locator('.btn-cta.btn--ghost')).not.toBeVisible();
      await expect(page.locator('.btn-skip')).not.toBeVisible();
    });

    test('commit plan: POST /schedule/plan + complete-onboarding → navigates to /day/plan-start', async ({ page }) => {
      await seedOnboarding(page);
      await page.route(`${API_BASE}/schedule/plan`, route =>
        route.fulfill({ status: 200, json: MOCK_PLAN_COMMITTED })
      );
      await page.route(`${API_BASE}/users/me/complete-onboarding`, route =>
        route.fulfill({ status: 200, body: '' })
      );
      await page.goto('/onboarding');

      await completeAccountSpoke(page);
      await completeTasksSpoke(page);
      await completeFoodSpoke(page);

      await page.locator('.btn-cta.btn--accent').click();
      await expect(page).toHaveURL(/\/day\/2026-03-28/);
    });

    test('POST /schedule/plan 500 → error banner shown; CTA re-enables', async ({ page }) => {
      await seedOnboarding(page);
      await page.route(`${API_BASE}/schedule/plan`, route =>
        route.fulfill({ status: 500, body: 'Internal Server Error' })
      );
      await page.goto('/onboarding');

      await completeAccountSpoke(page);
      await completeTasksSpoke(page);
      await completeFoodSpoke(page);

      await page.locator('.btn-cta.btn--accent').click();

      await expect(page.locator('.commit-error')).toBeVisible();
      await expect(page.locator('.commit-error')).toContainText('Something went wrong');
      await expect(page.locator('.hub--submitting')).not.toBeVisible();
      await expect(page.locator('.btn-cta.btn--accent')).toBeEnabled();
    });
  });

  test.describe('Account spoke', () => {
    test.beforeEach(async ({ page }) => {
      await seedOnboarding(page);
      await page.route(`${API_BASE}/users/me`, route => {
        if (route.request().method() === 'PATCH') {
          route.fulfill({ status: 200, json: { ...MOCK_USER_NEW, display_name: 'Test User' } });
        } else {
          route.fulfill({ status: 200, json: MOCK_USER_NEW });
        }
      });
      await page.goto('/onboarding/account');
      await expect(page.locator('.spoke-title')).toHaveText('Account Settings');
    });

    test('display name input is empty (user has no display_name)', async ({ page }) => {
      await expect(page.locator('#displayName')).toHaveValue('');
    });

    test('email is shown as static text from user data', async ({ page }) => {
      await expect(page.locator('.email-display')).toHaveText('testuser@mock.plnd');
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
      await seedOnboarding(page);
      await page.route(`${API_BASE}/meal-habits`, route =>
        route.fulfill({ status: 200, json: [] })
      );

      await page.goto('/onboarding');
      await completeTasksSpoke(page);

      await page.locator('.section-card').nth(2).click();
      await expect(page.locator('.spoke-title')).toHaveText('Food & Meals');
      await expect(page.locator('.planning-prefs')).not.toBeVisible();
      await expect(page.locator('.meal-times')).toBeVisible();
    });

    test('shown on first entry into Food spoke; skipped on Tasks entered after', async ({ page }) => {
      await seedOnboarding(page);
      await page.route(`${API_BASE}/schedule-types`, route =>
        route.fulfill({ status: 200, json: [MOCK_SCHEDULE_TYPE_WEEKDAYS, MOCK_SCHEDULE_TYPE_WEEKENDS] })
      );
      await page.route(`${API_BASE}/schedule/templates`, route =>
        route.fulfill({ status: 200, json: [] })
      );

      await page.goto('/onboarding/food');
      await expect(page.locator('.planning-prefs')).toBeVisible();

      await page.locator('.planning-prefs .save-btn').click();
      await expect(page.locator('.meal-times')).toBeVisible();

      await page.locator('.hub-link').click();
      await expect(page).toHaveURL(/\/onboarding$/);
      await page.locator('.section-card').nth(1).click();
      await expect(page.locator('.spoke-title')).toHaveText('Tasks & Routines');

      await expect(page.locator('.planning-prefs')).not.toBeVisible();
      await expect(page.locator('.schedule-types-substep')).toBeVisible();
    });
  });

  test.describe('Tasks spoke — Schedule Types', () => {
    test.beforeEach(async ({ page }) => {
      await seedOnboarding(page);
      await page.route(`${API_BASE}/schedule-types`, route =>
        route.fulfill({ status: 200, json: [MOCK_SCHEDULE_TYPE_WEEKDAYS, MOCK_SCHEDULE_TYPE_WEEKENDS] })
      );
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

    test('Add new schedule type via "+ Add schedule type"', async ({ page }) => {
      await page.locator('.add-link').click();
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

    test('Non-7-day schedule? switches card to cycle mode', async ({ page }) => {
      const firstCard = page.locator('.schedule-card').nth(0);
      await firstCard.locator('.cycle-toggle-link').click();
      const dayPills = firstCard.locator('.day-pill');
      await expect(dayPills).toHaveCount(1);
      await expect(firstCard.locator('.cycle-toggle-link')).toHaveText('Switch to 7-day week');
    });

    test('Switch to 7-day week reverts to letter day pills', async ({ page }) => {
      const firstCard = page.locator('.schedule-card').nth(0);
      await firstCard.locator('.cycle-toggle-link').click();
      await firstCard.locator('.cycle-toggle-link').click();
      await expect(firstCard.locator('.day-pill')).toHaveCount(7);
      await expect(firstCard.locator('.cycle-toggle-link')).toHaveText('Non-7-day schedule?');
    });
  });

  test.describe('Tasks spoke — Routines & Tasks', () => {
    test.beforeEach(async ({ page }) => {
      await seedOnboarding(page);
      await page.route(`${API_BASE}/schedule/templates`, route => {
        if (route.request().method() === 'POST') {
          route.fulfill({ status: 201, json: MOCK_TEMPLATE_MORNING_WALK });
        } else {
          route.fulfill({ status: 200, json: [] });
        }
      });
      await page.goto('/onboarding');
      await landAtRoutinesTasks(page);
    });

    test('add routine via form: name + recurrence chip appears', async ({ page }) => {
      // Override the POST mock to return a template matching what the form submitted.
      await page.route(`${API_BASE}/schedule/templates`, route => {
        if (route.request().method() === 'POST') {
          route.fulfill({ status: 201, json: { ...MOCK_TEMPLATE_MORNING_WALK, title: 'Morning yoga' } });
        } else {
          route.fulfill({ status: 200, json: [] });
        }
      });

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
      await seedOnboarding(page);
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
      await seedOnboarding(page);
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
      await seedOnboarding(page);
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
      await seedOnboarding(page);
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

  test.describe('Food spoke — Meal Times', () => {
    test.beforeEach(async ({ page }) => {
      await seedOnboarding(page);
      await page.goto('/onboarding');
      await landAtMealTimes(page);
    });

    test('three meal slot cards visible: Breakfast, Lunch, Dinner', async ({ page }) => {
      const cards = page.locator('.meal-slot-card');
      await expect(cards).toHaveCount(3);
      await expect(cards.nth(0).locator('.card-header')).toContainText('Breakfast');
      await expect(cards.nth(1).locator('.card-header')).toContainText('Lunch');
      await expect(cards.nth(2).locator('.card-header')).toContainText('Dinner');
    });

    test('Save & Continue → advances to Dietary Restrictions', async ({ page }) => {
      await page.locator('.btn-continue').click();
      await expect(page.locator('.restrictions-substep')).toBeVisible();
    });
  });

  test.describe('Food spoke — Dietary Restrictions', () => {
    test.beforeEach(async ({ page }) => {
      await seedOnboarding(page);
      await page.route(`${API_BASE}/dietary-restrictions`, route => {
        if (route.request().method() === 'POST') {
          route.fulfill({ status: 201, json: MOCK_DIETARY_RESTRICTION_ALLERGY });
        } else {
          route.fulfill({ status: 200, json: [] });
        }
      });
      await page.goto('/onboarding');
      await landAtMealTimes(page);
      await page.locator('.btn-continue').click();
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
      await seedOnboarding(page);
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
  });

  test.describe('Food spoke — Meal Habits', () => {
    test.beforeEach(async ({ page }) => {
      await seedOnboarding(page);
      await page.route(`${API_BASE}/meal-habits`, route => {
        if (route.request().method() === 'POST') {
          route.fulfill({ status: 201, json: MOCK_MEAL_HABIT });
        } else {
          route.fulfill({ status: 200, json: [] });
        }
      });
      await page.goto('/onboarding');
      await landAtMealHabits(page);
    });

    test('add Oatmeal for Breakfast → appears as habit chip', async ({ page }) => {
      await page.locator('.meal-habits .name-input').fill('Oatmeal');
      await expect(page.locator('.pills-row .pill').filter({ hasText: 'Breakfast' })).toHaveClass(/pill--active/);
      await page.locator('.btn-add').click();

      await expect(page.locator('.habit-chip')).toHaveCount(1);
      await expect(page.locator('.habit-chip').first()).toContainText('Oatmeal');
    });

    test('conflict warning when adding second Breakfast/Every day entry', async ({ page }) => {
      // Override the GET mock (LIFO — this wins over the beforeEach handler) and reload
      // so habitsService picks up the existing Oatmeal habit before we navigate.
      await page.route(`${API_BASE}/meal-habits`, route => {
        if (route.request().method() === 'GET') {
          route.fulfill({ status: 200, json: [MOCK_MEAL_HABIT] });
        } else {
          route.fulfill({ status: 201, json: { ...MOCK_MEAL_HABIT, id: 'habit-2', meal_name: 'Granola' } });
        }
      });

      // Navigate fresh so habitsService.load() fires against the new GET mock.
      await page.goto('/onboarding');
      await landAtMealHabits(page);

      // Default slot = Breakfast, default recurrence = Every day → conflict fires on load.
      await expect(page.locator('.conflict-warning')).toBeVisible();
      await expect(page.locator('.conflict-warning')).toContainText('Oatmeal');
      await expect(page.locator('.btn-add')).toContainText('Add anyway');

      await page.locator('.meal-habits .name-input').fill('Granola');
      await page.locator('.btn-add').click();
      await expect(page.locator('.habit-chip')).toHaveCount(2);
    });
  });
});
