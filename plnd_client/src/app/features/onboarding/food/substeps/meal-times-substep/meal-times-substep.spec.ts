import { TestBed, fakeAsync, tick, ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { MealTimesSubstepComponent } from './meal-times-substep';
import { ConfigService } from '../../../../../core/services/config.service';

const mockConfig = { getConfig: () => ({ api: { baseUrl: 'http://api' } }) };

describe('MealTimesSubstepComponent', () => {
  let component: MealTimesSubstepComponent;
  let fixture: ComponentFixture<MealTimesSubstepComponent>;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MealTimesSubstepComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(MealTimesSubstepComponent);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  it('renders three meal slot cards', () => {
    const cards = fixture.nativeElement.querySelectorAll('.meal-slot-card');
    expect(cards.length).toBe(3);
    expect(cards[0].textContent).toContain('Breakfast');
    expect(cards[1].textContent).toContain('Lunch');
    expect(cards[2].textContent).toContain('Dinner');
  });

  it('save() PATCHes /preferences/me with all six window fields and emits complete', fakeAsync(() => {
    let completed = false;
    component.complete.subscribe(() => completed = true);

    component.breakfast.from.set('07:00');
    component.breakfast.to.set('09:00');
    component.lunch.from.set('12:00');
    component.lunch.to.set('13:30');
    component.dinner.from.set('18:00');
    component.dinner.to.set('20:00');

    component.save();
    const req = http.expectOne('http://api/preferences/me');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({
      breakfast_window_start: '07:00:00',
      breakfast_window_end: '09:00:00',
      lunch_window_start: '12:00:00',
      lunch_window_end: '13:30:00',
      dinner_window_start: '18:00:00',
      dinner_window_end: '20:00:00',
    });
    req.flush({});
    tick();
    expect(completed).toBe(true);
  }));

  it('save() sets saveError on HTTP failure', fakeAsync(() => {
    component.save();
    http.expectOne('http://api/preferences/me').error(new ProgressEvent('error'));
    tick();
    expect(component.saveError()).toBe(true);
  }));
});
