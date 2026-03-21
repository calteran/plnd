import { TestBed, ComponentFixture } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { NotFoundComponent } from './not-found';

describe('NotFoundComponent', () => {
  let fixture: ComponentFixture<NotFoundComponent>;
  let component: NotFoundComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NotFoundComponent, RouterTestingModule]
    }).compileComponents();

    fixture = TestBed.createComponent(NotFoundComponent);
    component = fixture.componentInstance;
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

  it('should render a "Go to today" link', () => {
    const link: HTMLAnchorElement = fixture.nativeElement.querySelector('a.btn');
    expect(link).not.toBeNull();
    expect(link.textContent).toContain('Go to today');
  });

  it('should link to /today via routerLink', () => {
    const link: HTMLAnchorElement = fixture.nativeElement.querySelector('a.btn');
    expect(link.getAttribute('href')).toBe('/today');
  });
});
