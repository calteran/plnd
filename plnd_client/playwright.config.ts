import { defineConfig, devices } from '@playwright/test';

// `just verify` assigns an ephemeral ng-serve port per run; default :4200 for
// `just dev` / standalone runs.
const NG_PORT = process.env['NG_PORT'] ?? '4200';
const BASE_URL = `http://localhost:${NG_PORT}`;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  // `PLAYWRIGHT_STRICT` gates pre-commit/CI policy (currently: forbid `.only`).
  // Set by `scripts/verify.sh` and implied by CI runners (which also set `CI`).
  forbidOnly: !!process.env['PLAYWRIGHT_STRICT'] || !!process.env['CI'],
  // The auth-infra tests (settings/profile/schedule) share one real backend and,
  // under `fullyParallel`, race the mock-OAuth handshake + API startup during the
  // first seconds — a transient `/auth/token` / `/test/seed` 500/401 window that a
  // single retry doesn't always clear. Retries absorb this environmental flake.
  //
  // Note `just verify` runs e2e via `npm run e2e:ci`, which sets `CI=true` — so
  // `process.env['CI']` is truthy under both GitHub Actions and local `just verify`.
  // Only GitHub Actions sets `GITHUB_ACTIONS`, so the tiers are:
  //   - GitHub Actions (noisier shared runners): 2 retries
  //   - local `just verify`:                     1 retry
  //   - bare `npm run e2e` (fast dev iteration):  0 retries
  retries: process.env['GITHUB_ACTIONS'] ? 2 : process.env['CI'] ? 1 : 0,
  // `reporter` is a CI-runner concern (GHA annotation format); gate on `CI`.
  reporter: process.env['CI'] ? 'github' : 'list',
  // Per-assertion budget. Playwright's default is 5s, but a positive wait
  // (`toBeVisible`/`toHaveText`/`toHaveURL`…) should tolerate as long as the whole
  // test may run — not a stingy 5s (or a hardcoded 2s) slice. Under CPU starvation,
  // when many `just verify` agents contend for cores (#988), the awaited condition
  // is still eventually satisfied; a low ceiling just guillotines it first. Matching
  // the per-test `timeout` default (30s, left unchanged) lets a single positive
  // assertion ride the test's full budget. Spec call sites therefore drop their
  // explicit positive-wait ceilings and inherit this. The carve-outs that must
  // stay bounded keep explicit short ceilings instead: the `not.toBeVisible`
  // absence checks where a held-visible element should fail fast, and the
  // `test.fail()` waits (which must throw fast to register as expected failures
  // rather than racing the per-test timeout).
  expect: { timeout: 30_000 },
  globalSetup: require.resolve('./e2e/global-setup.ts'),
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    headless: true,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: `npx ng serve --configuration development --port ${NG_PORT}`,
    url: BASE_URL,
    // In CI/`just verify` always start a fresh server from THIS worktree — never
    // adopt whatever `ng serve` happens to occupy :4200 (a stale or another
    // worktree's build), which silently runs e2e against the wrong frontend.
    // Locally, reuse a developer's running `ng serve` for fast iteration.
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
