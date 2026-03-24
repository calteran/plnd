import { test, expect } from '@playwright/test';

// All tests seed auth via addInitScript and intercept the dietary-restrictions API,
// so they are independent of the Docker API image version.

const API_BASE = 'http://localhost:3000';
const DR_URL = `${API_BASE}/dietary-restrictions`;

const MOCK_PREFS = {
  user_id: 'e2e-test-uuid',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  week_start_day: 1,
  planning_trigger_offset: 0,
  default_plan_length_days: 7
};

const MOCK_USER_ONBOARDED = {
  user_id: 'e2e-test-uuid',
  email: 'test@example.com',
  display_name: 'Test User',
  avatar_url: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  is_active: true,
  last_login: null,
  onboarding_completed: true
};

const MOCK_RESTRICTIONS = [
  {
    restriction_id: 'uuid-1',
    user_id: 'e2e-test-uuid',
    restriction_type: 'allergy',
    name: 'peanuts',
    notes: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z'
  },
  {
    restriction_id: 'uuid-2',
    user_id: 'e2e-test-uuid',
    restriction_type: 'intolerance',
    name: 'lactose',
    notes: 'mild',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z'
  }
];

test.describe('Dietary Restrictions', () => {
  test('unauthenticated /dietary-restrictions visit redirects to /login', async ({ page }) => {
    await page.goto('/dietary-restrictions');
    await expect(page).toHaveURL(/\/login/);
  });

  test('list renders restriction names', async ({ page }) => {
    await page.route(`${API_BASE}/users/me`, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_USER_ONBOARDED) })
    );
    await page.route(`${API_BASE}/preferences/me`, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_PREFS) })
    );
    await page.route(`${API_BASE}/schedule/plan/status**`, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ planned: false }) })
    );

    await page.route(`${DR_URL}`, async route => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ status: 200, json: MOCK_RESTRICTIONS });
      } else {
        await route.continue();
      }
    });

    await page.addInitScript(() => {
      localStorage.setItem('auth_token', 'synthetic.test.token');
    });
    await page.goto('/dietary-restrictions');

    await expect(page.locator('h1')).toHaveText('Dietary Restrictions');
    await expect(page.locator('.restriction-item').first()).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('body')).toContainText('peanuts');
    await expect(page.locator('body')).toContainText('lactose');
    await expect(page.locator('body')).toContainText('mild');
  });

  test('add restriction shows success and new item', async ({ page }) => {
    const newItem = {
      restriction_id: 'uuid-3',
      user_id: 'e2e-test-uuid',
      restriction_type: 'preference',
      name: 'vegan',
      notes: 'plant-based only',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z'
    };

    await page.route(`${API_BASE}/users/me`, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_USER_ONBOARDED) })
    );
    await page.route(`${API_BASE}/preferences/me`, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_PREFS) })
    );
    await page.route(`${API_BASE}/schedule/plan/status**`, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ planned: false }) })
    );

    await page.route(`${DR_URL}`, async route => {
      const method = route.request().method();
      if (method === 'GET') {
        await route.fulfill({ status: 200, json: MOCK_RESTRICTIONS });
      } else if (method === 'POST') {
        await route.fulfill({ status: 201, json: newItem });
      } else {
        await route.continue();
      }
    });

    await page.addInitScript(() => {
      localStorage.setItem('auth_token', 'synthetic.test.token');
    });
    await page.goto('/dietary-restrictions');
    await expect(page.locator('.restriction-item').first()).toBeVisible({ timeout: 5_000 });

    await page.locator('select#restriction-type').selectOption('preference');
    await page.locator('input#name').fill('vegan');
    await page.locator('textarea#notes').fill('plant-based only');

    await page.getByRole('button', { name: 'Add Restriction' }).click();
    await expect(page.locator('.status-success')).toHaveText('Restriction added.', { timeout: 10_000 });
    await expect(page.locator('body')).toContainText('vegan');
  });

  test('edit notes shows success and updated notes', async ({ page }) => {
    const updated = { ...MOCK_RESTRICTIONS[1], notes: 'severe' };

    await page.route(`${API_BASE}/users/me`, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_USER_ONBOARDED) })
    );
    await page.route(`${API_BASE}/preferences/me`, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_PREFS) })
    );
    await page.route(`${API_BASE}/schedule/plan/status**`, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ planned: false }) })
    );

    await page.route(`${DR_URL}`, async route => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ status: 200, json: MOCK_RESTRICTIONS });
      } else {
        await route.continue();
      }
    });

    await page.route(`${DR_URL}/uuid-2`, async route => {
      if (route.request().method() === 'PATCH') {
        await route.fulfill({ status: 200, json: updated });
      } else {
        await route.continue();
      }
    });

    await page.addInitScript(() => {
      localStorage.setItem('auth_token', 'synthetic.test.token');
    });
    await page.goto('/dietary-restrictions');
    await expect(page.locator('.restriction-item').first()).toBeVisible({ timeout: 5_000 });

    // Click the Edit button for the lactose item (second restriction-item)
    const items = page.locator('.restriction-item');
    await items.nth(1).getByRole('button', { name: 'Edit' }).click();

    const editTextarea = page.locator('.edit-textarea');
    await expect(editTextarea).toBeVisible();
    await editTextarea.fill('severe');

    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('.status-success')).toHaveText('Updated successfully.', { timeout: 10_000 });
    await expect(page.locator('body')).toContainText('severe');
  });

  test('delete restriction removes item from list', async ({ page }) => {
    await page.route(`${API_BASE}/users/me`, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_USER_ONBOARDED) })
    );
    await page.route(`${API_BASE}/preferences/me`, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_PREFS) })
    );
    await page.route(`${API_BASE}/schedule/plan/status**`, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ planned: false }) })
    );

    await page.route(`${DR_URL}`, async route => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ status: 200, json: MOCK_RESTRICTIONS });
      } else {
        await route.continue();
      }
    });

    await page.route(`${DR_URL}/uuid-1`, async route => {
      if (route.request().method() === 'DELETE') {
        await route.fulfill({ status: 204 });
      } else {
        await route.continue();
      }
    });

    await page.addInitScript(() => {
      localStorage.setItem('auth_token', 'synthetic.test.token');
    });
    await page.goto('/dietary-restrictions');
    await expect(page.locator('.restriction-item').first()).toBeVisible({ timeout: 5_000 });

    const initialCount = await page.locator('.restriction-item').count();
    expect(initialCount).toBe(2);

    // Delete the first item (peanuts/allergy)
    await page.locator('.restriction-item').first().getByRole('button', { name: 'Delete' }).click();
    await expect(page.locator('.status-success')).toHaveText('Restriction removed.', { timeout: 10_000 });
    await expect(page.locator('.restriction-item')).toHaveCount(1);
  });
});
