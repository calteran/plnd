import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { LoginComponent } from './login';
import { AuthService } from '../../../core/services/auth.service';

function createFixture(queryParams: Record<string, string> = {}): ComponentFixture<LoginComponent> {
  const spy = jasmine.createSpyObj('AuthService', ['login']);
  const paramMap = { get: (key: string) => queryParams[key] ?? null };

  TestBed.configureTestingModule({
    imports: [LoginComponent, RouterTestingModule],
    providers: [
      { provide: AuthService, useValue: spy },
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: paramMap } } }
    ]
  });

  const fixture = TestBed.createComponent(LoginComponent);
  fixture.detectChanges();
  return fixture;
}

describe('LoginComponent', () => {
  let fixture: ComponentFixture<LoginComponent>;
  let authService: jasmine.SpyObj<AuthService>;

  beforeEach(async () => {
    fixture = createFixture();
    authService = TestBed.inject(AuthService) as jasmine.SpyObj<AuthService>;
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should call auth.login() when sign-in button clicked', () => {
    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    button.click();
    expect(authService.login).toHaveBeenCalled();
  });

  it('does not show a session-expired notice when no reason query param is present', () => {
    const notice = fixture.nativeElement.querySelector('.session-notice') as HTMLElement | null;
    expect(notice).toBeNull();
  });

  it('shows a session-expired notice when reason=session_expired is in the URL', async () => {
    TestBed.resetTestingModule();
    const sessionFixture = createFixture({ reason: 'session_expired' });
    const notice = sessionFixture.nativeElement.querySelector('.session-notice') as HTMLElement | null;
    expect(notice).not.toBeNull();
    expect(notice?.textContent).toContain('session');
  });
});
