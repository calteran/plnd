import { detectReducedMotion } from './browser-utils';

const ORIGINAL_MATCH_MEDIA = window.matchMedia;

function stubMatchMedia(prefersReduce: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: ((q: string) => ({
      matches: prefersReduce && q.includes('prefers-reduced-motion'),
      media: q,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    })) as typeof window.matchMedia,
  });
}

function stubMatchMediaThatThrows(): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (() => { throw new Error('matchMedia exploded'); }) as unknown as typeof window.matchMedia,
  });
}

function deleteMatchMedia(): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: undefined,
  });
}

afterEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: ORIGINAL_MATCH_MEDIA,
  });
});

describe('detectReducedMotion', () => {
  it('returns true when prefers-reduced-motion: reduce matches', () => {
    stubMatchMedia(true);
    expect(detectReducedMotion()).toBe(true);
  });

  it('returns false when the query does not match', () => {
    stubMatchMedia(false);
    expect(detectReducedMotion()).toBe(false);
  });

  it('returns false when window.matchMedia is unavailable', () => {
    deleteMatchMedia();
    expect(detectReducedMotion()).toBe(false);
  });

  it('returns false when window.matchMedia throws', () => {
    stubMatchMediaThatThrows();
    expect(detectReducedMotion()).toBe(false);
  });
});
