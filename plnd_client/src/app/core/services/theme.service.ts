import { DestroyRef, Injectable, Signal, computed, inject, signal } from '@angular/core';

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
  private readonly destroyRef = inject(DestroyRef);
  private readonly deviceDarkSignal = signal<boolean>(devicePrefersDark());
  private readonly isOverriddenSignal = signal<boolean>(readIsOverridden());

  readonly isOverridden: Signal<boolean> = this.isOverriddenSignal.asReadonly();

  readonly effectiveTheme: Signal<EffectiveTheme> = computed(() => {
    const useDark = this.isOverriddenSignal() ? !this.deviceDarkSignal() : this.deviceDarkSignal();
    return useDark ? 'dark' : 'light';
  });

  constructor() {
    if (typeof window !== 'undefined' && window.matchMedia) {
      const mql = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = (e: MediaQueryListEvent): void => {
        this.deviceDarkSignal.set(e.matches);
        this.isOverriddenSignal.set(false);
        localStorage.removeItem(OVERRIDE_KEY);
      };
      mql.addEventListener('change', handler);
      this.destroyRef.onDestroy(() => mql.removeEventListener('change', handler));
    }
  }

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
