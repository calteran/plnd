import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { OnboardingLoadingScreenComponent } from './onboarding-loading-screen';

describe('OnboardingLoadingScreenComponent', () => {
  let fixture: ComponentFixture<OnboardingLoadingScreenComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OnboardingLoadingScreenComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(OnboardingLoadingScreenComponent);
    fixture.componentRef.setInput('taskCount', 3);
    fixture.componentRef.setInput('routineCount', 2);
    fixture.componentRef.setInput('taskNames', ['Morning walk', 'Deep work']);
  });

  it('renders "Building your plan" heading', fakeAsync(() => {
    fixture.detectChanges();
    const h2: HTMLElement | null = fixture.nativeElement.querySelector('h2');
    expect(h2?.textContent?.trim()).toBe('Building your plan');
    tick(10000);
    fixture.destroy();
  }));

  it('renders subtitle', fakeAsync(() => {
    fixture.detectChanges();
    const subtitle: HTMLElement | null = fixture.nativeElement.querySelector('.subtitle');
    expect(subtitle?.textContent).toContain('This should only take a moment');
    tick(10000);
    fixture.destroy();
  }));

  it('shows typing indicator immediately after init', fakeAsync(() => {
    fixture.detectChanges();
    const typing: HTMLElement | null = fixture.nativeElement.querySelector('.typing-bubble');
    expect(typing).not.toBeNull();
    tick(10000);
    fixture.destroy();
  }));

  it('adds at least one message bubble after MAX_DELAY_MS', fakeAsync(() => {
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.bubble').length).toBe(0);
    tick(2500); // past MAX_DELAY_MS of 2400
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.bubble').length).toBeGreaterThan(0);
    tick(10000);
    fixture.destroy();
  }));

  it('never shows more than MAX_KEEP messages at once', fakeAsync(() => {
    fixture.detectChanges();
    // Each cycle takes at least MIN_DELAY (1100ms); run 20 cycles worth
    tick(1100 * 20);
    fixture.detectChanges();
    const bubbles = fixture.nativeElement.querySelectorAll('.bubble');
    expect(bubbles.length).toBeLessThanOrEqual(6); // MAX_KEEP = 6
    tick(10000);
    fixture.destroy();
  }));

  it('cleans up all timers on destroy — no pending timer errors', fakeAsync(() => {
    fixture.detectChanges();
    fixture.destroy();
    tick(10000); // no thrown errors means all timers were cleared
  }));
});
