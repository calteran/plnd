import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { Router } from '@angular/router';
import { SettingsComponent } from './settings';
import { UserPreferences } from '../../core/models/preferences';
import { PreferencesService } from '../../core/services/preferences.service';

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

  function createAndLoad() {
    const fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges();
    httpMock.expectOne(r => r.url.endsWith('/preferences/me')).flush(mockPrefs);
    fixture.detectChanges();
    return fixture;
  }

  it('should create', () => {
    const fixture = createAndLoad();
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should render the theme select', () => {
    const fixture = createAndLoad();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('select#theme')).toBeTruthy();
  });

  it('shows loading text while preferences are null', () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.loading-text')).toBeTruthy();
    // Flush to satisfy httpMock.verify()
    httpMock.expectOne(r => r.url.endsWith('/preferences/me')).flush(mockPrefs);
    fixture.detectChanges();
  });

  it('hides loading text once preferences are loaded', () => {
    const fixture = createAndLoad();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.loading-text')).toBeNull();
  });

  it('pre-populates themeControl when preferences already in signal (no-op ngOnInit path)', () => {
    // Pre-seed the preferences signal before creating the component
    const prefsSvc = TestBed.inject(PreferencesService);
    const svc = prefsSvc as unknown as { preferencesSignal: { set: (v: UserPreferences) => void } };
    svc.preferencesSignal.set({ ...mockPrefs, theme: 'dark' });

    const fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges();
    // No HTTP request because preferences already in signal (loadPreferences no-ops)
    httpMock.expectNone(r => r.url.endsWith('/preferences/me'));
    expect(fixture.componentInstance.themeControl.value).toBe('dark');
  });

  it('save() calls PATCH and shows success message on success', () => {
    const fixture = createAndLoad();
    const component = fixture.componentInstance;
    component.themeControl.setValue('dark');
    component.themeControl.markAsDirty();
    fixture.detectChanges();

    component.save();
    const req = httpMock.expectOne(r => r.url.endsWith('/preferences/me') && r.method === 'PATCH');
    req.flush({ ...mockPrefs, theme: 'dark' });
    fixture.detectChanges();

    expect(component.successMessage).toBe('Settings saved.');
    expect(component.pending).toBeFalse();
  });

  it('save() shows error message on HTTP 500', () => {
    const fixture = createAndLoad();
    const component = fixture.componentInstance;
    component.themeControl.setValue('dark');
    component.themeControl.markAsDirty();

    component.save();
    const req = httpMock.expectOne(r => r.url.endsWith('/preferences/me') && r.method === 'PATCH');
    req.flush('Server Error', { status: 500, statusText: 'Internal Server Error' });
    fixture.detectChanges();

    expect(component.errorMessage).toBe('Failed to save. Please try again.');
    expect(component.pending).toBeFalse();
  });

  it('save() no-ops while pending is true', () => {
    const fixture = createAndLoad();
    const component = fixture.componentInstance;
    component.pending = true;
    component.save();
    httpMock.expectNone(r => r.url.endsWith('/preferences/me') && r.method === 'PATCH');
    expect(component.pending).toBeTrue();
  });

  it('goBack() navigates to /dashboard', () => {
    const fixture = createAndLoad();
    const router = TestBed.inject(Router);
    spyOn(router, 'navigate');
    fixture.componentInstance.goBack();
    expect(router.navigate).toHaveBeenCalledWith(['/dashboard']);
  });

  it('Save button is disabled when form is pristine', () => {
    const fixture = createAndLoad();
    const btn = fixture.nativeElement.querySelector('.btn--primary') as HTMLButtonElement;
    expect(btn.disabled).toBeTrue();
  });

  it('Save button is enabled when form is dirty', () => {
    const fixture = createAndLoad();
    const component = fixture.componentInstance;
    component.themeControl.markAsDirty();
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('.btn--primary') as HTMLButtonElement;
    expect(btn.disabled).toBeFalse();
  });
});
