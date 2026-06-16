import { test, expect } from '../fixtures';
import { API_BASE, mintTestToken, generateTestSub } from '../helpers/auth';

// Branded-ingredient generic/brand normalization on promote (#913).
// API-only e2e exercising the real backend (per docs/architecture.md §9.7).
// The brand split is produced by the deterministic FixtureBrandNormalizer
// (debug builds) keyed on the Open Food Facts detail name.

async function authHeaders(sub: string): Promise<Record<string, string>> {
  const token = await mintTestToken(sub);
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

interface SearchResult {
  external_id: string;
  name: string;
}
interface LocalIngredient {
  name: string;
  brand: string | null;
}

test.describe('Branded ingredient normalization on promote (#913)', () => {
  test('promoting a branded OFF ingredient stores it under a generic name with brand', async () => {
    const sub = generateTestSub();
    const headers = await authHeaders(sub);

    // 1. Search surfaces the branded Open Food Facts product (non-canonical lane).
    const searchRes = await fetch(`${API_BASE}/search/ingredients?q=chicken%20breast`, { headers });
    expect(searchRes.status).toBe(200);
    const search = (await searchRes.json()) as { external: SearchResult[] };
    const branded = search.external.find((r) => r.external_id === '0096619488827');
    expect(branded, 'OFF branded fixture result present in search').toBeTruthy();

    // 2. Promote it — the backend runs the fixture brand normalizer on the detail name.
    const promoteRes = await fetch(`${API_BASE}/catalog/ingredients/promote`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ external_source: 'openfoodfacts', external_id: '0096619488827' }),
    });
    expect(promoteRes.status).toBe(201);

    // 3. The promoted row is now searchable under its clean generic name, with brand provenance.
    const afterRes = await fetch(`${API_BASE}/search/ingredients?q=chicken%20breast`, { headers });
    expect(afterRes.status).toBe(200);
    const after = (await afterRes.json()) as { local: LocalIngredient[] };
    expect(after.local.length, 'local search lane should be non-empty after promote').toBeGreaterThan(0);
    const promoted = after.local.find(
      (r) => r.brand === 'Kirkland Signature' && r.name === 'Chicken breast',
    );
    expect(
      promoted,
      'promoted row (name=Chicken breast, brand=Kirkland Signature) should appear in the local lane',
    ).toBeTruthy();
  });
});
