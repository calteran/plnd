import { createSpyObj, type Mock } from '../../../testing/spy';
import { TestBed } from '@angular/core/testing';
import { ThemeService } from './theme.service';

const OVERRIDE_KEY = 'plnd_theme_override';

interface MockMql {
  matches: boolean;
  addEventListener: Mock;
  removeEventListener: Mock;
}

function createMqlSpy(matches: boolean): MockMql {
  const spy = createSpyObj<MockMql>(['addEventListener', 'removeEventListener']);
  spy.matches = matches;
  return spy;
}

describe('ThemeService', () => {
  let service: ThemeService;
  let mqlSpy: MockMql;
  let capturedHandler: ((e: MediaQueryListEvent) => void) | undefined;

  beforeEach(() => {
    localStorage.clear();
    capturedHandler = undefined;
    mqlSpy = createMqlSpy(false);
    mqlSpy.addEventListener.mockImplementation((_: string, handler: (e: MediaQueryListEvent) => void) => {
      capturedHandler = handler;
    });
    vi.spyOn(window, 'matchMedia').mockReturnValue(mqlSpy as unknown as MediaQueryList);
    TestBed.configureTestingModule({});
    service = TestBed.inject(ThemeService);
  });

  function fireOsChange(matches: boolean): void {
    capturedHandler?.({ matches } as MediaQueryListEvent);
  }

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('isOverridden defaults to false when key is absent', () => {
    expect(service.isOverridden()).toBe(false);
  });

  it('isOverridden reads true from localStorage on init', () => {
    localStorage.setItem(OVERRIDE_KEY, '1');
    TestBed.resetTestingModule();
    const freshMql = createMqlSpy(false);
    (window.matchMedia as Mock).mockReturnValue(freshMql as unknown as MediaQueryList);
    TestBed.configureTestingModule({});
    const fresh = TestBed.inject(ThemeService);
    expect(fresh.isOverridden()).toBe(true);
  });

  it('toggle() sets isOverridden to true and writes localStorage', () => {
    service.toggle();
    expect(service.isOverridden()).toBe(true);
    expect(localStorage.getItem(OVERRIDE_KEY)).toBe('1');
  });

  it('toggle() a second time sets isOverridden to false and removes key', () => {
    service.toggle();
    service.toggle();
    expect(service.isOverridden()).toBe(false);
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
    const darkMql = createMqlSpy(true);
    (window.matchMedia as Mock).mockReturnValue(darkMql as unknown as MediaQueryList);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const fresh = TestBed.inject(ThemeService);
    expect(fresh.effectiveTheme()).toBe('dark');
  });

  it('effectiveTheme() returns "light" when device is dark and overridden', () => {
    const darkMql = createMqlSpy(true);
    (window.matchMedia as Mock).mockReturnValue(darkMql as unknown as MediaQueryList);
    localStorage.setItem(OVERRIDE_KEY, '1');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const fresh = TestBed.inject(ThemeService);
    expect(fresh.effectiveTheme()).toBe('light');
  });

  it('OS changes to dark clears override and sets effectiveTheme to dark', () => {
    // device = light (beforeEach), no override — OS flips to dark
    fireOsChange(true);
    expect(service.effectiveTheme()).toBe('dark');
    expect(service.isOverridden()).toBe(false);
  });

  it('OS changes to light while override is active clears override', () => {
    service.toggle(); // override on: device=light → theme=dark
    expect(service.isOverridden()).toBe(true);
    fireOsChange(false); // OS changes to light — override cleared
    expect(service.effectiveTheme()).toBe('light');
    expect(service.isOverridden()).toBe(false);
    expect(localStorage.getItem(OVERRIDE_KEY)).toBeNull();
  });
});
