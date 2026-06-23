import { defineConfig } from 'vitest/config';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

// zone.js 0.16.2 ships its Vitest zone patch (which establishes the ProxyZone that
// Angular's fakeAsync/tick require) as `fesm2015/vitest-patch.js`, but does NOT list
// it in the package `exports` map — so it can't be imported by its package specifier.
// Alias a clean specifier to the real file so test-setup.ts can load it.
const require = createRequire(import.meta.url);
const zonePkg = dirname(require.resolve('zone.js/package.json'));
const zoneVitestPatch = join(zonePkg, 'fesm2015', 'vitest-patch.js');

export default defineConfig({
  resolve: {
    alias: {
      'zone.js/vitest-patch': zoneVitestPatch,
    },
  },
  test: {
    // Jasmine removed spies after every spec; Vitest does not reset by default, so
    // spy call history would leak across tests. `restoreMocks` restores spied
    // originals and clears mock state before each test, matching the old behaviour.
    restoreMocks: true,
  },
});
