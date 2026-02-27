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

export interface EnvironmentConfig {
  production: boolean;
  api: ApiConfig;
  database: DatabaseConfig;
  logging: LoggingConfig;
}