import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { OnboardingStateService } from './onboarding-state.service';

@Component({
  selector: 'app-onboarding',
  standalone: true,
  imports: [RouterOutlet],
  providers: [OnboardingStateService],
  template: `<router-outlet />`,
  styleUrl: './onboarding.scss',
})
export class OnboardingComponent {}
