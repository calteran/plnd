import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { OAuthService } from 'angular-oauth2-oidc';
import { MainLayoutComponent } from './main-layout';

describe('MainLayoutComponent', () => {
  let fixture: ComponentFixture<MainLayoutComponent>;
  let component: MainLayoutComponent;

  beforeEach(async () => {
    const oauthMock = jasmine.createSpyObj('OAuthService', ['configure', 'logOut', 'loadDiscoveryDocumentAndLogin', 'getIdToken']);
    await TestBed.configureTestingModule({
      imports: [MainLayoutComponent, RouterTestingModule, HttpClientTestingModule],
      providers: [{ provide: OAuthService, useValue: oauthMock }]
    }).compileComponents();

    fixture = TestBed.createComponent(MainLayoutComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render nav and content area', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.main-nav')).toBeTruthy();
    expect(el.querySelector('.content-area')).toBeTruthy();
  });
});
