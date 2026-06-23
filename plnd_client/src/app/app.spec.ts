import { createSpyObj } from '../testing/spy';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AppComponent } from './app';
import { provideRouter } from '@angular/router';
import { ThemeService } from './core/services/theme.service';

describe('AppComponent', () => {
  let fixture: ComponentFixture<AppComponent>;
  let component: AppComponent;

  beforeEach(() => {
    localStorage.clear();
    const mql = createSpyObj(['addEventListener', 'removeEventListener']);
    mql.matches = false;
    vi.spyOn(window, 'matchMedia').mockReturnValue(mql as unknown as MediaQueryList);
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideRouter([])]
    }).compileComponents();

    fixture = TestBed.createComponent(AppComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create the app', () => {
    expect(component).toBeTruthy();
  });

  it('applies data-theme="light" when effectiveTheme is "light"', () => {
    // device = light (matchMedia.matches = false), no override
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('applies data-theme="dark" after toggle (device light → override → dark)', () => {
    const themeService = TestBed.inject(ThemeService);
    themeService.toggle();
    fixture.detectChanges();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
});
