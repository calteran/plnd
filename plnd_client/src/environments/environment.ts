// Angular environment configuration for development
// This file can be replaced during build by using the `fileReplacements` array.
// `ng build` replaces `environment.ts` with `environment.prod.ts`.
// The list of file replacements can be found in `angular.json`.

export const environment = {
  production: false,

  // API Configuration
  api: {
    baseUrl: 'http://localhost:3000',
    timeout: 30000
  },

  // Database Configuration (for reference, not used directly in client)
  database: {
    url: 'postgres://plnd:plnd_dev@localhost/plnd_dev'
  },

  // Logging Configuration
  logging: {
    level: 'debug' as const,
    prettyPrint: true
  },

  // OIDC Configuration
  oidc: {
    issuerUrl: 'http://localhost:8080/plnd-dev',
    clientId: 'mock-client',
    redirectUri: 'http://localhost:4200/auth/callback',
    scope: 'openid email profile'
  }
};
