import { test, expect, Page } from '@playwright/test';
import { API_BASE, seedAuth } from '../helpers/auth';
import { seedCatalogIngredient, seedDish } from '../helpers/seed-data';

// Tests verify the API contract for catalog library endpoints:
// GET/POST /my/dishes, PATCH /my/dishes/{id}, GET/POST /my/meals,
// PUT /my/ingredient-prefs/{id}.
//
// These tests use page.evaluate() with fetch() to call the backend API
// from within the browser context (same origin as ng serve on :4200, which
// proxies /my/* to the API on :3000). Auth is seeded via injectAuthToken so
// the token in localStorage matches the per-test user; fetches inside
// page.evaluate() pick it up explicitly.
//
// All requests hit the real backend (per the e2e mock policy in
// docs/architecture.md §9.7); seeding is done via the same public APIs.

// Seed an onboarded user, navigate to /today, and surface the per-test sub so
// the test body can chain helpers (seedDish, etc.) under the same user_id.
async function seedAuthAndNavigate(page: Page): Promise<string> {
  const { sub } = await seedAuth(page);
  await page.goto('/today');
  await expect(page).toHaveURL(/\/day\//);
  return sub;
}

test.describe('Catalog Library — API Contract', () => {
  test('GET /my/dishes returns empty array for a fresh user', async ({ page }) => {
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

  test('POST /my/dishes with name returns the correct UserDishPref shape', async ({ page }) => {
    await seedAuthAndNavigate(page);

    const result = await page.evaluate(async (apiBase) => {
      const token = localStorage.getItem('auth_token') ?? '';
      const res = await fetch(`${apiBase}/my/dishes`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'Spaghetti Bolognese' }),
      });
      return { status: res.status, body: await res.json() };
    }, API_BASE);

    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({
      name: 'Spaghetti Bolognese',
      source: 'personal',
      has_personal_recipe: true,
      is_safe_food: false,
      is_blocked: false,
    });
    expect(result.body.user_dish_pref_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  test('PATCH /my/dishes/{id} updates metadata and returns updated shape', async ({ page }) => {
    const sub = await seedAuthAndNavigate(page);
    const seeded = await seedDish(sub, { name: 'Family Pasta' });

    const result = await page.evaluate(
      async ({ apiBase, prefId }) => {
        const token = localStorage.getItem('auth_token') ?? '';
        const res = await fetch(`${apiBase}/my/dishes/${prefId}`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ rating: 4, notes: 'family favourite', is_safe_food: true }),
        });
        return { status: res.status, body: await res.json() };
      },
      { apiBase: API_BASE, prefId: seeded.user_dish_pref_id },
    );

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      user_dish_pref_id: seeded.user_dish_pref_id,
      rating: 4,
      notes: 'family favourite',
      is_safe_food: true,
    });
  });

  test('PUT /my/ingredient-prefs/{id} upserts a preference and returns the correct shape', async ({
    page,
  }) => {
    const sub = await seedAuthAndNavigate(page);
    const { ingredient_id } = await seedCatalogIngredient(sub, 'Test Tomato');

    const result = await page.evaluate(
      async ({ apiBase, prefIngredientId }) => {
        const token = localStorage.getItem('auth_token') ?? '';
        const res = await fetch(`${apiBase}/my/ingredient-prefs/${prefIngredientId}`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ preference_score: -2, notes: 'severe allergy' }),
        });
        return { status: res.status, body: await res.json() };
      },
      { apiBase: API_BASE, prefIngredientId: ingredient_id },
    );

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      catalog_ingredient_id: ingredient_id,
      preference_score: -2,
      notes: 'severe allergy',
    });
    expect(result.body.user_ingredient_pref_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  test('POST /my/meals with name returns the correct UserMealPref shape', async ({ page }) => {
    await seedAuthAndNavigate(page);

    const result = await page.evaluate(async (apiBase) => {
      const token = localStorage.getItem('auth_token') ?? '';
      const res = await fetch(`${apiBase}/my/meals`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'Weekday Lunch' }),
      });
      return { status: res.status, body: await res.json() };
    }, API_BASE);

    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({
      name: 'Weekday Lunch',
      source: 'personal',
      has_personal_recipe: true,
      is_safe_food: false,
      is_blocked: false,
    });
    expect(result.body.user_meal_pref_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});
