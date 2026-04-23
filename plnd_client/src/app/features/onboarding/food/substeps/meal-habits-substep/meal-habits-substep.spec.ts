import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ComponentFixture } from '@angular/core/testing';
import { signal } from '@angular/core';
import { MealHabitsSubstepComponent } from './meal-habits-substep';
import { MealHabitsService } from '../../../../../core/services/meal-habits.service';
import { OnboardingStateService } from '../../../onboarding-state.service';
import { of } from 'rxjs';
import { MealHabitResponse } from '../../../../../core/models/meal-habit';

const mockHabit: MealHabitResponse = {
  id: 'h1', user_id: 'u1', meal_name: 'Oatmeal',
  slot: 'breakfast', recurrence_rule: 'FREQ=DAILY', created_at: '',
};

describe('MealHabitsSubstepComponent', () => {
  let component: MealHabitsSubstepComponent;
  let fixture: ComponentFixture<MealHabitsSubstepComponent>;
  let habitsSvc: jasmine.SpyObj<MealHabitsService>;
  let stateSvc: jasmine.SpyObj<OnboardingStateService>;
  let habitsData: ReturnType<typeof signal<MealHabitResponse[]>>;

  beforeEach(async () => {
    habitsData = signal<MealHabitResponse[]>([]);
    habitsSvc = jasmine.createSpyObj('MealHabitsService', ['load', 'create', 'delete']);
    Object.defineProperty(habitsSvc, 'habits', { value: habitsData.asReadonly(), writable: false });
    stateSvc = jasmine.createSpyObj('OnboardingStateService', ['setMealHabits']);

    await TestBed.configureTestingModule({
      imports: [MealHabitsSubstepComponent],
      providers: [
        { provide: MealHabitsService, useValue: habitsSvc },
        { provide: OnboardingStateService, useValue: stateSvc },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MealHabitsSubstepComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('shows day picker only when recurrence is Weekly', () => {
    component.recurrence.set('Every day');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.day-picker')).toBeNull();
    component.recurrence.set('Weekly…');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.day-picker')).not.toBeNull();
  });

  it('add() calls MealHabitsService.create with correct RRULE for Every day', fakeAsync(() => {
    habitsSvc.create.and.returnValue(of(mockHabit));
    component.mealName.set('Oatmeal');
    component.slot.set('breakfast');
    component.recurrence.set('Every day');
    component.add();
    tick();
    expect(habitsSvc.create).toHaveBeenCalledWith({
      meal_name: 'Oatmeal',
      slot: 'breakfast',
      recurrence_rule: 'FREQ=DAILY',
    });
  }));

  it('detects exact conflict (same slot + same RRULE)', fakeAsync(() => {
    habitsSvc.create.and.returnValue(of(mockHabit));
    // First add: Oatmeal, breakfast, every day
    component.mealName.set('Oatmeal');
    component.slot.set('breakfast');
    component.recurrence.set('Every day');
    component.add();
    tick();
    // habits() spy now returns the habit
    habitsData.set([mockHabit]);

    // Second attempt: same slot + recurrence = conflict
    component.mealName.set('Granola');
    component.slot.set('breakfast');
    component.recurrence.set('Every day');
    fixture.detectChanges();
    expect(component.conflictWarning()).toBeTruthy();
  }));

  it('save() updates state service and emits complete', fakeAsync(() => {
    let completed = false;
    component.complete.subscribe(() => completed = true);
    component.save();
    tick();
    expect(stateSvc.setMealHabits).toHaveBeenCalled();
    expect(completed).toBe(true);
  }));
});
