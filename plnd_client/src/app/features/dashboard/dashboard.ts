import { Component, OnInit, inject } from '@angular/core';
import { ScheduleService } from '../../core/services/schedule.service';
import { isMealAnchor } from '../../core/models/schedule';
import { DayHeaderComponent } from '../schedule/components/day-header/day-header';
import { MealRowComponent } from '../schedule/components/meal-row/meal-row';
import { TaskRowComponent } from '../schedule/components/task-row/task-row';
import { AddEntryComponent } from '../schedule/components/add-entry/add-entry';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [DayHeaderComponent, MealRowComponent, TaskRowComponent, AddEntryComponent],
  template: `
    <div class="schedule-view">

      <app-day-header
        [date]="scheduleService.date()"
        (dateChange)="onDateChange($event)"
      />

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
    </div>
  `,
  styleUrl: './dashboard.scss'
})
export class DashboardComponent implements OnInit {
  protected readonly scheduleService = inject(ScheduleService);
  protected readonly isMealAnchor    = isMealAnchor;

  ngOnInit(): void {
    this.scheduleService.loadDay(new Date().toISOString().split('T')[0]);
  }

  onDateChange(date: string): void { this.scheduleService.loadDay(date); }
  retry(): void { this.scheduleService.loadDay(this.scheduleService.date()); }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onPlanMeal(mealId: string): void { /* TODO: open meal planning panel */ }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onItemAdded(entry: unknown): void { /* TODO: add item to service */ }
}
