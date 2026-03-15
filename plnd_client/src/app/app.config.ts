import { ApplicationConfig, provideBrowserGlobalErrorListeners, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideOAuthClient } from 'angular-oauth2-oidc';
import { ConfigService } from './core/services/config.service';
import { authInterceptor } from './core/interceptors/auth.interceptor';

import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideHttpClient(withInterceptors([authInterceptor])),
    // Register the OIDC client with sendAccessToken disabled so the library's
    // own interceptor does not attach IdP tokens to backend requests.
    // Our authInterceptor handles backend JWT attachment.
    provideOAuthClient({
      resourceServer: {
        allowedUrls: [],
        sendAccessToken: false
      }
    }),
    ConfigService
  ]
};
