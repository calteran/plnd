import { Component, DestroyRef, OnInit, computed, inject } from '@angular/core';
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
      } @else if (scheduleService.scheduleItems().length === 0) {
        <div class="empty-state">
          <p>Nothing planned yet. Add something to get started.</p>
        </div>
      } @else {
        <div class="schedule-list">
          @for (item of scheduleService.scheduleItems(); track item.id) {
            @if (isMealAnchor(item)) {
              <app-meal-row
                [meal]="item"
                (toggled)="scheduleService.toggleItem($event)"
                (planMeal)="onPlanMeal($event)"
              />
            } @else {
              <app-task-row
                [item]="item"
                (toggled)="scheduleService.toggleItem($event)"
              />
            }
          }
          <app-add-entry (added)="onItemAdded($event)" />
        </div>
      }

      @if (isToday()) {
        <app-yesterday-snapshot />
      }

    </div>
  `,
  styleUrl: './day-view.scss',
})
export class DayViewComponent implements OnInit {
  protected readonly scheduleService = inject(ScheduleService);
  protected readonly briefingService = inject(BriefingService);
  protected readonly isMealAnchor    = isMealAnchor;
  private  readonly route            = inject(ActivatedRoute);
  private  readonly router           = inject(Router);
  private  readonly destroyRef       = inject(DestroyRef);

  readonly isToday = computed(() => this.scheduleService.date() === todayIso());

  ngOnInit(): void {
    this.route.params
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(params => {
        this.scheduleService.loadDay(params['date']);
        if (this.isToday()) {
          this.briefingService.load();
        }
      });
  }

  onDateChange(date: string): void { this.router.navigate(['/day', date]); }
  retry(): void { this.scheduleService.loadDay(this.scheduleService.date()); }
  onPlanMeal(_mealId: string): void { /* TODO: open meal planning panel */ }
  onItemAdded(_entry: AddedEntry): void { /* TODO: add item to service */ }
}
