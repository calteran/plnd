import { Component, OnInit, effect, inject, signal } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { NavbarAvatarComponent } from '../../shared/components/navbar-avatar/navbar-avatar';
import { todayIso } from '../../core/services/schedule.service';
import { WeekPlanService } from '../../core/services/week-plan.service';
import { PreferencesService } from '../../core/services/preferences.service';

@Component({
  selector: 'app-main-layout',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, NavbarAvatarComponent],
  templateUrl: './main-layout.html',
  styleUrl: './main-layout.scss'
})
export class MainLayoutComponent implements OnInit {
  protected readonly sidebarExpanded = signal(false);
  protected readonly todayDate = todayIso();
  readonly weekPlanService = inject(WeekPlanService);
  private readonly preferencesService = inject(PreferencesService);

  private statusChecked = false;

  constructor() {
    // Check plan status once preferences load so the sidebar badge reflects
    // whether the upcoming horizon has a committed plan.
    effect(() => {
      const prefs = this.preferencesService.preferences();
      if (!prefs || this.statusChecked) return;
      this.statusChecked = true;
      const today = new Date();
      const daysUntilStart = ((prefs.week_start_day - today.getDay()) + 7) % 7 || 7;
      const planStart = new Date(today);
      planStart.setDate(today.getDate() + daysUntilStart);
      const planEnd = new Date(planStart);
      planEnd.setDate(planStart.getDate() + prefs.default_plan_length_days - 1);
      this.weekPlanService.checkPlanStatus(toIsoDate(planStart), toIsoDate(planEnd));
    });
  }

  ngOnInit(): void {
    this.preferencesService.loadPreferences();
  }

  expandSidebar(): void  { this.sidebarExpanded.set(true); }
  collapseSidebar(): void { this.sidebarExpanded.set(false); }
}

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
