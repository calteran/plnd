// zone.js 0.16.2 ships the Vitest zone patch as a standalone module that is not
// listed in the package `exports` map, so TypeScript needs an ambient declaration
// for the side-effect import in test-setup.ts. The specifier is aliased to the real
// file in vitest-base.config.ts.
declare module 'zone.js/vitest-patch';
