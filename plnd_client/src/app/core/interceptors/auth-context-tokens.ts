import { HttpContextToken } from '@angular/common/http';

/**
 * Set this context token to `true` on requests where a 401 should NOT trigger
 * a full session logout (e.g. background/prefetch requests, per-resource auth
 * failures that are expected and handled locally).
 *
 * Usage:
 *   this.http.get('/api/something', {
 *     context: new HttpContext().set(SKIP_AUTH_ERROR, true)
 *   })
 */
export const SKIP_AUTH_ERROR = new HttpContextToken<boolean>(() => false);
