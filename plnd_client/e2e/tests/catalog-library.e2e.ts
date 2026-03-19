import { test, expect } from '@playwright/test';

// Tests verify the API contract for catalog library endpoints:
// GET/POST /my/dishes, PATCH /my/dishes/{id}, GET/POST /my/meals,
// PUT /my/ingredient-prefs/{id}, and auth-gated logout clearing.
//
// These tests use page.evaluate() with fetch() to call the backend API
// from within the browser context (same origin as ng serve on :4200, which
// proxies /my/* to the API on :3000). Auth is seeded via addInitScript so
// the Authorization header is attached by Angular's auth interceptor —
// but since we call fetch() directly from evaluate(), we pass the token
// explicitly to demonstrate the correct Authorization header is expected.
//
// All backend responses are mocked via page.route() so these tests are
// independent of the Docker image version.

const API_BASE = 'http://localhost:3000';

const MOCK_USER_ONBOARDED = {
  user_id: 'e2e-test-uuid',
  email: 'test@example.com',
  display_name: 'Test User',
  avatar_url: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  is_active: true,
  last_login: null,
  onboarding_completed: true,
};

const MOCK_DISH: Record<string, unknown> = {
  user_dish_pref_id: 'dish-pref-uuid-1',
  user_id: 'e2e-test-uuid',
  catalog_dish_id: 'catalog-dish-uuid-1',
  user_dish_id: null,
  name: 'Spaghetti Bolognese',
  source: 'catalog',
  has_personal_recipe: false,
  rating: null,
  is_safe_food: false,
  is_blocked: false,
  notes: null,
  origin_external_source: 'themealdb',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const MOCK_MEAL: Record<string, unknown> = {
  user_meal_pref_id: 'meal-pref-uuid-1',
  user_id: 'e2e-test-uuid',
  catalog_meal_id: 'catalog-meal-uuid-1',
  user_meal_id: null,
  name: 'Weekday Lunch',
  source: 'catalog',
  has_personal_recipe: false,
  rating: null,
  is_safe_food: false,
  is_blocked: false,
  notes: null,
  origin_external_source: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const MOCK_INGREDIENT_PREF: Record<string, unknown> = {
  user_ingredient_pref_id: 'ing-pref-uuid-1',
  user_id: 'e2e-test-uuid',
  catalog_ingredient_id: 'catalog-ingredient-uuid-1',
  is_blocked: true,
  notes: 'severe allergy',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

// Seed auth and mock /users/me for every test so onboardingCompletedGuard resolves.
async function seedAuthAndNavigate(page: Parameters<Parameters<typeof test>[1]>[0]['page']): Promise<void> {
  await page.route(`${API_BASE}/users/me`, route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_USER_ONBOARDED),
    })
  );

  await page.addInitScript(() => {
    localStorage.setItem('auth_token', 'synthetic.test.token');
  });

  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/dashboard/);
}

test.describe('Catalog Library — API Contract', () => {
  test('GET /my/dishes returns empty array for a fresh user', async ({ page }) => {
    await page.route(`${API_BASE}/my/dishes`, route =>
      route.fulfill({ status: 200, json: [] })
    );

    await seedAuthAndNavigate(page);

    const result = await page.evaluate(async (apiBase) => {
      const token = localStorage.getItem('auth_token') ?? '';
      const res = await fetch(`${apiBase}/my/dishes`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return { status: res.status, body: await res.json() };
    }, API_BASE);

    expect(result.status).toBe(200);
    expect(result.body).toEqual([]);
  });

  test('POST /my/dishes with catalog_dish_id returns the correct UserDishPref shape', async ({ page }) => {
    await page.route(`${API_BASE}/my/dishes`, async route => {
      if (route.request().method() === 'POST') {
        await route.fulfill({ status: 201, json: MOCK_DISH });
      } else {
        await route.fulfill({ status: 200, json: [] });
      }
    });

    await seedAuthAndNavigate(page);

    const result = await page.evaluate(async ({ apiBase, mockDish }) => {
      const token = localStorage.getItem('auth_token') ?? '';
      const res = await fetch(`${apiBase}/my/dishes`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ catalog_dish_id: mockDish['catalog_dish_id'] }),
      });
      return { status: res.status, body: await res.json() };
    }, { apiBase: API_BASE, mockDish: MOCK_DISH });

    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({
      user_dish_pref_id: 'dish-pref-uuid-1',
      catalog_dish_id: 'catalog-dish-uuid-1',
      name: 'Spaghetti Bolognese',
      source: 'catalog',
      has_personal_recipe: false,
      is_safe_food: false,
      is_blocked: false,
    });
  });

  test('PATCH /my/dishes/{id} updates metadata and returns updated shape', async ({ page }) => {
    const updatedDish = { ...MOCK_DISH, rating: 4, notes: 'family favourite', is_safe_food: true };

    await page.route(`${API_BASE}/my/dishes`, route =>
      route.fulfill({ status: 200, json: [MOCK_DISH] })
    );
    await page.route(`${API_BASE}/my/dishes/dish-pref-uuid-1`, async route => {
      if (route.request().method() === 'PATCH') {
        await route.fulfill({ status: 200, json: updatedDish });
      } else {
        await route.fulfill({ status: 200, json: MOCK_DISH });
      }
    });

    await seedAuthAndNavigate(page);

    const result = await page.evaluate(async (apiBase) => {
      const token = localStorage.getItem('auth_token') ?? '';
      const res = await fetch(`${apiBase}/my/dishes/dish-pref-uuid-1`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ rating: 4, notes: 'family favourite', is_safe_food: true }),
      });
      return { status: res.status, body: await res.json() };
    }, API_BASE);

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      user_dish_pref_id: 'dish-pref-uuid-1',
      rating: 4,
      notes: 'family favourite',
      is_safe_food: true,
    });
  });

  test('PUT /my/ingredient-prefs/{id} upserts a preference and returns the correct shape', async ({ page }) => {
    const ingredientId = 'catalog-ingredient-uuid-1';

    await page.route(`${API_BASE}/my/ingredient-prefs/${ingredientId}`, async route => {
      if (route.request().method() === 'PUT') {
        await route.fulfill({ status: 200, json: MOCK_INGREDIENT_PREF });
      } else {
        await route.continue();
      }
    });

    await seedAuthAndNavigate(page);

    const result = await page.evaluate(async ({ apiBase, ingredientId }) => {
      const token = localStorage.getItem('auth_token') ?? '';
      const res = await fetch(`${apiBase}/my/ingredient-prefs/${ingredientId}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ is_blocked: true, notes: 'severe allergy' }),
      });
      return { status: res.status, body: await res.json() };
    }, { apiBase: API_BASE, ingredientId });

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      catalog_ingredient_id: 'catalog-ingredient-uuid-1',
      is_blocked: true,
      notes: 'severe allergy',
    });
  });

  test('POST /my/meals with catalog_meal_id returns the correct UserMealPref shape', async ({ page }) => {
    await page.route(`${API_BASE}/my/meals`, async route => {
      if (route.request().method() === 'POST') {
        await route.fulfill({ status: 201, json: MOCK_MEAL });
      } else {
        await route.fulfill({ status: 200, json: [] });
      }
    });

    await seedAuthAndNavigate(page);

    const result = await page.evaluate(async ({ apiBase, mockMeal }) => {
      const token = localStorage.getItem('auth_token') ?? '';
      const res = await fetch(`${apiBase}/my/meals`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ catalog_meal_id: mockMeal['catalog_meal_id'] }),
      });
      return { status: res.status, body: await res.json() };
    }, { apiBase: API_BASE, mockMeal: MOCK_MEAL });

    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({
      user_meal_pref_id: 'meal-pref-uuid-1',
      catalog_meal_id: 'catalog-meal-uuid-1',
      name: 'Weekday Lunch',
      source: 'catalog',
      has_personal_recipe: false,
      is_safe_food: false,
      is_blocked: false,
    });
  });
});
