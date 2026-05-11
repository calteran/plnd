import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SpokeChromeComponent } from './spoke-chrome';

describe('SpokeChromeComponent', () => {
  function setup(totalSteps: number, currentStep: number): ComponentFixture<SpokeChromeComponent> {
    const fixture = TestBed.createComponent(SpokeChromeComponent);
    fixture.componentRef.setInput('title', 'Test Section');
    fixture.componentRef.setInput('totalSteps', totalSteps);
    fixture.componentRef.setInput('currentStep', currentStep);
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

  it('shows "← Back" link in header', () => {
    const fixture = setup(3, 1);
    const link: HTMLAnchorElement = fixture.nativeElement.querySelector('.hub-link');
    expect(link?.textContent?.trim()).toBe('← Back');
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

  it('continue button is present by default (showContinue not set)', () => {
    const fixture = setup(3, 1);
    expect(fixture.nativeElement.querySelector('.btn-continue')).not.toBeNull();
  });

  it('hides continue button when showContinue is false', () => {
    const fixture = TestBed.createComponent(SpokeChromeComponent);
    fixture.componentRef.setInput('title', 'Test Section');
    fixture.componentRef.setInput('totalSteps', 3);
    fixture.componentRef.setInput('currentStep', 1);
    fixture.componentRef.setInput('showContinue', false);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.btn-continue')).toBeNull();
  });

  it('shows a right-side spacer when showContinue is false', () => {
    const fixture = TestBed.createComponent(SpokeChromeComponent);
    fixture.componentRef.setInput('title', 'Test Section');
    fixture.componentRef.setInput('totalSteps', 3);
    fixture.componentRef.setInput('currentStep', 1);
    fixture.componentRef.setInput('showContinue', false);
    fixture.detectChanges();
    const spacers = fixture.nativeElement.querySelectorAll('.footer-spacer');
    expect(spacers.length).toBe(2); // left spacer (step 1) + right spacer (no continue)
  });

  it('dots have no title attribute — accessibility comes from parent progressbar aria attrs', () => {
    const fixture = setup(3, 1);
    const dots: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll('.dot');
    dots.forEach(dot => {
      expect(dot.getAttribute('title')).toBeNull();
    });
  });

  it('progressbar has aria-label reflecting current step and total', () => {
    const fixture = setup(3, 2);
    const progressbar: HTMLElement = fixture.nativeElement.querySelector('.dot-row');
    expect(progressbar.getAttribute('aria-label')).toBe('Step 2 of 3');
  });

  it('disables continue button when continueDisabled is true', () => {
    const fixture = TestBed.createComponent(SpokeChromeComponent);
    fixture.componentRef.setInput('title', 'Test Section');
    fixture.componentRef.setInput('totalSteps', 3);
    fixture.componentRef.setInput('currentStep', 1);
    fixture.componentRef.setInput('continueDisabled', true);
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('.btn-continue');
    expect(btn.disabled).toBe(true);
    expect(btn.style.opacity).toBe('0.4');
    expect(btn.style.cursor).toBe('not-allowed');
  });

  it('enables continue button when continueDisabled is false (default)', () => {
    const fixture = setup(3, 1);
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('.btn-continue');
    expect(btn.disabled).toBe(false);
  });
});
