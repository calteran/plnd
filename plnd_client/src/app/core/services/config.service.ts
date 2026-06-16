import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { environment } from '../../../environments/environment';
import { EnvironmentConfig } from '../models/config';

@Injectable({
  providedIn: 'root'
})
export class ConfigService {
  private configSubject: BehaviorSubject<EnvironmentConfig>;

  constructor() {
    this.configSubject = new BehaviorSubject<EnvironmentConfig>(ConfigService.resolveInitialConfig());
    this.validateConfigObject(this.getConfig());
  }

  // Allow an e2e harness (or runtime host) to override the API base URL before
  // the app boots via `globalThis.__PLND_API_BASE__`. Unset in production, so the
  // built-in environment config is used unchanged.
  private static resolveInitialConfig(): EnvironmentConfig {
    const override = (globalThis as { __PLND_API_BASE__?: string }).__PLND_API_BASE__;
    if (override) {
      return { ...environment, api: { ...environment.api, baseUrl: override } };
    }
    return environment;
  }

  getConfig(): EnvironmentConfig {
    return this.configSubject.value;
  }

  // Method to update configuration at runtime (for advanced use cases)
  updateConfig(newConfig: Partial<EnvironmentConfig>): void {
    const currentConfig = this.getConfig();
    const updatedConfig = { ...currentConfig, ...newConfig };
    this.validateConfigObject(updatedConfig);
    this.configSubject.next(updatedConfig);
  }

  private validateConfigObject(config: EnvironmentConfig): void {
    if (!config.api.baseUrl) {
      throw new Error('API base URL is not configured');
    }

    if (typeof config.api.timeout !== 'number' || config.api.timeout <= 0) {
      throw new Error('API timeout must be a positive number');
    }

    const validLogLevels: ('debug' | 'info' | 'warn' | 'error')[] = ['debug', 'info', 'warn', 'error'];
    if (!validLogLevels.includes(config.logging.level)) {
      throw new Error(`Invalid logLevel: ${config.logging.level}`);
    }
  }
}
