import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import {
  OnboardingTaskLoadingComponent,
  MAX_KEEP,
  MAX_DELAY_MS,
  MIN_DELAY_MS,
} from './onboarding-task-loading';

let _originalMatchMedia: typeof window.matchMedia | undefined;

function stubMatchMedia(prefersReduce: boolean): void {
  if (_originalMatchMedia === undefined) {
    _originalMatchMedia = window.matchMedia;
  }
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: ((q: string) => ({
      matches: prefersReduce && q.includes('prefers-reduced-motion'),
      media: q,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    })) as typeof window.matchMedia,
  });
}

afterEach(() => {
  if (_originalMatchMedia !== undefined) {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: _originalMatchMedia,
    });
  }
});

function setUp(opts: {
  taskCount?: number;
  routineCount?: number;
  taskNames?: string[];
  reducedMotion?: boolean;
} = {}): ComponentFixture<OnboardingTaskLoadingComponent> {
  stubMatchMedia(opts.reducedMotion ?? false);

  TestBed.configureTestingModule({ imports: [OnboardingTaskLoadingComponent] });
  const fixture = TestBed.createComponent(OnboardingTaskLoadingComponent);
  fixture.componentRef.setInput('taskCount',    opts.taskCount    ?? 3);
  fixture.componentRef.setInput('routineCount', opts.routineCount ?? 2);
  fixture.componentRef.setInput('taskNames',    opts.taskNames    ?? ['Morning walk', 'Deep work']);
  return fixture;
}

function teardown(fixture: ComponentFixture<OnboardingTaskLoadingComponent>): void {
  fixture.destroy();
  tick(10000); // drain any pending timers so fakeAsync exits cleanly
}

describe('OnboardingTaskLoadingComponent', () => {
  it('renders "Building your plan" heading', fakeAsync(() => {
    const fixture = setUp();
    fixture.detectChanges();
    const h2: HTMLElement | null = fixture.nativeElement.querySelector('h2');
    expect(h2?.textContent?.trim()).toBe('Building your plan');
    teardown(fixture);
  }));

  it('renders subtitle', fakeAsync(() => {
    const fixture = setUp();
    fixture.detectChanges();
    const subtitle: HTMLElement | null = fixture.nativeElement.querySelector('.subtitle');
    expect(subtitle?.textContent).toContain('This should only take a moment');
    teardown(fixture);
  }));

  it('shows typing indicator immediately after init', fakeAsync(() => {
    const fixture = setUp();
    fixture.detectChanges();
    const typing: HTMLElement | null = fixture.nativeElement.querySelector('.typing-bubble');
    expect(typing).not.toBeNull();
    teardown(fixture);
  }));

  it('adds at least one message bubble after MAX_DELAY_MS', fakeAsync(() => {
    const fixture = setUp();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.bubble').length).toBe(0);
    tick(MAX_DELAY_MS + 100); // past MAX_DELAY_MS
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.bubble').length).toBeGreaterThan(0);
    teardown(fixture);
  }));

  it('never shows more than MAX_KEEP messages at once', fakeAsync(() => {
    const fixture = setUp();
    fixture.detectChanges();
    // Each cycle takes at least MIN_DELAY_MS; run 20 cycles worth
    tick(MIN_DELAY_MS * 20);
    fixture.detectChanges();
    const bubbles = fixture.nativeElement.querySelectorAll('.bubble');
    expect(bubbles.length).toBeLessThanOrEqual(MAX_KEEP);
    teardown(fixture);
  }));

  it('cleans up all timers on destroy — no pending timer errors', fakeAsync(() => {
    const fixture = setUp();
    fixture.detectChanges();
    teardown(fixture); // no thrown errors means all timers were cleared
  }));

  it('hides the typing-bubble when prefers-reduced-motion is reduce', fakeAsync(() => {
    const fixture = setUp({ reducedMotion: true });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.typing-bubble')).toBeNull();
    teardown(fixture);
  }));
});
