// Configuration interfaces for PLND client
// These interfaces mirror the Rust API configuration for consistency

export interface DatabaseConfig {
  url: string;
}

export interface ApiConfig {
  baseUrl: string;
  timeout: number;
}

export interface LoggingConfig {
  level: 'debug' | 'info' | 'warn' | 'error';
  prettyPrint: boolean;
}

export interface OidcConfig {
  /** Browser-facing OIDC issuer URL — must match the `iss` claim in ID tokens. */
  issuerUrl: string;
  /** OIDC client_id registered with the IdP. */
  clientId: string;
  /** Redirect URI registered with the IdP (Angular callback route). */
  redirectUri: string;
  /** Requested OIDC scopes. */
  scope: string;
}

export interface EnvironmentConfig {
  production: boolean;
  api: ApiConfig;
  database: DatabaseConfig;
  logging: LoggingConfig;
  oidc: OidcConfig;
}
