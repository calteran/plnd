import { defineConfig, devices } from '@playwright/test';

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
  globalSetup: require.resolve('./e2e/global-setup.ts'),
  use: {
    baseURL: 'http://localhost:4200',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    headless: true,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npx ng serve --configuration development',
    url: 'http://localhost:4200',
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
