import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  // `PLAYWRIGHT_STRICT` gates pre-commit/CI policy (currently: forbid `.only`).
  // Set by `scripts/verify.sh` and implied by CI runners (which also set `CI`).
  forbidOnly: !!process.env['PLAYWRIGHT_STRICT'] || !!process.env['CI'],
  // `retries` and `reporter` are CI-runner concerns (flake tolerance + GHA
  // annotation format); leave them gated on `CI`. The auth-infra tests
  // (settings/profile/schedule) share one real backend and, under `fullyParallel`,
  // race the mock-OAuth handshake + API startup during the first seconds — a
  // transient `/auth/token` / `/test/seed` 500/401 window that a single retry
  // doesn't always clear. Allow extra retries so this environmental startup
  // flake doesn't fail an otherwise-green run.
  retries: process.env['CI'] ? 2 : 1,
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
