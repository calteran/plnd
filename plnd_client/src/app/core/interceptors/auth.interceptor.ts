import { HttpHandlerFn, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthService } from '../services/auth.service';
import { ConfigService } from '../services/config.service';

/**
 * Functional HTTP interceptor that attaches the backend Bearer JWT to outgoing
 * requests — but only for requests destined for our own API.
 *
 * Using an allowlist (startsWith our backend base URL) rather than an exclusion
 * list prevents the JWT from being accidentally sent to the IdP or any
 * hypothetical third-party APIs added in the future.
 *
 * The base URL is normalized with a trailing slash before matching to prevent
 * prefix-collision attacks (e.g. a URL that starts with the base URL string but
 * routes to a different host).
 */
export const authInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn
) => {
  const authService = inject(AuthService);
  const config = inject(ConfigService);

  const token = authService.getToken();
  const baseUrl = config.getConfig().api.baseUrl.replace(/\/?$/, '/');

  if (token && req.url.startsWith(baseUrl)) {
    const cloned = req.clone({
      setHeaders: { Authorization: `Bearer ${token}` }
    });
    return next(cloned);
  }

  return next(req);
};
