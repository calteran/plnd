import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { RouterTestingModule } from '@angular/router/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { OAuthModule } from 'angular-oauth2-oidc';
import { MainLayoutComponent } from './main-layout';

describe('MainLayoutComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MainLayoutComponent, RouterTestingModule, OAuthModule.forRoot()],
      providers: [provideHttpClient(), provideHttpClientTesting()]
    }).compileComponents();
  });

  it('should create', () => {
    const f = TestBed.createComponent(MainLayoutComponent);
    f.detectChanges();
    expect(f.componentInstance).toBeTruthy();
  });

  it('renders the sidebar with a Today nav item', () => {
    const f = TestBed.createComponent(MainLayoutComponent);
    f.detectChanges();
    const sidebar = f.debugElement.query(By.css('.sidebar'));
    expect(sidebar).toBeTruthy();
    expect(sidebar.nativeElement.textContent).toContain('📅');
  });

  it('renders the bottom tabs', () => {
    const f = TestBed.createComponent(MainLayoutComponent);
    f.detectChanges();
    expect(f.debugElement.query(By.css('.bottom-tabs'))).toBeTruthy();
  });

  it('renders the router outlet', () => {
    const f = TestBed.createComponent(MainLayoutComponent);
    f.detectChanges();
    expect(f.debugElement.query(By.css('router-outlet'))).toBeTruthy();
  });
});
