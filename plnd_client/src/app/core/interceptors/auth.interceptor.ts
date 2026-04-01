import { HttpHandlerFn, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { environment } from '../../../environments/environment';

/**
 * Functional HTTP interceptor that attaches the backend Bearer JWT to outgoing
 * requests — but only for requests destined for our own API.
 *
 * Using an allowlist (startsWith our backend base URL) rather than an exclusion
 * list prevents the JWT from being accidentally sent to the IdP or any
 * hypothetical third-party APIs added in the future.
 */
export const authInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn
) => {
  const token = localStorage.getItem('auth_token');

  if (token && req.url.startsWith(environment.api.baseUrl)) {
    const cloned = req.clone({
      setHeaders: { Authorization: `Bearer ${token}` }
    });
    return next(cloned);
  }

  return next(req);
};
