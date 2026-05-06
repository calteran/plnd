import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Signal, signal } from '@angular/core';
import { of } from 'rxjs';
import { MealTimesSubstepComponent } from './meal-times-substep';
import { MealPatternService } from '../../../../../core/services/meal-pattern.service';
import { MealPatternEntry } from '../../../../../core/models/meal-pattern';

const makeEntry = (id: string, name: string, sort_order: number): MealPatternEntry => ({
  id, name, preferred_time: '08:00:00', tolerance_minutes: 60,
  sort_order, user_id: 'u1', created_at: '',
});

interface MockMealPatternService {
  load: jasmine.Spy;
  entries: Signal<MealPatternEntry[]>;
  update: jasmine.Spy;
  create: jasmine.Spy;
  delete: jasmine.Spy;
}

describe('MealTimesSubstepComponent', () => {
  let fixture: ComponentFixture<MealTimesSubstepComponent>;
  let component: MealTimesSubstepComponent;
  let mockService: MockMealPatternService;

  beforeEach(async () => {
    const entriesSignal = signal<MealPatternEntry[]>([
      makeEntry('1', 'Breakfast', 1),
      makeEntry('2', 'Lunch', 2),
    ]);
    mockService = {
      load: jasmine.createSpy('load'),
      entries: entriesSignal.asReadonly(),
      update: jasmine.createSpy('update').and.returnValue(of(makeEntry('1', 'Breakfast', 1))),
      create: jasmine.createSpy('create').and.returnValue(of(makeEntry('3', 'Snack', 3))),
      delete: jasmine.createSpy('delete').and.returnValue(of(void 0)),
    };

    await TestBed.configureTestingModule({
      imports: [MealTimesSubstepComponent],
      providers: [{ provide: MealPatternService, useValue: mockService }],
    }).compileComponents();

    fixture = TestBed.createComponent(MealTimesSubstepComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('calls mealPatternService.load() on init', () => {
    expect(mockService.load).toHaveBeenCalled();
  });

  it('renders one card per pattern entry', () => {
    const cards = fixture.nativeElement.querySelectorAll('.meal-slot-card');
    expect(cards.length).toBe(2);
  });

  it('updateTime() calls update() with new preferred_time', () => {
    const entry = makeEntry('1', 'Breakfast', 1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (component as any).updateTime(entry, '09:00');
    expect(mockService.update).toHaveBeenCalledWith('1', { preferred_time: '09:00' });
  });

  it('addEntry() calls create() and resets form', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (component as any).newName.set('Snack');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (component as any).newTime.set('15:00');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (component as any).addEntry();
    expect(mockService.create).toHaveBeenCalledWith(
      jasmine.objectContaining({ name: 'Snack', preferred_time: '15:00' })
    );
  });

  it('removeEntry() calls delete()', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (component as any).removeEntry('2');
    expect(mockService.delete).toHaveBeenCalledWith('2');
  });

  it('save() emits complete', () => {
    const spy = jasmine.createSpy('complete');
    component.complete.subscribe(spy);
    component.save();
    expect(spy).toHaveBeenCalled();
  });
});
