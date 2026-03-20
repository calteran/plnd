import { TestBed } from '@angular/core/testing';
import { ThemeService } from './theme.service';

const OVERRIDE_KEY = 'plnd_theme_override';

describe('ThemeService', () => {
  let service: ThemeService;

  beforeEach(() => {
    localStorage.clear();
    spyOn(window, 'matchMedia').and.returnValue({ matches: false } as MediaQueryList);
    TestBed.configureTestingModule({});
    service = TestBed.inject(ThemeService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('isOverridden defaults to false when key is absent', () => {
    expect(service.isOverridden()).toBeFalse();
  });

  it('isOverridden reads true from localStorage on init', () => {
    localStorage.setItem(OVERRIDE_KEY, '1');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const fresh = TestBed.inject(ThemeService);
    expect(fresh.isOverridden()).toBeTrue();
  });

  it('toggle() sets isOverridden to true and writes localStorage', () => {
    service.toggle();
    expect(service.isOverridden()).toBeTrue();
    expect(localStorage.getItem(OVERRIDE_KEY)).toBe('1');
  });

  it('toggle() a second time sets isOverridden to false and removes key', () => {
    service.toggle();
    service.toggle();
    expect(service.isOverridden()).toBeFalse();
    expect(localStorage.getItem(OVERRIDE_KEY)).toBeNull();
  });

  it('effectiveTheme() returns "light" when device is light and not overridden', () => {
    // matchMedia returns { matches: false } (light device) from beforeEach
    expect(service.effectiveTheme()).toBe('light');
  });

  it('effectiveTheme() returns "dark" when device is light and overridden', () => {
    // device = light, override = opposite = dark
    service.toggle();
    expect(service.effectiveTheme()).toBe('dark');
  });

  it('effectiveTheme() returns "dark" when device is dark and not overridden', () => {
    (window.matchMedia as jasmine.Spy).and.returnValue({ matches: true } as MediaQueryList);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const fresh = TestBed.inject(ThemeService);
    expect(fresh.effectiveTheme()).toBe('dark');
  });
});
