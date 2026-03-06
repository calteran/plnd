import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { SettingsComponent } from './settings';
import { UserPreferences } from '../../core/models/preferences';

const mockPrefs: UserPreferences = {
  user_id: 'test-uuid',
  theme: 'system',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z'
};

describe('SettingsComponent', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SettingsComponent, HttpClientTestingModule, RouterTestingModule]
    }).compileComponents();
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should create', () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges();
    httpMock.expectOne(r => r.url.endsWith('/preferences/me')).flush(mockPrefs);
    fixture.detectChanges();
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should render the theme select', () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges();
    httpMock.expectOne(r => r.url.endsWith('/preferences/me')).flush(mockPrefs);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('select#theme')).toBeTruthy();
  });
});
