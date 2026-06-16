import { test as base, expect } from '@playwright/test';
import { API_BASE } from './helpers/auth';

// Inject the per-run API base into every page before the Angular app boots, so
// ConfigService (which reads globalThis.__PLND_API_BASE__) targets verify's
// ephemeral API instead of the build-time default (:3000). API_BASE itself reads
// process.env.API_BASE (set by scripts/verify.sh), defaulting to :3000.
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript((apiBase: string) => {
      (globalThis as Record<string, unknown>)['__PLND_API_BASE__'] = apiBase;
    }, API_BASE);
    await use(page);
  },
});

export { expect };
