import { Component, DestroyRef, OnInit, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { NavbarAvatarComponent } from '../../shared/components/navbar-avatar/navbar-avatar';
import { todayIso, localIsoDate } from '../../core/services/schedule.service';
import { WeekPlanService } from '../../core/services/week-plan.service';
import { PreferencesService } from '../../core/services/preferences.service';
import { AuthService } from '../../core/services/auth.service';
import { TimezoneService } from '../../core/services/timezone.service';
import { StandoffConfirm } from '../../core/models/timezone';
import { TimezoneStandoffComponent } from '../../features/day-view/components/timezone-standoff/timezone-standoff';

@Component({
  selector: 'app-main-layout',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, NavbarAvatarComponent, TimezoneStandoffComponent],
  templateUrl: './main-layout.html',
  styleUrl: './main-layout.scss'
})
export class MainLayoutComponent implements OnInit {
  protected readonly sidebarExpanded = signal(false);
  protected readonly todayDate = todayIso();
  readonly weekPlanService = inject(WeekPlanService);
  private readonly preferencesService = inject(PreferencesService);
  private readonly auth = inject(AuthService);
  private readonly tz = inject(TimezoneService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly standoff = signal<StandoffConfirm | null>(null);

  private statusChecked = false;

  constructor() {
    // Check plan status once preferences load so the sidebar badge reflects
    // whether the upcoming horizon has a committed plan.
    effect(() => {
      const prefs = this.preferencesService.preferences();
      if (!prefs || this.statusChecked) return;
      this.statusChecked = true;
      const today = new Date();
      const daysUntilStart = ((prefs.week_start_day - today.getDay()) + 7) % 7;
      const planStart = new Date(today);
      planStart.setDate(today.getDate() + daysUntilStart);
      const planEnd = new Date(planStart);
      planEnd.setDate(planStart.getDate() + prefs.default_plan_length_days - 1);
      this.weekPlanService.checkPlanStatus(localIsoDate(planStart), localIsoDate(planEnd));
    });
  }

  ngOnInit(): void {
    this.preferencesService.loadPreferences();

    if (this.auth.isAuthenticated()) {
      this.tz.reportDeviceZone(this.tz.deviceZone())
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: r => {
            if (r.outcome === 'standoff' && r.confirm) {
              this.standoff.set(r.confirm);
            }
          },
          error: () => {},
        });
    }
  }

  onMoved(s: StandoffConfirm): void {
    this.tz.createAnchor({ effective_date: todayIso(), zone: s.device_zone })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.standoff.set(null),
        error: () => this.standoff.set(null),
      });
  }

  onClockOff(): void {
    this.tz.dismissStandoff()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.standoff.set(null),
        error: () => this.standoff.set(null),
      });
  }

  expandSidebar(): void  { this.sidebarExpanded.set(true); }
  collapseSidebar(): void { this.sidebarExpanded.set(false); }
}
