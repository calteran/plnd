import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormControl, FormGroup, Validators } from '@angular/forms';
import { WeekPlanService } from '../../../../core/services/week-plan.service';
import { EnergyLevel } from '../../../../core/models/week-plan';

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
            @for (task of tasksForDay(day); track $index) {
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
  `
})
export class PlanTasksStepComponent implements OnInit {
  readonly weekPlanService = inject(WeekPlanService);
  horizonDays: string[] = [];

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

  tasksForDay(date: string) {
    return this.weekPlanService.scheduledTasks().filter(t => t.date === date);
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
