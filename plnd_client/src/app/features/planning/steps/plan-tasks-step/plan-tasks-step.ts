import { Component, computed, inject, signal } from '@angular/core';
import { WeekPlanService } from '../../../../core/services/week-plan.service';
import { PlannedTask } from '../../../../core/models/week-plan';
import { AddEntryComponent, AddedEntry } from '../../../schedule/components/add-entry/add-entry';
import { formatDayName, formatDayDate } from '../../utils/date-format.utils';

@Component({
  selector: 'app-plan-tasks-step',
  standalone: true,
  imports: [AddEntryComponent],
  template: `
    <div class="tasks-step">

      @for (day of horizonDays(); track day) {
        <div class="day-accordion" [class.open]="expandedState()[day]">

          <div class="day-accordion__header"
               role="button"
               tabindex="0"
               [attr.aria-expanded]="expandedState()[day]"
               (click)="toggleDay(day)"
               (keydown.enter)="toggleDay(day)"
               (keydown.space)="$event.preventDefault(); toggleDay(day)">
            <span class="day-name">{{ formattedDays()[day].dayName }}</span>
            <span class="day-date">{{ formattedDays()[day].shortDate }}</span>
            <span class="task-badge"
                  [class.zero]="(tasksByDay()[day]?.length ?? 0) === 0">
              {{ tasksByDay()[day]?.length ?? 0 }}
              {{ (tasksByDay()[day]?.length ?? 0) === 1 ? 'task' : 'tasks' }}
            </span>
            <span class="chevron">▾</span>
          </div>

          <div class="day-accordion__body">
            <div class="task-list">
              @for (task of tasksByDay()[day]; track task) {
                <div class="task-row">
                  <span class="task-title">{{ task.title }}</span>
                  <span class="energy-badge energy-{{ task.energy }}">
                    {{ task.energy === 'medium' ? 'med' : task.energy }}
                  </span>
                  <button type="button" class="task-remove"
                          (click)="removeTask(day, $index)">✕</button>
                </div>
              }
            </div>
            <div class="add-affordance">
              <app-add-entry (added)="onTaskAdded(day, $event)" />
            </div>
          </div>

        </div>
      }

      <div class="floating-panel">
        <div class="floating-panel__header">
          <span class="floating-title">FLOATING TASKS</span>
          <span class="floating-hint">agent will schedule these</span>
        </div>
        <div class="float-task-list">
          @for (task of floatingTasks(); track task.title) {
            <div class="floating-task-row">
              <span class="task-title">{{ task.title }}</span>
              <span class="floating-badge">floating</span>
              <button type="button" class="floating-remove"
                      (click)="removeFloatingTask($index)">✕</button>
            </div>
          }
        </div>
        <div class="float-add-affordance">
          <app-add-entry (added)="onFloatingTaskAdded($event)" />
        </div>
      </div>

    </div>
  `,
  styles: [`
    .tasks-step { display: flex; flex-direction: column; gap: 8px; }

    /* ── Accordion shell ─────────────────────────── */
    .day-accordion {
      background: var(--color-surface-white);
      border: 1.5px solid var(--color-border-row);
      border-radius: 10px;
      overflow: hidden;
      transition: border-color 0.15s;
    }
    .day-accordion.open { border-color: var(--color-accent); }

    /* ── Accordion header ────────────────────────── */
    .day-accordion__header {
      background: var(--color-surface-warm);
      border-bottom: 1.5px solid var(--color-border-meal);
      padding: 8px 12px;
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      user-select: none;
    }
    .day-accordion__header:focus-visible {
      outline: 2px solid var(--color-accent);
      outline-offset: -2px;
    }
    .day-accordion.open .day-accordion__header {
      background: var(--color-accent-light);
      border-bottom-color: var(--color-accent-border);
    }
    .day-name {
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--color-text-primary);
    }
    .day-accordion.open .day-name { color: var(--color-accent-dark); }
    .day-date { font-size: 10px; color: var(--color-text-muted); }
    .task-badge {
      font-size: 9px;
      font-weight: 700;
      padding: 1px 6px;
      border-radius: 3px;
      background: var(--color-accent-light);
      border: 1px solid var(--color-accent-border);
      color: var(--color-accent-dark);
    }
    .task-badge.zero {
      background: var(--color-surface-base);
      border-color: var(--color-border-row);
      color: var(--color-text-muted);
    }
    .chevron {
      margin-left: auto;
      font-size: 10px;
      color: var(--color-text-muted);
      transition: transform 0.2s;
    }
    .day-accordion.open .chevron { transform: rotate(180deg); }

    /* ── Accordion body (max-height transition) ──── */
    .day-accordion__body {
      overflow: hidden;
      max-height: 0;
      transition: max-height 0.25s ease-out;
    }
    .day-accordion.open .day-accordion__body {
      max-height: 800px;
      transition: max-height 0.3s ease-in;
    }

    /* ── Task rows ───────────────────────────────── */
    .task-row {
      display: flex;
      align-items: center;
      gap: 7px;
      padding: 6px 12px;
      border-bottom: 1px solid var(--color-border-row);
      font-size: 12px;
    }
    .task-list .task-row:last-child { border-bottom: none; }
    .task-title { flex: 1; color: var(--color-text-body); }

    /* ── Remove buttons ──────────────────────────── */
    .task-remove, .floating-remove {
      background: none;
      border: 1px solid transparent;
      color: var(--color-text-muted);
      cursor: pointer;
      font-size: 11px;
      padding: 2px 5px;
      border-radius: 4px;
      margin-left: auto;
    }
    .task-remove:hover, .floating-remove:hover {
      border-color: var(--color-border-row);
      color: var(--color-text-primary);
    }

    /* ── Add affordance ──────────────────────────── */
    .add-affordance { border-top: 1px dashed var(--color-border-row); }

    /* ── Floating panel ──────────────────────────── */
    .floating-panel {
      background: var(--color-surface-white);
      border: 1.5px solid var(--color-purple-border);
      border-radius: 10px;
      overflow: hidden;
      margin-top: 4px;
    }
    .floating-panel__header {
      background: var(--color-purple-light);
      border-bottom: 1.5px solid var(--color-purple-border);
      padding: 8px 12px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .floating-title {
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--color-purple-dark);
    }
    .floating-hint {
      margin-left: auto;
      font-size: 10px;
      color: var(--color-purple);
      font-style: italic;
      opacity: 0.75;
    }
    .floating-task-row {
      display: flex;
      align-items: center;
      gap: 7px;
      padding: 6px 12px;
      border-bottom: 1px solid var(--color-border-row);
      font-size: 12px;
    }
    .float-task-list .floating-task-row:last-child { border-bottom: none; }
    .floating-badge {
      font-size: 8px;
      font-weight: 700;
      padding: 1px 6px;
      border-radius: 3px;
      background: var(--color-purple-light);
      border: 1px solid var(--color-purple-border);
      color: var(--color-purple-dark);
      flex-shrink: 0;
    }
    .float-add-affordance { border-top: 1px dashed var(--color-purple-border); }
  `],
})
export class PlanTasksStepComponent {
  private readonly weekPlanService = inject(WeekPlanService);

  readonly horizonDays = computed(() => this.weekPlanService.horizonDays());

  readonly tasksByDay = computed(() => {
    const byDay: Record<string, PlannedTask[]> = Object.fromEntries(
      this.horizonDays().map(d => [d, [] as PlannedTask[]])
    );
    for (const task of this.weekPlanService.scheduledTasks()) {
      (byDay[task.date] ??= []).push(task);
    }
    return byDay;
  });

  protected readonly floatingTasks = computed(() => this.weekPlanService.floatingTasks());

  private readonly expandedOverrides = signal<Record<string, boolean>>({});

  readonly formattedDays = computed(() =>
    Object.fromEntries(
      this.horizonDays().map(d => [d, {
        dayName: formatDayName(d).toUpperCase(),
        shortDate: formatDayDate(d),
      }])
    ) as Record<string, { dayName: string; shortDate: string }>
  );

  readonly expandedState = computed<Record<string, boolean>>(() => {
    const days = this.horizonDays();
    const overrides = this.expandedOverrides();
    const defaultVal = days.length <= 7;
    const state: Record<string, boolean> = {};
    for (const day of days) {
      state[day] = day in overrides ? overrides[day] : defaultVal;
    }
    return state;
  });

  toggleDay(date: string): void {
    this.expandedOverrides.update(o => ({ ...o, [date]: !(this.expandedState()[date] ?? false) }));
  }

  removeTask(date: string, localIndex: number): void {
    const tasks = this.weekPlanService.scheduledTasks();
    const dayTasks = tasks.filter(t => t.date === date);
    const target = dayTasks[localIndex];
    if (target) {
      const globalIndex = tasks.indexOf(target);
      if (globalIndex >= 0) this.weekPlanService.removeTask(globalIndex);
    }
  }

  removeFloatingTask(index: number): void {
    this.weekPlanService.removeFloatingTask(index);
  }

  onTaskAdded(date: string, entry: AddedEntry): void {
    this.weekPlanService.addTask({
      date,
      title: entry.label,
      energy: 'medium',
      duration: entry.duration,
      task_type: entry.type === 'exercise' ? 'exercise' : 'general',
    });
  }

  onFloatingTaskAdded(entry: AddedEntry): void {
    this.weekPlanService.addFloatingTask({
      title: entry.label,
      energy: 'medium',
      duration: entry.duration,
      task_type: entry.type === 'exercise' ? 'exercise' : 'general',
    });
  }
}
