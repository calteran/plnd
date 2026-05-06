import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { SettingsComponent } from './settings';

const MOCK_PREFS = {
  user_id: 'u1',
  week_start_day: 1,
  planning_trigger_offset: 0,
  default_plan_length_days: 7,
  created_at: '',
  updated_at: '',
};

describe('SettingsComponent', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SettingsComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ]
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
    spyOn(console, 'error');
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should create', () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges();
    httpMock.expectOne(r => r.url.includes('/preferences/me') && r.method === 'GET')
      .flush(MOCK_PREFS);
    fixture.detectChanges();
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('renders the Settings heading', () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges();
    httpMock.expectOne(r => r.url.includes('/preferences/me') && r.method === 'GET')
      .flush(MOCK_PREFS);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('h1').textContent).toContain('Settings');
  });

  it('goBack() navigates to /today', () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges();
    httpMock.expectOne(r => r.method === 'GET').flush(MOCK_PREFS);
    fixture.detectChanges();
    const router = TestBed.inject(Router);
    spyOn(router, 'navigate');
    fixture.componentInstance.goBack();
    expect(router.navigate).toHaveBeenCalledWith(['/today']);
  });

  it('should render week start day select', () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges();
    httpMock.expectOne(r => r.url.includes('/preferences/me') && r.method === 'GET')
      .flush(MOCK_PREFS);
    fixture.detectChanges();
    const select = fixture.nativeElement.querySelector('#weekStartDay');
    expect(select).toBeTruthy();
  });

  it('should patch preferences on save', () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges();
    httpMock.expectOne(r => r.method === 'GET').flush(MOCK_PREFS);
    fixture.detectChanges();

    const btn: HTMLButtonElement = fixture.nativeElement.querySelector('button[type="submit"]');
    btn.click();
    const req = httpMock.expectOne(r => r.url.includes('/preferences/me') && r.method === 'PATCH');
    expect(req.request.body).toBeTruthy();
    req.flush({
      user_id: 'u1', week_start_day: 1, planning_trigger_offset: 0,
      default_plan_length_days: 7, created_at: '', updated_at: ''
    });
  });

  it('shows error message when preferences fail to load', () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges();
    httpMock.expectOne(r => r.url.includes('/preferences/me') && r.method === 'GET')
      .flush('error', { status: 500, statusText: 'Internal Server Error' });
    fixture.detectChanges();

    const errorEl = fixture.nativeElement.querySelector('.load-error');
    expect(errorEl).toBeTruthy();
    expect(errorEl.textContent).toContain("Settings couldn't be loaded");
  });

  it('retry button clears error and re-fetches preferences', () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges();
    httpMock.expectOne(r => r.url.includes('/preferences/me') && r.method === 'GET')
      .flush('error', { status: 500, statusText: 'Internal Server Error' });
    fixture.detectChanges();

    const retryBtn: HTMLButtonElement = fixture.nativeElement.querySelector('.load-error button');
    expect(retryBtn).toBeTruthy();
    retryBtn.click();

    // A new GET should be issued after retry
    const retryReq = httpMock.expectOne(r => r.url.includes('/preferences/me') && r.method === 'GET');
    retryReq.flush(MOCK_PREFS);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.load-error')).toBeNull();
    expect(fixture.nativeElement.querySelector('form')).toBeTruthy();
  });

  it('planLengthDays form control rejects values above 14', () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges();
    httpMock.expectOne(r => r.url.includes('/preferences/me') && r.method === 'GET')
      .flush(MOCK_PREFS);
    fixture.detectChanges();

    const control = fixture.componentInstance.form.controls.planLengthDays;
    control.setValue(15);
    expect(control.valid).toBeFalse();
    control.setValue(14);
    expect(control.valid).toBeTrue();
  });
});
