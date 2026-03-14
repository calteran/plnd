import { TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { DashboardComponent } from './dashboard';
import { AuthService } from '../../core/services/auth.service';

describe('DashboardComponent', () => {
  let authServiceMock: { logout: jasmine.Spy };

  beforeEach(async () => {
    authServiceMock = { logout: jasmine.createSpy('logout') };
    await TestBed.configureTestingModule({
      imports: [DashboardComponent, RouterTestingModule],
      providers: [{ provide: AuthService, useValue: authServiceMock }]
    }).compileComponents();
  });

  it('should create', () => {
    const fixture = TestBed.createComponent(DashboardComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('renders dashboard heading', () => {
    const fixture = TestBed.createComponent(DashboardComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('h2')?.textContent).toContain('Dashboard');
  });

  it('clicking sign-out button calls auth.logout()', () => {
    const fixture = TestBed.createComponent(DashboardComponent);
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    btn.click();
    expect(authServiceMock.logout).toHaveBeenCalled();
  });
});
