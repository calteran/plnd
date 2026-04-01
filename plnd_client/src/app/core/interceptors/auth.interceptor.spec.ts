import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors, HttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { authInterceptor } from './auth.interceptor';
import { AuthService } from '../services/auth.service';
import { ConfigService } from '../services/config.service';

describe('authInterceptor', () => {
  let httpMock: HttpTestingController;
  let http: HttpClient;
  let mockAuthService: jasmine.SpyObj<AuthService>;
  let configService: ConfigService;

  beforeEach(() => {
    mockAuthService = jasmine.createSpyObj<AuthService>('AuthService', ['getToken']);
    mockAuthService.getToken.and.returnValue(null);

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: mockAuthService }
      ]
    });
    httpMock = TestBed.inject(HttpTestingController);
    http = TestBed.inject(HttpClient);
    configService = TestBed.inject(ConfigService);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('passes request through without Authorization header when no token', () => {
    mockAuthService.getToken.and.returnValue(null);
    const backendUrl = `${configService.getConfig().api.baseUrl}/test`;
    http.get(backendUrl).subscribe();
    const req = httpMock.expectOne(backendUrl);
    expect(req.request.headers.has('Authorization')).toBeFalse();
    req.flush({});
  });

  it('attaches Bearer token for requests to the backend base URL', () => {
    mockAuthService.getToken.and.returnValue('my-jwt-token');
    const backendUrl = `${configService.getConfig().api.baseUrl}/test`;
    http.get(backendUrl).subscribe();
    const req = httpMock.expectOne(backendUrl);
    expect(req.request.headers.get('Authorization')).toBe('Bearer my-jwt-token');
    req.flush({});
  });

  it('clones the request and does not mutate the original (header set exactly once)', () => {
    mockAuthService.getToken.and.returnValue('my-jwt-token');
    const backendUrl = `${configService.getConfig().api.baseUrl}/test`;
    http.get(backendUrl).subscribe();
    const req = httpMock.expectOne(backendUrl);
    expect(req.request.headers.getAll('Authorization')?.length).toBe(1);
    req.flush({});
  });

  it('does NOT attach token for requests to the IdP', () => {
    mockAuthService.getToken.and.returnValue('my-jwt-token');
    const idpUrl = `${configService.getConfig().oidc.issuerUrl}/.well-known/openid-configuration`;
    http.get(idpUrl).subscribe();
    const req = httpMock.expectOne(idpUrl);
    expect(req.request.headers.has('Authorization')).toBeFalse();
    req.flush({});
  });

  it('does NOT attach token for requests to third-party URLs', () => {
    mockAuthService.getToken.and.returnValue('my-jwt-token');
    const thirdPartyUrl = 'https://api.example.com/data';
    http.get(thirdPartyUrl).subscribe();
    const req = httpMock.expectOne(thirdPartyUrl);
    expect(req.request.headers.has('Authorization')).toBeFalse();
    req.flush({});
  });

  it('does NOT attach token to a URL that is a prefix-collision of the base URL', () => {
    mockAuthService.getToken.and.returnValue('my-jwt-token');
    // e.g. baseUrl is http://localhost:3000 — this must NOT match http://localhost:30001
    const baseUrl = configService.getConfig().api.baseUrl;
    const collisionUrl = `${baseUrl}1/evil`;
    http.get(collisionUrl).subscribe();
    const req = httpMock.expectOne(collisionUrl);
    expect(req.request.headers.has('Authorization')).toBeFalse();
    req.flush({});
  });
});
