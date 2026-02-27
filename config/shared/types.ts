// Shared configuration types for PLND
// These types are designed to be compatible with both TypeScript and Rust
// They mirror the TOML configuration structure used by the Rust API

export interface SharedConfig {
  /**
   * API Configuration
   */
  api: {
    /**
     * Server base URL (e.g., "0.0.0.0:3000" or "https://api.example.com")
     */
    base_url: string;
    
    /**
     * Request timeout in milliseconds
     * @default 30000
     */
    timeout?: number;
  };
  
  /**
   * Database Configuration
   */
  database: {
    /**
     * PostgreSQL connection URL
     */
    url: string;
    
    /**
     * Maximum connections in the pool
     * @default 10
     */
    max_connections?: number;
  };
  
  /**
   * Logging Configuration
   */
  logging?: {
    /**
     * Log level
     * @default "info"
     */
    level?: 'debug' | 'info' | 'warn' | 'error';
    
    /**
     * Pretty print logs
     * @default true
     */
    pretty_print?: boolean;
  };
}

/**
 * TypeScript version of the shared configuration
 * This can be used for runtime configuration validation
 */
export type TsConfig = {
  api: {
    baseUrl: string;  // Note: camelCase for TypeScript convention
    timeout: number;
  };
  database: {
    url: string;
    maxConnections: number;
  };
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
    prettyPrint: boolean;
  };
};

/**
 * Convert from TypeScript convention (camelCase) to TOML/Rust convention (snake_case)
 */
export function tsToSharedConfig(tsConfig: TsConfig): SharedConfig {
  return {
    api: {
      base_url: tsConfig.api.baseUrl,
      timeout: tsConfig.api.timeout
    },
    database: {
      url: tsConfig.database.url,
      max_connections: tsConfig.database.maxConnections
    },
    logging: {
      level: tsConfig.logging.level,
      pretty_print: tsConfig.logging.prettyPrint
    }
  };
}

/**
 * Convert from TOML/Rust convention (snake_case) to TypeScript convention (camelCase)
 */
export function sharedToTsConfig(sharedConfig: SharedConfig): TsConfig {
  return {
    api: {
      baseUrl: sharedConfig.api.base_url,
      timeout: sharedConfig.api.timeout || 30000
    },
    database: {
      url: sharedConfig.database.url,
      maxConnections: sharedConfig.database.max_connections || 10
    },
    logging: {
      level: sharedConfig.logging?.level || 'info',
      prettyPrint: sharedConfig.logging?.pretty_print !== undefined 
        ? sharedConfig.logging.pretty_print 
        : true
    }
  };
}