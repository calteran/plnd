import { HttpContextToken } from '@angular/common/http';

/**
 * Set to true on an HTTP request to skip automatic logout on 401 responses.
 * Used by requests that legitimately may receive 401 (e.g., meal suggestions).
 */
export const SKIP_AUTH_ERROR = new HttpContextToken<boolean>(() => false);
