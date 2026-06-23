// Global test setup for the `@angular/build:unit-test` (Vitest + jsdom) runner.
// Registered via `setupFiles` in angular.json; runs after the builder's own
// TestBed/zone initialization, once per test worker.

// ── Zone.js fakeAsync support ────────────────────────────────────────────────
// `zone.js/testing` (loaded by the builder) only patches jasmine/jest/mocha to
// establish the ProxyZone that Angular's `fakeAsync`/`tick` require. Vitest is
// none of those, so we load zone.js's dedicated Vitest patch, which wraps
// Vitest's describe/it/beforeEach in a ProxyZone. This is the Vitest counterpart
// of the zone-testing wiring Karma performed automatically.
import 'zone.js/vitest-patch';

// ── jsdom browser-API stubs ──────────────────────────────────────────────────
// jsdom does not implement these browser APIs that real browsers (and the old
// Karma/Chrome runner) provide. Specs spy on them, which requires the base API
// to exist first. Providing minimal, overridable implementations here keeps the
// specs themselves browser-idiomatic.
if (typeof window.matchMedia !== 'function') {
  const noop = (): void => {
    /* jsdom stub — overridden per-spec where behaviour is asserted */
  };
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: noop,
      removeEventListener: noop,
      addListener: noop,
      removeListener: noop,
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}

if (!('geolocation' in navigator)) {
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: (): void => {
        /* jsdom stub — overridden per-spec where behaviour is asserted */
      },
      watchPosition: () => 0,
      clearWatch: (): void => {
        /* jsdom stub */
      },
    },
  });
}
