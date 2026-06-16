import { Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

// Defaults to :3000 so manual runs and `just dev` are unchanged. scripts/verify.sh
// sets API_BASE to the run's ephemeral API port. Mock-oauth stays :8080 (shared).
export const API_BASE = process.env['API_BASE'] ?? 'http://localhost:3000';

const MOCK_OAUTH_TOKEN_URL = 'http://localhost:8080/plnd-dev/token';
const BACKEND_TOKEN_EXCHANGE_URL = `${API_BASE}/auth/token`;
const BACKEND_TEST_SEED_URL = `${API_BASE}/test/seed`;
const MOCK_OAUTH_CLIENT_SECRET = 'mock-secret';

// Returns a fresh per-test OIDC subject. The /auth/token handler find-or-creates
// the user, so each unique sub yields a brand-new user row — the isolation
// primitive that lets parallel e2e tests share one DB. See docs/architecture.md
// §9 for the policy.
export function generateTestSub(): string {
  return `e2e-${randomUUID()}`;
}

// Cache is per-worker (per Node module instance) and keyed by `sub`. When a
// helper like seedAuth calls both injectAuthToken and seedTestState with the
// same generated sub, the cache prevents a second OIDC round-trip for that
// test. Across tests the keys are unique so there are no hits — which is
// correct, because each test wants its own identity.
const tokenCache = new Map<string, string>();

// Mints a real backend HS256 JWT by performing the full production auth flow:
//   1. Mint an OIDC id_token from mock-oauth-server (client-credentials grant)
//   2. POST it to plnd_api's /auth/token, which validates via JWKS, finds-or-
//      creates the user, and mints a backend HS256 JWT bound to a session row.
// The returned token is what the frontend stores as `auth_token`; sending it as
// Bearer satisfies auth_middleware (HS256 + jti/session check), so unmocked
// endpoints reach their real handler instead of cascading to /login.
//
// Pass an explicit `sub` when a test needs to know its own identity (e.g. to
// assert on backend-returned email). Otherwise the default generates a fresh
// per-call sub, giving each test its own user.
export async function mintTestToken(sub: string = generateTestSub()): Promise<string> {
  const cached = tokenCache.get(sub);
  if (cached) return cached;

  const oauthRes = await fetch(MOCK_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: sub,
      client_secret: MOCK_OAUTH_CLIENT_SECRET,
    }),
  });
  if (!oauthRes.ok) {
    const body = await oauthRes.text().catch(() => '<no body>');
    throw new Error(
      `mintTestToken: mock-oauth-server returned ${oauthRes.status} from ${MOCK_OAUTH_TOKEN_URL}. ` +
        `Is the docker stack up? Try \`docker compose up -d mock-oauth-server\`. Body: ${body.slice(0, 200)}`,
    );
  }
  const oauthJson = (await oauthRes.json()) as { access_token?: string };
  if (!oauthJson.access_token) {
    throw new Error(
      `mintTestToken: mock-oauth-server response missing access_token. Got: ${JSON.stringify(oauthJson).slice(0, 200)}`,
    );
  }

  const exchangeRes = await fetch(BACKEND_TOKEN_EXCHANGE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id_token: oauthJson.access_token, provider: 'mock' }),
  });
  if (!exchangeRes.ok) {
    const body = await exchangeRes.text().catch(() => '<no body>');
    throw new Error(
      `mintTestToken: plnd_api returned ${exchangeRes.status} from ${BACKEND_TOKEN_EXCHANGE_URL}. ` +
        `Is plnd_api running on :3000? Try \`just api\`, \`just dev\`, or \`just verify\`. Body: ${body.slice(0, 200)}`,
    );
  }
  const exchangeJson = (await exchangeRes.json()) as { access_token?: string };
  if (!exchangeJson.access_token) {
    throw new Error(
      `mintTestToken: plnd_api /auth/token response missing access_token. Got: ${JSON.stringify(exchangeJson).slice(0, 200)}`,
    );
  }
  tokenCache.set(sub, exchangeJson.access_token);
  return exchangeJson.access_token;
}

// Injects a real minted JWT into localStorage before page load. Use this for
// tests that need to bypass login but set up their own route mocks (rather
// than seedAuth's defaults). Pass an explicit `sub` when the test needs to
// reference the same identity from multiple call sites; otherwise the default
// generates a fresh per-test user.
export async function injectAuthToken(page: Page, sub: string = generateTestSub()): Promise<void> {
  const token = await mintTestToken(sub);
  await page.addInitScript((t: string) => {
    localStorage.setItem('auth_token', t);
  }, token);
}

// Calls the dev-only POST /test/seed endpoint to reconcile the calling user's
// DB state to a target shape. The endpoint is `#[cfg(debug_assertions)]`-gated
// in plnd_api, so it's physically absent from release builds. See plnd_api/
// src/routes/test_seed.rs for the supported body shape.
export interface TestSeedBody {
  preset?: 'onboarded' | 'new';
  user?: { onboarding_completed?: boolean; display_name?: string };
  default_day_type?: boolean;
}

export async function seedTestState(sub: string, body: TestSeedBody): Promise<void> {
  const token = await mintTestToken(sub);
  const res = await fetch(BACKEND_TEST_SEED_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '<no body>');
    throw new Error(
      `seedTestState: plnd_api returned ${res.status} from ${BACKEND_TEST_SEED_URL}. ` +
        `Is plnd_api running in a dev/debug profile? The /test/seed route is gated by ` +
        `cfg(debug_assertions) and is absent from release builds. Body: ${text.slice(0, 200)}`,
    );
  }
}

// Seeds an onboarded user session against the real backend. Each call generates
// a fresh per-test sub so parallel tests cannot collide on writes — `user_id`
// is the isolation boundary (see docs/architecture.md §9). The real backend
// serves /users/me, /preferences/me, /schedule/plan/status, /schedule/period,
// /my/meal-suggestions, and /briefing/* directly for this user. Returns the
// generated sub so callers can chain additional data seeding (e.g.
// seedScheduleEntries from helpers/seed-data.ts).
export async function seedAuth(page: Page): Promise<{ sub: string }> {
  const sub = generateTestSub();
  await injectAuthToken(page, sub);
  await seedTestState(sub, { preset: 'onboarded' });
  return { sub };
}
