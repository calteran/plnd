import { Component, effect, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { PreferencesService } from './core/services/preferences.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: `<router-outlet />`
})
export class AppComponent {
  private readonly preferencesService = inject(PreferencesService);

  constructor() {
    this.preferencesService.loadPreferences();
    effect(() => {
      const prefs = this.preferencesService.preferences();
      const theme = prefs?.theme ?? 'system';
      const prefersDark = typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-color-scheme: dark)').matches === true;
      const useDark = theme === 'dark' || (theme === 'system' && prefersDark);
      document.documentElement.setAttribute('data-theme', useDark ? 'dark' : 'light');
    });
  }
}
