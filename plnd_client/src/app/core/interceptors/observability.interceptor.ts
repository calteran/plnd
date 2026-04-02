import {
  HttpErrorResponse,
  HttpHandlerFn,
  HttpInterceptorFn,
  HttpRequest,
} from '@angular/common/http';
import { catchError, throwError } from 'rxjs';

/**
 * Payload sent to POST /api/client_error.
 * Mirrors ClientErrorPayload in plnd_api/src/routes/system.rs.
 */
interface ClientErrorPayload {
  message: string;
  stack?: string;
  url?: string;
  request_id?: string;
  timestamp: string;
  user_agent: string;
}

/**
 * Fire-and-forget POST to /api/client_error via fetch (not HttpClient) to
 * avoid re-entering the interceptor chain and causing recursion.
 * Uses keepalive: true so the request survives page navigation/unload.
 */
function reportError(payload: ClientErrorPayload, authHeader?: string): void {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authHeader) {
    headers['Authorization'] = authHeader;
  }
  fetch('/api/client_error', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => {
    // Swallow all errors — observability must never break the app
  });
}

/**
 * Attaches a unique X-Request-ID to every outbound HTTP request and reports
 * 4xx/5xx responses to the backend error log via POST /api/client_error.
 *
 * Placed last in the interceptor chain so it sees the final request/response
 * after auth token attachment.
 */
export const observabilityInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn
) => {
  const requestId = crypto.randomUUID();
  const reqWithId = req.clone({
    setHeaders: { 'X-Request-ID': requestId },
  });

  return next(reqWithId).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse) {
        const authHeader = reqWithId.headers.get('Authorization') ?? undefined;
        reportError({
          message: `HTTP ${error.status} — ${req.method} ${req.url}`,
          url: req.url,
          request_id: requestId,
          timestamp: new Date().toISOString(),
          user_agent: navigator.userAgent,
        }, authHeader);
      }
      return throwError(() => error);
    })
  );
};
