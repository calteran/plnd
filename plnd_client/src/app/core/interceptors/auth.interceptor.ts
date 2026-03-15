import { HttpHandlerFn, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { environment } from '../../../environments/environment';

/**
 * Functional HTTP interceptor that attaches the backend Bearer JWT to outgoing
 * requests — but skips requests destined for the IdP (OIDC library calls).
 *
 * The OIDC library communicates with the IdP directly (discovery, token exchange,
 * userinfo). Attaching the backend JWT to those requests would cause CORS errors
 * or unexpected authentication failures at the IdP.
 */
export const authInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn
) => {
  const token = localStorage.getItem('auth_token');

  if (token && !req.url.includes(environment.oidc.issuerUrl)) {
    const cloned = req.clone({
      setHeaders: { Authorization: `Bearer ${token}` }
    });
    return next(cloned);
  }

  return next(req);
};
