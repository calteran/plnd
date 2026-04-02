import { ErrorHandler, Injectable } from '@angular/core';

interface ClientErrorPayload {
  message: string;
  stack?: string;
  url?: string;
  timestamp: string;
  user_agent: string;
}

/**
 * Overrides Angular's default ErrorHandler to capture all unhandled exceptions
 * and report them to POST /api/client_error via fetch.
 *
 * Uses fetch (not HttpClient) to avoid circular injection and to ensure the
 * report is sent even during bootstrapping failures.
 *
 * Register in app.config.ts:
 *   { provide: ErrorHandler, useClass: GlobalErrorHandlerService }
 */
@Injectable({ providedIn: 'root' })
export class GlobalErrorHandlerService implements ErrorHandler {
  handleError(error: unknown): void {
    const err = error instanceof Error ? error : new Error(String(error));

    const payload: ClientErrorPayload = {
      message: err.message || String(error),
      stack: err.stack,
      url: typeof window !== 'undefined' ? window.location.pathname : undefined,
      timestamp: new Date().toISOString(),
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
    };

    fetch('/api/client_error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {
      // Swallow all errors — observability must never break the app
    });

    // Re-log to console for local development visibility
    console.error('[GlobalErrorHandler]', error);
  }
}
