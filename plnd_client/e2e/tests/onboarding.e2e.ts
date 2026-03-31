import { test, expect, Page } from '@playwright/test';
import { API_BASE, MOCK_USER_NEW, MOCK_USER_ONBOARDED, MOCK_PREFS } from '../helpers/auth';

test.describe('Onboarding', () => {
  test('unauthenticated /onboarding visit redirects to /login', async ({ page }) => {
    await page.goto('/onboarding');
    await expect(page).toHaveURL(/\/login/);
  });

  test('authenticated new user lands on onboarding wizard', async ({ page }) => {
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

  test('user can skip all steps and land on /day/:date', async ({ page }) => {
    await page.route(`${API_BASE}/users/me`, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_USER_NEW) })
    );
    await page.route(`${API_BASE}/dietary-restrictions`, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
    );
    await page.route(`${API_BASE}/users/me/complete-onboarding`, route =>
      route.fulfill({ status: 200 })
    );
    // After onboarding completes, the app navigates to /today → MainLayout loads.
    // Mock preferences and plan status so the synthetic token doesn't trigger session_expired.
    await page.route(`${API_BASE}/preferences/me`, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_PREFS) })
    );
    await page.route(`${API_BASE}/schedule/plan/status**`, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ planned: false }) })
    );

    await page.addInitScript(() => {
      localStorage.setItem('auth_token', 'synthetic.test.token');
    });
    await page.goto('/onboarding');

    // Welcome step
    await expect(page.locator('h1')).toHaveText('Welcome to PLND!');
    await page.getByRole('button', { name: 'Get Started' }).click();

    // Profile step — skip
    await expect(page.locator('h1')).toHaveText('Your Profile');
    await page.getByRole('button', { name: 'Skip' }).click();

    // Restrictions step — skip (also calls finish)
    await expect(page.locator('h1')).toHaveText('Dietary Restrictions');
    await page.getByRole('button', { name: 'Skip' }).click();

    // Should land on /day/:date after complete-onboarding POST
    await expect(page).toHaveURL(/\/day\//, { timeout: 10_000 });
  });
});

// Helper: mock a new-user onboarding session and navigate to the Welcome step.
async function startOnboarding(page: Page): Promise<void> {
  await page.route(`${API_BASE}/users/me`, route =>
    route.fulfill({ status: 200, json: MOCK_USER_NEW })
  );
  await page.route(`${API_BASE}/dietary-restrictions`, route =>
    route.fulfill({ status: 200, json: [] })
  );
  await page.addInitScript(() => {
    localStorage.setItem('auth_token', 'synthetic.test.token');
  });
  await page.goto('/onboarding');
  await expect(page.locator('h1')).toHaveText('Welcome to PLND!');
  await page.getByRole('button', { name: 'Get Started' }).click();
  await expect(page.locator('h1')).toHaveText('Your Profile');
}

test.describe('Step 2 — profile', () => {
  test('display name field is visible and accepts input', async ({ page }) => {
    await startOnboarding(page);

    const nameInput = page.locator('#display-name');
    await expect(nameInput).toBeVisible();
    await nameInput.fill('Alex');
    await expect(nameInput).toHaveValue('Alex');
  });

  test('entering a name and clicking Next Step calls PATCH /users/me with the name and advances to restrictions', async ({ page }) => {
    let capturedBody: Record<string, unknown> | null = null;

    await page.route(`${API_BASE}/users/me`, async route => {
      if (route.request().method() === 'PATCH') {
        capturedBody = route.request().postDataJSON() as Record<string, unknown>;
        await route.fulfill({ status: 200, json: { ...MOCK_USER_NEW, display_name: 'Alex' } });
      } else {
        await route.fulfill({ status: 200, json: MOCK_USER_NEW });
      }
    });
    await page.route(`${API_BASE}/dietary-restrictions`, route =>
      route.fulfill({ status: 200, json: [] })
    );
    await page.addInitScript(() => {
      localStorage.setItem('auth_token', 'synthetic.test.token');
    });
    await page.goto('/onboarding');
    await page.getByRole('button', { name: 'Get Started' }).click();

    await page.locator('#display-name').fill('Alex');
    await page.getByRole('button', { name: /Next Step/ }).click();

    await expect(page.locator('h1')).toHaveText('Dietary Restrictions');
    expect(capturedBody).toMatchObject({ display_name: 'Alex' });
  });

  test('leaving name blank and clicking Next Step advances to restrictions without calling PATCH /users/me', async ({ page }) => {
    let patchCalled = false;

    await page.route(`${API_BASE}/users/me`, async route => {
      if (route.request().method() === 'PATCH') {
        patchCalled = true;
        await route.fulfill({ status: 200, json: MOCK_USER_NEW });
      } else {
        await route.fulfill({ status: 200, json: MOCK_USER_NEW });
      }
    });
    await page.route(`${API_BASE}/dietary-restrictions`, route =>
      route.fulfill({ status: 200, json: [] })
    );
    await page.addInitScript(() => {
      localStorage.setItem('auth_token', 'synthetic.test.token');
    });
    await page.goto('/onboarding');
    await page.getByRole('button', { name: 'Get Started' }).click();

    await page.getByRole('button', { name: /Next Step/ }).click();

    await expect(page.locator('h1')).toHaveText('Dietary Restrictions');
    expect(patchCalled).toBe(false);
  });
});

test.describe('Step 3 — dietary restrictions', () => {
  test('restriction add form is visible', async ({ page }) => {
    await startOnboarding(page);
    await page.getByRole('button', { name: 'Skip' }).click();

    await expect(page.locator('h1')).toHaveText('Dietary Restrictions');
    await expect(page.locator('#r-type')).toBeVisible();
    await expect(page.locator('#r-name')).toBeVisible();
    await expect(page.locator('#r-notes')).toBeVisible();
  });

  test('adding a restriction shows it as a chip', async ({ page }) => {
    await startOnboarding(page);

    await page.route(`${API_BASE}/dietary-restrictions`, async route => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 201,
          json: {
            restriction_id: 'uuid-new',
            user_id: 'e2e-test-uuid',
            restriction_type: 'allergy',
            name: 'peanuts',
            notes: null,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z'
          }
        });
      } else {
        await route.fallback();
      }
    });

    await page.getByRole('button', { name: 'Skip' }).click();

    await page.locator('#r-name').fill('peanuts');
    await page.getByRole('button', { name: 'Add' }).click();

    await expect(page.locator('.chip')).toHaveCount(1);
    await expect(page.locator('.chip-name')).toHaveText('peanuts');
    await expect(page.locator('.chip-type')).toHaveText('Allergy');
  });

  test('multiple restrictions can be added before completing', async ({ page }) => {
    let postCount = 0;

    await page.route(`${API_BASE}/users/me`, route =>
      route.fulfill({ status: 200, json: MOCK_USER_NEW })
    );
    await page.route(`${API_BASE}/dietary-restrictions`, async route => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ status: 200, json: [] });
      } else if (route.request().method() === 'POST') {
        postCount += 1;
        const body = route.request().postDataJSON() as { restriction_type: string; name: string };
        await route.fulfill({
          status: 201,
          json: {
            restriction_id: `uuid-${postCount}`,
            user_id: 'e2e-test-uuid',
            restriction_type: body.restriction_type,
            name: body.name,
            notes: null,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z'
          }
        });
      } else {
        await route.continue();
      }
    });
    await page.addInitScript(() => {
      localStorage.setItem('auth_token', 'synthetic.test.token');
    });
    await page.goto('/onboarding');
    await page.getByRole('button', { name: 'Get Started' }).click();
    await page.getByRole('button', { name: 'Skip' }).click();

    // Add first restriction
    await page.locator('#r-name').fill('peanuts');
    await page.getByRole('button', { name: 'Add' }).click();
    await expect(page.locator('.chip')).toHaveCount(1);

    // Add second restriction
    await page.locator('#r-type').selectOption('intolerance');
    await page.locator('#r-name').fill('lactose');
    await page.getByRole('button', { name: 'Add' }).click();
    await expect(page.locator('.chip')).toHaveCount(2);
  });

  test('clicking Done calls POST /users/me/complete-onboarding and redirects to /day/:date', async ({ page }) => {
    let onboardingCompleteCalled = false;

    await page.route(`${API_BASE}/users/me`, route =>
      route.fulfill({ status: 200, json: MOCK_USER_NEW })
    );
    await page.route(`${API_BASE}/dietary-restrictions`, route =>
      route.fulfill({ status: 200, json: [] })
    );
    await page.route(`${API_BASE}/users/me/complete-onboarding`, async route => {
      onboardingCompleteCalled = true;
      await route.fulfill({ status: 200 });
    });
    await page.route(`${API_BASE}/preferences/me`, route =>
      route.fulfill({ status: 200, json: MOCK_PREFS })
    );
    await page.route(`${API_BASE}/schedule/plan/status**`, route =>
      route.fulfill({ status: 200, json: { planned: false } })
    );
    await page.addInitScript(() => {
      localStorage.setItem('auth_token', 'synthetic.test.token');
    });
    await page.goto('/onboarding');
    await page.getByRole('button', { name: 'Get Started' }).click();
    await page.getByRole('button', { name: 'Skip' }).click();

    await page.getByRole('button', { name: 'Done' }).click();

    await expect(page).toHaveURL(/\/day\//, { timeout: 10_000 });
    expect(onboardingCompleteCalled).toBe(true);
  });
});
