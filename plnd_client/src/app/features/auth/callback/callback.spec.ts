import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { AuthCallbackComponent } from './callback';
import { AuthService } from '../../../core/services/auth.service';

describe('AuthCallbackComponent', () => {
  function setup(token: string | null) {
    const authServiceMock = {
      handleCallback: jasmine.createSpy('handleCallback'),
      logout: jasmine.createSpy('logout')
    };

    TestBed.configureTestingModule({
      imports: [AuthCallbackComponent, RouterTestingModule],
      providers: [
        { provide: AuthService, useValue: authServiceMock },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              queryParamMap: {
                get: (k: string) => (k === 'token' ? token : null)
              }
            }
          }
        }
      ]
    });

    const fixture = TestBed.createComponent(AuthCallbackComponent);
    fixture.detectChanges();
    return { fixture, authServiceMock };
  }

  it('renders "Signing in…" message', () => {
    const { fixture } = setup('some-token');
    expect(fixture.nativeElement.textContent).toContain('Signing in');
  });

  it('calls handleCallback with the token when token is present', () => {
    const { authServiceMock } = setup('jwt-abc');
    expect(authServiceMock.handleCallback).toHaveBeenCalledWith('jwt-abc');
    expect(authServiceMock.logout).not.toHaveBeenCalled();
  });

  it('calls logout when no token in query params', () => {
    const { authServiceMock } = setup(null);
    expect(authServiceMock.logout).toHaveBeenCalled();
    expect(authServiceMock.handleCallback).not.toHaveBeenCalled();
  });
});
