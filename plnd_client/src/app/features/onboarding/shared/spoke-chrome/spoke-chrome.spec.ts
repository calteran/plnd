import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SpokeChromeComponent } from './spoke-chrome';

describe('SpokeChromeComponent', () => {
  function setup(totalSteps: number, currentStep: number): ComponentFixture<SpokeChromeComponent> {
    const fixture = TestBed.createComponent(SpokeChromeComponent);
    fixture.componentInstance.title = 'Test Section';
    fixture.componentInstance.totalSteps = totalSteps;
    fixture.componentInstance.currentStep = currentStep;
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SpokeChromeComponent],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('should create', () => {
    const fixture = setup(3, 1);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('shows "← Hub" link in header', () => {
    const fixture = setup(3, 1);
    const link: HTMLAnchorElement = fixture.nativeElement.querySelector('.hub-link');
    expect(link?.textContent?.trim()).toBe('← Hub');
  });

  it('displays the section title', () => {
    const fixture = setup(3, 1);
    const title: HTMLElement = fixture.nativeElement.querySelector('.spoke-title');
    expect(title?.textContent?.trim()).toBe('Test Section');
  });

  it('renders correct number of dots', () => {
    const fixture = setup(4, 1);
    const dots = fixture.nativeElement.querySelectorAll('.dot');
    expect(dots.length).toBe(4);
  });

  it('first dot has dot--current class on step 1', () => {
    const fixture = setup(3, 1);
    const dots = fixture.nativeElement.querySelectorAll('.dot');
    expect(dots[0].classList).toContain('dot--current');
    expect(dots[0].classList).not.toContain('dot--completed');
  });

  it('remaining dots are plain (ahead) on step 1', () => {
    const fixture = setup(3, 1);
    const dots = fixture.nativeElement.querySelectorAll('.dot');
    expect(dots[1].classList).not.toContain('dot--current');
    expect(dots[1].classList).not.toContain('dot--completed');
    expect(dots[2].classList).not.toContain('dot--current');
    expect(dots[2].classList).not.toContain('dot--completed');
  });

  it('first dot is completed and second is current on step 2', () => {
    const fixture = setup(3, 2);
    const dots = fixture.nativeElement.querySelectorAll('.dot');
    expect(dots[0].classList).toContain('dot--completed');
    expect(dots[1].classList).toContain('dot--current');
    expect(dots[2].classList).not.toContain('dot--current');
    expect(dots[2].classList).not.toContain('dot--completed');
  });

  it('all dots completed except last on final step', () => {
    const fixture = setup(3, 3);
    const dots = fixture.nativeElement.querySelectorAll('.dot');
    expect(dots[0].classList).toContain('dot--completed');
    expect(dots[1].classList).toContain('dot--completed');
    expect(dots[2].classList).toContain('dot--current');
  });

  it('hides back button on step 1', () => {
    const fixture = setup(3, 1);
    const backBtn = fixture.nativeElement.querySelector('.btn-back');
    expect(backBtn).toBeNull();
  });

  it('shows back button on step 2', () => {
    const fixture = setup(3, 2);
    const backBtn = fixture.nativeElement.querySelector('.btn-back');
    expect(backBtn).not.toBeNull();
  });

  it('emits backClick when back button clicked', () => {
    const fixture = setup(3, 2);
    const spy = jasmine.createSpy('backClick');
    fixture.componentInstance.backClick.subscribe(spy);
    fixture.nativeElement.querySelector('.btn-back').click();
    expect(spy).toHaveBeenCalledOnceWith(undefined);
  });

  it('emits continueClick when continue button clicked', () => {
    const fixture = setup(3, 1);
    const spy = jasmine.createSpy('continueClick');
    fixture.componentInstance.continueClick.subscribe(spy);
    fixture.nativeElement.querySelector('.btn-continue').click();
    expect(spy).toHaveBeenCalledOnceWith(undefined);
  });

  it('continue button is always present', () => {
    const fixture = setup(3, 1);
    expect(fixture.nativeElement.querySelector('.btn-continue')).not.toBeNull();
  });

  it('dots each have a title attribute', () => {
    const fixture = setup(3, 1);
    const dots: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll('.dot');
    dots.forEach((dot, i) => {
      expect(dot.getAttribute('title')).toBe(`Step ${i + 1}`);
    });
  });

  it('progressbar has aria-label reflecting current step and total', () => {
    const fixture = setup(3, 2);
    const progressbar: HTMLElement = fixture.nativeElement.querySelector('.dot-row');
    expect(progressbar.getAttribute('aria-label')).toBe('Step 2 of 3');
  });
});
