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

  // Path 2 — external-provider hit → ingest → preference.
  // The verify stack uses APP_EXTERNAL__FIXTURE_PATH so /search/ingredients
  // returns deterministic fixture data without live network calls.
  // Closes https://github.com/calteran/plnd/issues/797
  test('path-2: external search hit → ingest → ingredient-pref upsert returns correct shape', async ({
    page,
  }) => {
    await seedAuthAndNavigate(page);

    const result = await page.evaluate(async (apiBase) => {
      const token = localStorage.getItem('auth_token') ?? '';
      const authHeader = { Authorization: `Bearer ${token}` };
      const jsonHeaders = { ...authHeader, 'Content-Type': 'application/json' };

      // Step 1: Search — fixture provider returns deterministic external results.
      const searchRes = await fetch(`${apiBase}/search/ingredients?q=apple`, {
        headers: authHeader,
      });
      const searchBody = await searchRes.json();
      if (searchRes.status !== 200 || !searchBody.external?.length) {
        return { step: 'search', searchStatus: searchRes.status, searchBody };
      }

      // Pick the first external result. Under fixtures, /search/ingredients?q=apple
      // returns only USDA hits ("apple" is captured for USDA only — see
      // refresh-catalog-fixtures.sh USDA_ONLY_TERMS), so the hardcoded
      // external_source: 'usda_fdc' below is always correct.
      const hit = (
        searchBody.external as {
          external_id: string;
          name: string;
          description: string | null;
        }[]
      )[0];
      if (!hit) {
        return { step: 'search', searchStatus: searchRes.status, searchBody };
      }

      // Step 2: Ingest the external hit into the local catalog.
      const ingestRes = await fetch(`${apiBase}/catalog/ingredients/ingest`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({
          external_source: 'usda_fdc',
          external_id: hit.external_id,
          name: hit.name,
          description: hit.description ?? null,
        }),
      });
      const ingestBody = await ingestRes.json();
      if (ingestRes.status !== 201) {
        return { step: 'ingest', searchStatus: searchRes.status, ingestStatus: ingestRes.status, ingestBody, searchBody };
      }

      // Step 3: Upsert a preference against the newly-ingested ingredient.
      const prefRes = await fetch(
        `${apiBase}/my/ingredient-prefs/${ingestBody.ingredient_id}`,
        {
          method: 'PUT',
          headers: jsonHeaders,
          body: JSON.stringify({ preference_score: 1, notes: 'path-2 e2e' }),
        },
      );
      const prefBody = await prefRes.json();

      return {
        step: 'done',
        searchStatus: searchRes.status,
        externalCount: searchBody.external.length,
        ingestStatus: ingestRes.status,
        catalogIngredientId: ingestBody.ingredient_id,
        prefStatus: prefRes.status,
        prefBody,
      };
    }, API_BASE);

    expect(result.step, `stopped at ${result.step}`).toBe('done');
    expect(result.searchStatus).toBe(200);
    expect(result.externalCount).toBeGreaterThan(0);
    expect(result.ingestStatus).toBe(201);
    expect(result.catalogIngredientId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(result.prefStatus).toBe(200);
    expect(result.prefBody).toMatchObject({
      catalog_ingredient_id: result.catalogIngredientId,
      preference_score: 1,
      notes: 'path-2 e2e',
    });
    expect(result.prefBody.user_ingredient_pref_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(result.prefBody.user_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  test('POST /catalog/ingredients with name > 200 chars returns 422', async ({ page }) => {
    await seedAuthAndNavigate(page);
    const longName = 'a'.repeat(201);

    const result = await page.evaluate(
      async ({ apiBase, name }) => {
        const token = localStorage.getItem('auth_token') ?? '';
        const res = await fetch(`${apiBase}/catalog/ingredients`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ name }),
        });
        return { status: res.status };
      },
      { apiBase: API_BASE, name: longName },
    );

    expect(result.status).toBe(422);
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
