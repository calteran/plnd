import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import {
  MealPlanLoadingComponent,
  FOOD_INTERVAL_MS,
  TEXT_INTERVAL_MS,
  MODE_DURATION_MS,
  PARTICLE_LIFETIME_MS,
  STATIC_CAPTION_MS,
  STILL_WORKING_MS,
  STILL_WORKING_EXTENDED_MS,
  STILL_WORKING_TEXT,
  STILL_WORKING_EXTENDED_TEXT,
  PLAYFUL_TEXTS,
} from './meal-plan-loading';

const SLOTS_FIXTURE = [
  { day: '2026-05-18', slots: ['breakfast', 'lunch', 'dinner'] },
  { day: '2026-05-19', slots: ['breakfast', 'lunch', 'dinner'] },
];

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
  blockedNames?: string[];
  reducedMotion?: boolean;
} = {}): ComponentFixture<MealPlanLoadingComponent> {
  stubMatchMedia(opts.reducedMotion ?? false);

  TestBed.configureTestingModule({ imports: [MealPlanLoadingComponent] });
  const fixture = TestBed.createComponent(MealPlanLoadingComponent);
  fixture.componentRef.setInput('slotsByDay',  SLOTS_FIXTURE);
  fixture.componentRef.setInput('blockedNames', opts.blockedNames ?? []);
  return fixture;
}

function teardown(fixture: ComponentFixture<MealPlanLoadingComponent>): void {
  fixture.destroy();
  // Drain any pending timers so fakeAsync exits cleanly.
  tick(PARTICLE_LIFETIME_MS + 1000);
}

describe('MealPlanLoadingComponent', () => {
  it('renders the "Planning this week\'s meals" heading', fakeAsync(() => {
    const fixture = setUp();
    fixture.detectChanges();
    const h = fixture.nativeElement.querySelector('.heading') as HTMLElement | null;
    expect(h?.textContent?.trim()).toBe("Planning this week's meals");
    teardown(fixture);
  }));

  it('renders a Cancel button that emits the cancel output', fakeAsync(() => {
    const fixture = setUp();
    fixture.detectChanges();

    const emitted: void[] = [];
    fixture.componentInstance.cancelClick.subscribe(() => emitted.push(undefined));

    const btn = fixture.nativeElement.querySelector('.cancel-link') as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    btn!.click();
    expect(emitted.length).toBe(1);
    teardown(fixture);
  }));

  it('emits at least one food particle after FOOD_INTERVAL_MS', fakeAsync(() => {
    const fixture = setUp();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.particle.food, .drop-particle.food').length).toBe(0);

    tick(FOOD_INTERVAL_MS + 50);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.particle.food, .drop-particle.food').length).toBeGreaterThan(0);
    teardown(fixture);
  }));

  it('emits text particles and updates the aria-live region', fakeAsync(() => {
    const fixture = setUp();
    fixture.detectChanges();

    tick(TEXT_INTERVAL_MS + 50);
    fixture.detectChanges();

    const ariaRegion = fixture.nativeElement.querySelector('.aria-only') as HTMLElement | null;
    expect(ariaRegion?.textContent?.trim().length ?? 0).toBeGreaterThan(0);
    teardown(fixture);
  }));

  it('alternates mode between spiral and drop after MODE_DURATION_MS', fakeAsync(() => {
    const fixture = setUp();
    fixture.detectChanges();

    const stage = fixture.nativeElement.querySelector('.stage') as HTMLElement;
    expect(stage.getAttribute('data-mode')).toBe('spiral');

    tick(MODE_DURATION_MS + 50);
    fixture.detectChanges();
    expect(stage.getAttribute('data-mode')).toBe('drop');

    tick(MODE_DURATION_MS + 50);
    fixture.detectChanges();
    expect(stage.getAttribute('data-mode')).toBe('spiral');

    teardown(fixture);
  }));

  describe('drop-mode coordinates', () => {
    it('emits drop particles with left% in the 40-60 safe zone', fakeAsync(() => {
      const fixture = setUp();
      fixture.detectChanges();

      // Switch to drop mode and emit several particles.
      tick(MODE_DURATION_MS + 50);
      fixture.detectChanges();
      tick(FOOD_INTERVAL_MS * 5);
      fixture.detectChanges();

      const dropFood = fixture.nativeElement.querySelectorAll('.drop-particle.food') as NodeListOf<HTMLElement>;
      expect(dropFood.length).toBeGreaterThan(0);

      for (const el of Array.from(dropFood)) {
        const leftPct = parseFloat(el.style.left.replace('%', ''));
        expect(leftPct).toBeGreaterThanOrEqual(40);
        expect(leftPct).toBeLessThanOrEqual(60);
      }

      teardown(fixture);
    }));

    it('attaches a --start-x px offset to each drop particle for the curved path', fakeAsync(() => {
      const fixture = setUp();
      fixture.detectChanges();

      tick(MODE_DURATION_MS + 50);
      fixture.detectChanges();
      tick(FOOD_INTERVAL_MS * 3);
      fixture.detectChanges();

      const dropParticle = fixture.nativeElement.querySelector('.drop-particle.food') as HTMLElement | null;
      expect(dropParticle).not.toBeNull();

      // --start-x is set inline as a px length (positive or negative).
      const startX = dropParticle!.style.getPropertyValue('--start-x').trim();
      expect(startX).toMatch(/^-?\d+(\.\d+)?px$/);

      teardown(fixture);
    }));

    it('does not attach drop-coords to spiral-mode particles', fakeAsync(() => {
      const fixture = setUp();
      fixture.detectChanges();
      tick(FOOD_INTERVAL_MS + 50);
      fixture.detectChanges();

      const spiralFood = fixture.nativeElement.querySelector('.particle.food') as HTMLElement | null;
      expect(spiralFood).not.toBeNull();
      // Spiral particles use --angle, not --start-x or left%.
      expect(spiralFood!.style.getPropertyValue('--start-x').trim()).toBe('');
      expect(spiralFood!.style.left).toBe('');

      teardown(fixture);
    }));
  });

  it('removes particles after PARTICLE_LIFETIME_MS', fakeAsync(() => {
    const fixture = setUp();
    fixture.detectChanges();

    tick(FOOD_INTERVAL_MS + 50);
    fixture.detectChanges();
    const beforeCount = fixture.nativeElement.querySelectorAll('.particle, .drop-particle').length;
    expect(beforeCount).toBeGreaterThan(0);

    // Advance past lifetime — older particles should be gone, but new ones may have arrived.
    // The key invariant: count never grows unbounded.
    tick(PARTICLE_LIFETIME_MS * 2);
    fixture.detectChanges();
    const afterCount = fixture.nativeElement.querySelectorAll('.particle, .drop-particle').length;
    // MAX_PARTICLES is 16; we should always be bounded well below the unbounded growth.
    expect(afterCount).toBeLessThanOrEqual(20);

    teardown(fixture);
  }));

  describe('blocked-items personalization', () => {
    it('emits "Avoiding {name}" text-particles when blockedNames is non-empty', fakeAsync(() => {
      const fixture = setUp({ blockedNames: ['mushrooms', 'cilantro'] });
      fixture.detectChanges();

      const seen: string[] = [];
      // Run several text-particle cycles to give the random pick a chance to land on blocked.
      for (let i = 0; i < 30; i++) {
        tick(TEXT_INTERVAL_MS + 5);
        fixture.detectChanges();
        const aria = fixture.nativeElement.querySelector('.aria-only') as HTMLElement | null;
        const text = aria?.textContent?.trim() ?? '';
        if (text) seen.push(text);
      }
      const sawBlocked = seen.some(t => /mushrooms|cilantro/.test(t));
      expect(sawBlocked).toBe(true);

      teardown(fixture);
    }));

    it('never emits a blocked-items text-particle when blockedNames is empty', fakeAsync(() => {
      const fixture = setUp({ blockedNames: [] });
      fixture.detectChanges();

      const seen: string[] = [];
      for (let i = 0; i < 30; i++) {
        tick(TEXT_INTERVAL_MS + 5);
        fixture.detectChanges();
        const aria = fixture.nativeElement.querySelector('.aria-only') as HTMLElement | null;
        const text = aria?.textContent?.trim() ?? '';
        if (text) seen.push(text);
      }
      const anyBlocked = seen.some(t => /Avoiding |Skipping /.test(t));
      expect(anyBlocked).toBe(false);

      teardown(fixture);
    }));
  });

  describe('prefers-reduced-motion', () => {
    it('renders the static fallback when reduced-motion is preferred', fakeAsync(() => {
      const fixture = setUp({ reducedMotion: true });
      fixture.detectChanges();

      // No animated stage; static stage with rotating caption is present.
      expect(fixture.nativeElement.querySelector('.stage')).toBeNull();
      expect(fixture.nativeElement.querySelector('.static-stage')).not.toBeNull();
      const caption = fixture.nativeElement.querySelector('.static-caption') as HTMLElement | null;
      expect(caption).not.toBeNull();
      expect(caption!.getAttribute('aria-live')).toBe('polite');
      expect(caption!.textContent?.trim().length).toBeGreaterThan(0);

      teardown(fixture);
    }));

    it('rotates the static caption every STATIC_CAPTION_MS', fakeAsync(() => {
      const fixture = setUp({ reducedMotion: true });
      fixture.detectChanges();
      const caption = fixture.nativeElement.querySelector('.static-caption') as HTMLElement;

      const seen = new Set<string>();
      seen.add(caption.textContent?.trim() ?? '');
      // Run several rotation intervals — at least one new caption should land.
      for (let i = 0; i < 20; i++) {
        tick(STATIC_CAPTION_MS + 5);
        fixture.detectChanges();
        seen.add(caption.textContent?.trim() ?? '');
      }
      expect(seen.size).toBeGreaterThan(1);

      teardown(fixture);
    }));

    it('does not start food/text/mode timers in reduced-motion mode', fakeAsync(() => {
      const fixture = setUp({ reducedMotion: true });
      fixture.detectChanges();

      tick(MODE_DURATION_MS * 2);
      fixture.detectChanges();
      // No stage, no particles ever rendered.
      expect(fixture.nativeElement.querySelectorAll('.particle, .drop-particle').length).toBe(0);

      teardown(fixture);
    }));
  });

  describe('still-working reassurance', () => {
    it('shows no reassurance message before STILL_WORKING_MS', fakeAsync(() => {
      const fixture = setUp();
      fixture.detectChanges();

      tick(STILL_WORKING_MS - 1000);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.reassurance')).toBeNull();

      teardown(fixture);
    }));

    it('shows the tier-1 reassurance message after STILL_WORKING_MS', fakeAsync(() => {
      const fixture = setUp();
      fixture.detectChanges();

      tick(STILL_WORKING_MS + 50);
      fixture.detectChanges();
      const msg = fixture.nativeElement.querySelector('.reassurance') as HTMLElement | null;
      expect(msg).not.toBeNull();
      expect(msg!.textContent?.trim()).toBe(STILL_WORKING_TEXT);
      expect(msg!.getAttribute('aria-live')).toBe('polite');

      teardown(fixture);
    }));

    it('escalates to the tier-2 message after STILL_WORKING_EXTENDED_MS', fakeAsync(() => {
      const fixture = setUp();
      fixture.detectChanges();

      tick(STILL_WORKING_EXTENDED_MS + 50);
      fixture.detectChanges();
      const msg = fixture.nativeElement.querySelector('.reassurance') as HTMLElement | null;
      expect(msg?.textContent?.trim()).toBe(STILL_WORKING_EXTENDED_TEXT);

      teardown(fixture);
    }));

    it('shows the reassurance message in reduced-motion mode too', fakeAsync(() => {
      const fixture = setUp({ reducedMotion: true });
      fixture.detectChanges();

      tick(STILL_WORKING_MS + 50);
      fixture.detectChanges();
      const msg = fixture.nativeElement.querySelector('.reassurance') as HTMLElement | null;
      expect(msg?.textContent?.trim()).toBe(STILL_WORKING_TEXT);

      teardown(fixture);
    }));
  });

  it('cleans up all timers on destroy — no leaked timer warnings', fakeAsync(() => {
    const fixture = setUp();
    fixture.detectChanges();
    tick(FOOD_INTERVAL_MS + 50);
    fixture.destroy();
    tick(MODE_DURATION_MS * 3); // no errors means timers were cleared
    expect(true).toBe(true);    // explicit assertion to satisfy Jasmine spec-no-expectations check
  }));

  it('exposes its constants for tunability', () => {
    expect(FOOD_INTERVAL_MS).toBeGreaterThan(0);
    expect(TEXT_INTERVAL_MS).toBeGreaterThan(0);
    expect(MODE_DURATION_MS).toBeGreaterThan(0);
    expect(PARTICLE_LIFETIME_MS).toBeGreaterThan(0);
    expect(PLAYFUL_TEXTS.length).toBeGreaterThan(3);
  });
});
