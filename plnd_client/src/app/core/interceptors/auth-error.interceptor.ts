import { HttpErrorResponse, HttpHandlerFn, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from '../services/auth.service';
import { SKIP_AUTH_ERROR } from './auth-context-tokens';

/**
 * Functional HTTP interceptor that catches 401 Unauthorized responses from the
 * backend API and triggers a clean logout, redirecting to the login page with a
 * "session expired" notice.
 *
 * Requests to the OIDC issuer (IdP discovery, token exchange) are excluded
 * because the IdP may legitimately return 401 for expired IdP tokens and those
 * should not clear the backend session.
 *
 * Callers may also set SKIP_AUTH_ERROR on a request's HttpContext to suppress
 * logout for endpoints where a 401 is expected and non-fatal.
 */
export const authErrorInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn
) => {
  // Capture the service reference synchronously while we are in the Angular
  // injection context. Calling inject() inside catchError would fail because
  // that callback runs asynchronously, outside the injection context.
  const authService = inject(AuthService);

  return next(req).pipe(
    catchError((error: unknown) => {
      if (
        error instanceof HttpErrorResponse &&
        error.status === 401 &&
        !req.context.get(SKIP_AUTH_ERROR) &&
        (!environment.oidc.issuerUrl || !req.url.includes(environment.oidc.issuerUrl)) &&
        authService.isAuthenticated()
      ) {
        authService.logout('session_expired');
      }
      return throwError(() => error);
    })
  );
};
