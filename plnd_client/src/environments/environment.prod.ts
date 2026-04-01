// Angular environment configuration for production
export const environment = {
  production: true,

  // API Configuration
  api: {
    baseUrl: 'https://api.plnd.example.com',
    timeout: 10000
  },

  // Database Configuration (for reference, not used directly in client)
  database: {
    url: '' // Not used in production client
  },

  // Logging Configuration
  logging: {
    level: 'info' as const,
    prettyPrint: false
  },

  // OIDC Configuration — fill in real IdP values before production deployment
  oidc: {
    issuerUrl: '',
    clientId: '',
    redirectUri: 'https://app.plnd.example.com/auth/callback',
    scope: 'openid email profile',
    // Real IdPs are fully spec-compliant; enforce strict discovery document validation.
    strictDiscoveryDocumentValidation: true,
  }
};
