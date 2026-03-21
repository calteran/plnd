import { TestBed, ComponentFixture } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { Router } from '@angular/router';
import { NotFoundComponent } from './not-found';

describe('NotFoundComponent', () => {
  let fixture: ComponentFixture<NotFoundComponent>;
  let component: NotFoundComponent;
  let router: Router;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NotFoundComponent, RouterTestingModule]
    }).compileComponents();

    fixture = TestBed.createComponent(NotFoundComponent);
    component = fixture.componentInstance;
    router = TestBed.inject(Router);
    fixture.detectChanges();
  });

  it('should create the component', () => {
    expect(component).toBeTruthy();
  });

  it('should display "Page not found" heading', () => {
    const h1: HTMLElement = fixture.nativeElement.querySelector('h1');
    expect(h1).not.toBeNull();
    expect(h1.textContent).toContain('Page not found');
  });

  it('should render a "Go to today" button', () => {
    const button: HTMLButtonElement = fixture.nativeElement.querySelector('button');
    expect(button).not.toBeNull();
    expect(button.textContent).toContain('Go to today');
  });

  it('goToToday() navigates to /today', () => {
    const navigateSpy = spyOn(router, 'navigate');
    component.goToToday();
    expect(navigateSpy).toHaveBeenCalledWith(['/today']);
  });

  it('clicking the button calls goToToday()', () => {
    const navigateSpy = spyOn(router, 'navigate');
    const button: HTMLButtonElement = fixture.nativeElement.querySelector('button');
    button.click();
    expect(navigateSpy).toHaveBeenCalledWith(['/today']);
  });
});
