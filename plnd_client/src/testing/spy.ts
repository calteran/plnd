import { vi, type Mock } from 'vitest';

/**
 * Vitest test-spy helpers — the migration replacement for the Jasmine spy API
 * that shipped with the (now removed) Karma builder.
 *
 * Vitest exposes `vi`/`expect`/`describe` as globals (the `@angular/build:unit-test`
 * builder sets `globals: true`), so most specs need no imports. Only the spy-object
 * factory and its companion types live here, since Vitest has no direct equivalent
 * of `jasmine.createSpyObj`.
 */

/** Re-exported so specs can write `let s: Mock` with a single import alongside SpyObj. */
export type { Mock };

/**
 * A view of `T` where every method is a Vitest `Mock`. Mirrors `jasmine.SpyObj<T>`:
 * mock the methods, keep the data properties' real types.
 */
export type SpyObj<T> = {
  [K in keyof T]: T[K] extends (...args: never[]) => unknown ? Mock : T[K];
};

/**
 * Vitest replacement for `jasmine.createSpyObj`. Returns an object whose listed
 * `methodNames` are `vi.fn()` mocks, optionally merged with fixed `properties`
 * (the third argument Jasmine accepted for non-method values/getters).
 *
 * The Jasmine name label (first argument) is dropped — Vitest mocks carry no name.
 *
 * Two overloads mirror Jasmine's behaviour:
 *  - Supply an explicit type, or assign to a typed `SpyObj<T>`, to get `SpyObj<T>`.
 *    (`NoInfer` keeps the method-name array from narrowing `T` to just those keys.)
 *  - Otherwise the shape is inferred from the method-name string literals, with an
 *    open index signature so extra properties can be assigned ad hoc.
 */
export function createSpyObj<T>(
  methodNames: (keyof NoInfer<T>)[],
  properties?: Record<PropertyKey, unknown>,
): SpyObj<T>;
// Untyped form mirrors `jasmine.createSpyObj`'s no-generic overloads, which
// returned `any` — letting partial mocks satisfy a fully-typed `SpyObj<T>` and
// allowing ad-hoc property assignment on the result.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createSpyObj(methodNames: string[], properties?: Record<PropertyKey, unknown>): any;
export function createSpyObj(
  methodNames: readonly PropertyKey[],
  properties?: Record<PropertyKey, unknown>,
): Record<PropertyKey, unknown> {
  const obj: Record<PropertyKey, unknown> = {};
  for (const name of methodNames) {
    obj[name] = vi.fn();
  }
  if (properties) {
    Object.assign(obj, properties);
  }
  return obj;
}
