import { TestBed, fakeAsync, flushMicrotasks } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { OAuthService } from 'angular-oauth2-oidc';
import { AuthCallbackComponent } from './callback';
import { AuthService } from '../../../core/services/auth.service';

describe('AuthCallbackComponent', () => {
  function setup(idToken: string | null, exchangeOutcome: 'success' | 'error' = 'success') {
    const oauthServiceMock = jasmine.createSpyObj('OAuthService', [
      'loadDiscoveryDocumentAndTryLogin',
      'getIdToken',
    ]);
    oauthServiceMock.loadDiscoveryDocumentAndTryLogin.and.returnValue(Promise.resolve(true));
    // Empty string is falsy — treated the same as null in the component's `!idToken` check.
    oauthServiceMock.getIdToken.and.returnValue(idToken ?? '');

    const authServiceMock = jasmine.createSpyObj('AuthService', [
      'exchangeToken',
      'handleCallback',
      'logout',
    ]);
    authServiceMock.exchangeToken.and.returnValue(
      exchangeOutcome === 'success'
        ? of('backend-jwt')
        : throwError(() => new Error('exchange failed'))
    );

    TestBed.configureTestingModule({
      imports: [AuthCallbackComponent],
      providers: [
        { provide: OAuthService, useValue: oauthServiceMock },
        { provide: AuthService, useValue: authServiceMock },
        provideRouter([])
      ]
    });

    const fixture = TestBed.createComponent(AuthCallbackComponent);
    fixture.detectChanges(); // triggers ngOnInit (starts async chain)

    return { fixture, authServiceMock, oauthServiceMock };
  }

  it('renders "Signing in…" message', fakeAsync(() => {
    const { fixture } = setup('some-token');
    expect(fixture.nativeElement.textContent).toContain('Signing in');
    flushMicrotasks();
  }));

  it('calls handleCallback with backend JWT when id_token is present', fakeAsync(() => {
    const { authServiceMock } = setup('id-token-value');
    flushMicrotasks(); // resolve loadDiscoveryDocumentAndTryLogin promise
    expect(authServiceMock.exchangeToken).toHaveBeenCalled();
    expect(authServiceMock.handleCallback).toHaveBeenCalledWith('backend-jwt');
    expect(authServiceMock.logout).not.toHaveBeenCalled();
  }));

  it('calls logout() when id_token is absent', fakeAsync(() => {
    const { authServiceMock } = setup(null);
    flushMicrotasks();
    expect(authServiceMock.logout).toHaveBeenCalled();
    expect(authServiceMock.handleCallback).not.toHaveBeenCalled();
  }));

  it('calls logout() when token exchange fails', fakeAsync(() => {
    const { authServiceMock } = setup('id-token-value', 'error');
    flushMicrotasks();
    expect(authServiceMock.logout).toHaveBeenCalled();
    expect(authServiceMock.handleCallback).not.toHaveBeenCalled();
  }));
});
