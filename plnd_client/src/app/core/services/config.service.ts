import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { environment } from '../../../environments/environment';
import { EnvironmentConfig } from '../models/config';

@Injectable({
  providedIn: 'root'
})
export class ConfigService {
  private configSubject = new BehaviorSubject<EnvironmentConfig>(environment);

  constructor() {
    this.validateConfigObject(this.getConfig());
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
