import { Injectable, Signal, computed, signal } from '@angular/core';

export type EffectiveTheme = 'light' | 'dark';

const OVERRIDE_KEY = 'plnd_theme_override';

function readIsOverridden(): boolean {
  return localStorage.getItem(OVERRIDE_KEY) === '1';
}

function devicePrefersDark(): boolean {
  return typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: dark)').matches === true;
}

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly deviceDark = devicePrefersDark();
  private readonly isOverriddenSignal = signal<boolean>(readIsOverridden());

  readonly isOverridden: Signal<boolean> = this.isOverriddenSignal.asReadonly();

  readonly effectiveTheme: Signal<EffectiveTheme> = computed(() => {
    const useDark = this.isOverriddenSignal() ? !this.deviceDark : this.deviceDark;
    return useDark ? 'dark' : 'light';
  });

  toggle(): void {
    const newOverridden = !this.isOverriddenSignal();
    if (newOverridden) {
      localStorage.setItem(OVERRIDE_KEY, '1');
    } else {
      localStorage.removeItem(OVERRIDE_KEY);
    }
    this.isOverriddenSignal.set(newOverridden);
  }
}
