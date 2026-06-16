import { TestBed } from '@angular/core/testing';
import { ConfigService } from './config.service';
import { EnvironmentConfig } from '../models/config';
import { environment } from '../../../environments/environment';

describe('ConfigService', () => {
  let service: ConfigService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ConfigService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should initialize with default config', () => {
    const defaultConfig: EnvironmentConfig = {
      production: false,
      api: {
        baseUrl: 'http://localhost:3000',
        timeout: 30000
      },
      database: {
        url: 'postgres://plnd:plnd_dev@localhost/plnd_dev'
      },
      logging: {
        level: 'debug',
        prettyPrint: true
      },
      oidc: {
        issuerUrl: 'http://localhost:8080/plnd-dev',
        clientId: 'mock-client',
        redirectUri: 'http://localhost:4200/auth/callback',
        scope: 'openid email profile',
        strictDiscoveryDocumentValidation: false,
      }
    };
    
    expect(service.getConfig()).toEqual(defaultConfig);
  });

  it('should update config', () => {
    const newConfig: Partial<EnvironmentConfig> = {
      api: {
        baseUrl: 'https://api.example.com',
        timeout: 60000
      }
    };

    service.updateConfig(newConfig);
    const updatedConfig = service.getConfig();
    expect(updatedConfig.api.baseUrl).toEqual('https://api.example.com');
    expect(updatedConfig.api.timeout).toEqual(60000);
  });
});

describe('ConfigService api base override', () => {
  const KEY = '__PLND_API_BASE__';

  afterEach(() => {
    delete (globalThis as Record<string, unknown>)[KEY];
  });

  it('uses globalThis.__PLND_API_BASE__ when set', () => {
    (globalThis as Record<string, unknown>)[KEY] = 'http://localhost:54321';
    const svc = new ConfigService();
    expect(svc.getConfig().api.baseUrl).toBe('http://localhost:54321');
  });

  it('derives the OIDC redirectUri from the app origin when override is set', () => {
    (globalThis as Record<string, unknown>)[KEY] = 'http://localhost:54321';
    const svc = new ConfigService();
    expect(svc.getConfig().oidc.redirectUri).toBe(`${globalThis.location.origin}/auth/callback`);
  });

  it('falls back to environment when override is unset', () => {
    const svc = new ConfigService();
    expect(svc.getConfig().api.baseUrl).toBe(environment.api.baseUrl);
    expect(svc.getConfig().oidc.redirectUri).toBe(environment.oidc.redirectUri);
  });
});