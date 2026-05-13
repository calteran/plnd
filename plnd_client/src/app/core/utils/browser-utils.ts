// Detects whether the user has requested reduced motion via the OS/browser.
// Returns false in non-browser environments (SSR) or when matchMedia throws —
// callers should treat false as "animate normally" rather than "user is OK with motion".
export function detectReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
