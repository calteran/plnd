import { Component, OnInit, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormControl, FormGroup, Validators } from '@angular/forms';
import { WeekPlanService } from '../../../../core/services/week-plan.service';
import { EnergyLevel, PlannedTask } from '../../../../core/models/week-plan';

@Component({
  selector: 'app-plan-tasks-step',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <div class="plan-tasks">
      <h2>Tasks &amp; Exercise</h2>

      @for (day of horizonDays; track day) {
        <div class="day-tasks-row">
          <h3>{{ day }}</h3>
          <ul>
            @for (task of (tasksByDay()[day] ?? []); track $index) {
              <li class="task-item">
                <span class="task-energy energy-{{ task.energy }}">●</span>
                {{ task.title }}
                <button type="button" (click)="removeTask(day, $index)">✕</button>
              </li>
            }
          </ul>
        </div>
      }

      <form [formGroup]="addTaskForm" class="add-task-form">
        <h3>Add a task or exercise</h3>
        <select formControlName="date">
          @for (day of horizonDays; track day) {
            <option [value]="day">{{ day }}</option>
          }
        </select>
        <input formControlName="title" placeholder="Task name" />
        <select formControlName="energy">
          <option value="low">Low energy</option>
          <option value="medium">Medium energy</option>
          <option value="high">High energy</option>
        </select>
        <input formControlName="duration" type="number" placeholder="Minutes (optional)" />
        <button type="button" (click)="submitAddTask()"
                [disabled]="addTaskForm.invalid">Add</button>
      </form>
    </div>
  `,
  styles: [`
    .day-tasks-row { margin-bottom: 1rem; }
    .task-item { display: flex; align-items: center; gap: 0.5rem; padding: 4px 0; font-size: 13px; }
    .task-energy { font-size: 10px; }
    .task-energy.energy-low { color: var(--color-energy-low); }
    .task-energy.energy-medium { color: var(--color-energy-medium); }
    .task-energy.energy-high { color: var(--color-energy-high); }
    .task-item button { background: none; border: none; color: var(--color-text-muted); cursor: pointer;
                        font-size: 12px; padding: 2px 4px; border-radius: 4px; margin-left: auto; }
    .task-item button:hover { background: var(--color-border-row); color: var(--color-text-primary); }
    .add-task-form { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 1.5rem;
                     padding-top: 1rem; border-top: 1px solid var(--color-border-row); }
    .add-task-form input, .add-task-form select { padding: 6px 10px; border: 1px solid var(--color-border-row);
                                                   border-radius: 6px; font-size: 12px; font-family: inherit;
                                                   background: var(--color-surface-white); color: var(--color-text-body); }
    .add-task-form input:focus, .add-task-form select:focus { outline: none; border-color: var(--color-accent); }
    .add-task-form button { background: var(--color-accent-light); border: 1.5px solid var(--color-accent-border);
                             border-radius: 6px; padding: 6px 16px; font-size: 12px; font-weight: 600;
                             color: var(--color-accent-dark); cursor: pointer; }
    .add-task-form button:disabled { opacity: 0.4; cursor: not-allowed; }
  `]
})
export class PlanTasksStepComponent implements OnInit {
  readonly weekPlanService = inject(WeekPlanService);
  horizonDays: string[] = [];

  readonly tasksByDay = computed(() => {
    const byDay: Record<string, PlannedTask[]> = {};
    for (const task of this.weekPlanService.scheduledTasks()) {
      (byDay[task.date] ??= []).push(task);
    }
    return byDay;
  });

  readonly addTaskForm = new FormGroup({
    date: new FormControl<string>('', { nonNullable: true, validators: [Validators.required] }),
    title: new FormControl<string>('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(200)] }),
    energy: new FormControl<EnergyLevel>('medium', { nonNullable: true }),
    duration: new FormControl<number | null>(null),
  });

  ngOnInit(): void {
    this.horizonDays = this.weekPlanService.horizonDays();
    if (this.horizonDays.length) {
      this.addTaskForm.patchValue({ date: this.horizonDays[0] });
    }
  }

  removeTask(date: string, localIndex: number): void {
    const tasks = this.weekPlanService.scheduledTasks();
    const dayTasks = tasks.filter(t => t.date === date);
    const targetTask = dayTasks[localIndex];
    const globalIndex = tasks.indexOf(targetTask);
    if (globalIndex >= 0) this.weekPlanService.removeTask(globalIndex);
  }

  submitAddTask(): void {
    if (this.addTaskForm.invalid) return;
    const v = this.addTaskForm.getRawValue();
    this.weekPlanService.addTask({
      date: v.date,
      title: v.title,
      energy: v.energy,
      duration: v.duration ?? undefined,
      task_type: 'custom',
    });
    this.addTaskForm.patchValue({ title: '', duration: null });
  }
}
