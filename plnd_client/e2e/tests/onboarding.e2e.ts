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
});
