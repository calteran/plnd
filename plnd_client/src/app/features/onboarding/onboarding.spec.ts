import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { OnboardingComponent } from './onboarding';
import { OnboardingStateService } from './onboarding-state.service';
import { PreferencesService } from '../../core/services/preferences.service';
import { signal } from '@angular/core';

describe('OnboardingComponent (shell)', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OnboardingComponent],
      providers: [
        { provide: PreferencesService, useValue: { preferences: signal(null) } },
        provideRouter([])
      ]
    }).compileComponents();
  });

  it('should create', () => {
    const fixture = TestBed.createComponent(OnboardingComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('provides OnboardingStateService at component scope', () => {
    const fixture = TestBed.createComponent(OnboardingComponent);
    const svc = fixture.debugElement.injector.get(OnboardingStateService);
    expect(svc).toBeTruthy();
    expect(svc.allSectionsComplete()).toBeFalse();
  });
});
