import { Component, DestroyRef, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ScheduleService, todayIso } from '../../core/services/schedule.service';
import { BriefingService } from '../../core/services/briefing.service';
import { isMealAnchor } from '../../core/models/schedule';
import { DayHeaderComponent } from '../schedule/components/day-header/day-header';
import { MealRowComponent } from '../schedule/components/meal-row/meal-row';
import { TaskRowComponent } from '../schedule/components/task-row/task-row';
import { AddEntryComponent, AddedEntry } from '../schedule/components/add-entry/add-entry';
import { BriefingHeaderComponent } from './components/briefing-header/briefing-header';
import { YesterdaySnapshotComponent } from './components/yesterday-snapshot/yesterday-snapshot';

@Component({
  selector: 'app-day-view',
  standalone: true,
  imports: [
    DayHeaderComponent,
    MealRowComponent,
    TaskRowComponent,
    AddEntryComponent,
    BriefingHeaderComponent,
    YesterdaySnapshotComponent,
  ],
  template: `
    <div class="schedule-view">

      <app-day-header
        [date]="scheduleService.date()"
        (dateChange)="onDateChange($event)"
      />

      @if (isToday()) {
        <app-briefing-header />
      }

      @if (scheduleService.isLoading()) {
        <div class="skeleton-list" aria-label="Loading schedule" aria-busy="true">
          <div class="skeleton skeleton--meal"></div>
          <div class="skeleton skeleton--task"></div>
          <div class="skeleton skeleton--task"></div>
        </div>
      } @else if (scheduleService.loadError()) {
        <div class="error-state" role="alert">
          <p>Couldn't load your day.
            <button class="retry-link" (click)="retry()">Tap to retry.</button>
          </p>
        </div>
      } @else {
        @if (scheduleService.scheduleItems().length === 0) {
          <div class="empty-state">
            <p>Nothing planned yet. Add something to get started.</p>
          </div>
        } @else {
          <div class="schedule-list">
            @for (item of scheduleService.scheduleItems(); track item.id) {
              @if (isMealAnchor(item)) {
                <app-meal-row
                  [meal]="item"
                  [date]="scheduleService.date()"
                  (toggled)="scheduleService.toggleItem($event)"
                  (doneToggle)="scheduleService.toggleMealConsumed($event)"
                  (skipped)="scheduleService.setMealConsumption($event, 'skipped')"
                />
              } @else {
                <app-task-row
                  [item]="item"
                  (toggled)="scheduleService.toggleItem($event)"
                />
              }
            }
          </div>
        }
      }
      <app-add-entry
        [date]="scheduleService.date()"
        (added)="onItemAdded($event)"
        (confirmed)="onTaskConfirmed($event)"
      />

      @if (isToday()) {
        <app-yesterday-snapshot />
      }

      @if (toastMessage()) {
        <div class="toast" role="status" aria-live="polite">
          <span class="toast-message">{{ toastMessage() }}</span>
          <button class="toast-close" type="button" (click)="closeToast()" aria-label="Dismiss">×</button>
        </div>
      }

    </div>
  `,
  styleUrl: './day-view.scss',
})
export class DayViewComponent implements OnInit, OnDestroy {
  protected readonly scheduleService = inject(ScheduleService);
  protected readonly briefingService = inject(BriefingService);
  protected readonly isMealAnchor    = isMealAnchor;
  private  readonly route            = inject(ActivatedRoute);
  private  readonly router           = inject(Router);
  private  readonly destroyRef       = inject(DestroyRef);

  readonly isToday = computed(() => this.scheduleService.date() === todayIso());

  protected readonly toastMessage = signal<string | null>(null);
  private toastTimer?: ReturnType<typeof setTimeout>;

  ngOnInit(): void {
    this.route.params
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(params => {
        this.scheduleService.loadDay(params['date']);
        if (this.isToday()) {
          this.briefingService.load(params['date']);
        }
      });
  }

  onDateChange(date: string): void { this.router.navigate(['/day', date]); }
  retry(): void { this.scheduleService.loadDay(this.scheduleService.date()); }
  onItemAdded(_entry: AddedEntry): void {
    this.scheduleService.loadDay(this.scheduleService.date());
  }

  ngOnDestroy(): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
  }

  onTaskConfirmed(message: string): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastMessage.set(message);
    this.toastTimer = setTimeout(() => this.toastMessage.set(null), 5000);
  }

  closeToast(): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastMessage.set(null);
  }
}
