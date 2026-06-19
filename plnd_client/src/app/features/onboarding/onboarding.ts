import { Component, ChangeDetectionStrategy } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { OnboardingStateService } from './onboarding-state.service';

@Component({
  selector: 'app-onboarding',
  standalone: true,
  imports: [RouterOutlet],
  providers: [OnboardingStateService],
  template: `<router-outlet />`,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './onboarding.scss',
})
export class OnboardingComponent {}
