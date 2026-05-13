import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  // `PLAYWRIGHT_STRICT` gates pre-commit/CI policy (currently: forbid `.only`).
  // Set by `scripts/verify.sh` and implied by CI runners (which also set `CI`).
  forbidOnly: !!process.env['PLAYWRIGHT_STRICT'] || !!process.env['CI'],
  // `retries` and `reporter` are CI-runner concerns (flake tolerance + GHA
  // annotation format); leave them gated on `CI`.
  retries: process.env['CI'] ? 1 : 0,
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
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
