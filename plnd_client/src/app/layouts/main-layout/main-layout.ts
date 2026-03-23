import { Component, inject, signal } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { NavbarAvatarComponent } from '../../shared/components/navbar-avatar/navbar-avatar';
import { todayIso } from '../../core/services/schedule.service';
import { WeekPlanService } from '../../core/services/week-plan.service';

@Component({
  selector: 'app-main-layout',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, NavbarAvatarComponent],
  templateUrl: './main-layout.html',
  styleUrl: './main-layout.scss'
})
export class MainLayoutComponent {
  protected readonly sidebarExpanded = signal(false);
  protected readonly todayDate = todayIso();
  readonly weekPlanService = inject(WeekPlanService);

  expandSidebar(): void  { this.sidebarExpanded.set(true); }
  collapseSidebar(): void { this.sidebarExpanded.set(false); }
}
