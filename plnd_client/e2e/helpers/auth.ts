import { Page } from '@playwright/test';

export const API_BASE = 'http://localhost:3000';

const MOCK_OAUTH_TOKEN_URL = 'http://localhost:8080/plnd-dev/token';
const BACKEND_TOKEN_EXCHANGE_URL = `${API_BASE}/auth/token`;
const BACKEND_TEST_SEED_URL = `${API_BASE}/test/seed`;
const MOCK_OAUTH_CLIENT_SECRET = 'mock-secret';
const DEFAULT_TEST_SUB = 'e2e-test-uuid';
// Helper-specific subs so seedAuth (onboarded) and seedOnboarding (new) operate
// on different DB rows. Avoids one helper's seed clobbering another's when
// tests run in parallel workers against a shared DB. Replaced by per-test DB
// isolation in chunk 4 (#775).
export const SEED_AUTH_SUB = 'e2e-onboarded-user';
export const SEED_ONBOARDING_SUB = 'e2e-onboarding-user';

// Cache is per-worker (per Node module instance) and keyed by `sub`. Safe under
// chunk-1 invariants because no test currently invalidates its own session
// (every /auth/logout call is page.route-mocked). When chunks 2–5 remove logout
// mocks, this cache strategy needs to be revisited — the cached JTI may be
// revoked mid-run.
const tokenCache = new Map<string, string>();

// Mints a real backend HS256 JWT by performing the full production auth flow:
//   1. Mint an OIDC id_token from mock-oauth-server (client-credentials grant)
//   2. POST it to plnd_api's /auth/token, which validates via JWKS, finds-or-
//      creates the user, and mints a backend HS256 JWT bound to a session row.
// The returned token is what the frontend stores as `auth_token`; sending it as
// Bearer satisfies auth_middleware (HS256 + jti/session check), so unmocked
// endpoints reach their real handler instead of cascading to /login.
export async function mintTestToken(sub: string = DEFAULT_TEST_SUB): Promise<string> {
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

// These mirror what the real backend produces for the seeded subs, used as
// reference values in test assertions (e.g. profile.e2e.ts checks email +
// display_name). Backend-generated fields (user_id, timestamps, last_login)
// are placeholders here; tests should not assert on them directly. Replaced
// entirely by per-test DB isolation in chunk 4 (#775).
export const MOCK_USER_NEW = {
  user_id: 'e2e-test-uuid',
  email: `${SEED_ONBOARDING_SUB}@mock.plnd`,
  display_name: null,
  avatar_url: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  is_active: true,
  last_login: null,
  onboarding_completed: false,
};

export const MOCK_USER_ONBOARDED = {
  user_id: 'e2e-test-uuid',
  email: `${SEED_AUTH_SUB}@mock.plnd`,
  display_name: 'Test User',
  avatar_url: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  is_active: true,
  last_login: null,
  onboarding_completed: true,
};

export const MOCK_PREFS = {
  user_id: 'e2e-test-uuid',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  week_start_day: 1,
  planning_trigger_offset: 0,
  default_plan_length_days: 7,
  email_notifications_enabled: false,
  sms_notifications_enabled: false,
  push_notifications_enabled: false,
  phone_number: null,
};

export const MOCK_BRIEFING_WEATHER = {
  temperature_c: 18,
  condition: 'Clear',
  high_c: 22,
  low_c: 14,
  precipitation_mm: 3.5,
};

export const MOCK_BRIEFING_NEWS = {
  headlines: ['Test headline one', 'Test headline two', 'Test headline three'],
};

// Today date as fixed by page.clock.setFixedTime in e2e tests.
const E2E_TODAY = '2026-03-28';

export const MOCK_BRIEFING_YESTERDAY = {
  tasks_done: 3,
  tasks_total: 5,
  meals_logged: 2,
  meals_planned: 3,
};

// Injects a real minted JWT into localStorage before page load. Use this for
// tests that need to bypass login but set up their own route mocks (rather
// than seedAuth's defaults). `sub` flows through to mintTestToken for tests
// that need a distinct identity (chunks 2+ will use this for per-test users).
export async function injectAuthToken(page: Page, sub: string = DEFAULT_TEST_SUB): Promise<void> {
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

export async function seedAuth(page: Page) {
  await injectAuthToken(page, SEED_AUTH_SUB);
  await seedTestState(SEED_AUTH_SUB, { preset: 'onboarded' });
  await page.route(`${API_BASE}/schedule/plan/status**`, route =>
    route.fulfill({ status: 200, json: { planned: false } })
  );
  await page.route(`${API_BASE}/my/meal-suggestions**`, route =>
    route.fulfill({ status: 200, json: [] })
  );
  await page.route(`${API_BASE}/schedule/period**`, route => {
    const start = new URL(route.request().url()).searchParams.get('start') ?? E2E_TODAY;
    const isToday = start === E2E_TODAY;
    return route.fulfill({
      status: 200,
      json: {
        entries: [
          {
            entry_id: 'e2e-meal-uuid',
            task_type: null,
            date: start,
            scheduled_start: `${start}T08:00:00Z`,
            status: isToday ? 'completed' : 'planned',
            after_anchor: 'breakfast',
          },
          {
            entry_id: 'e2e-task-uuid',
            task_type: 'task',
            title: 'Morning stretch',
            date: start,
            scheduled_start: `${start}T07:00:00Z`,
            status: isToday ? 'completed' : 'pending',
          },
        ],
        carryover: [],
      },
    });
  });
  await page.route(`${API_BASE}/briefing/weather`, route =>
    route.fulfill({ status: 200, json: MOCK_BRIEFING_WEATHER })
  );
  await page.route(`${API_BASE}/briefing/news`, route =>
    route.fulfill({ status: 200, json: MOCK_BRIEFING_NEWS })
  );
  await page.route(`${API_BASE}/briefing/yesterday`, route =>
    route.fulfill({ status: 200, json: MOCK_BRIEFING_YESTERDAY })
  );
}
