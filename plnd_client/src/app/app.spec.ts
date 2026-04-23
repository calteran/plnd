import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AppComponent } from './app';
import { provideRouter } from '@angular/router';
import { ThemeService } from './core/services/theme.service';

describe('AppComponent', () => {
  let fixture: ComponentFixture<AppComponent>;
  let component: AppComponent;

  beforeEach(() => {
    localStorage.clear();
    const mql = jasmine.createSpyObj('MediaQueryList', ['addEventListener', 'removeEventListener']);
    mql.matches = false;
    spyOn(window, 'matchMedia').and.returnValue(mql as unknown as MediaQueryList);
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
