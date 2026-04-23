import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { OnboardingHubComponent } from './onboarding-hub';
import { OnboardingStateService, SectionId } from '../onboarding-state.service';

function makeStateMock() {
  const statusSignal = signal<Record<SectionId, 'not-started' | 'complete'>>({
    account: 'not-started',
    tasks: 'not-started',
    food: 'not-started',
  });
  const allCompleteSignal = signal(false);

  return {
    sectionStatus: statusSignal.asReadonly(),
    allSectionsComplete: allCompleteSignal.asReadonly(),
    markComplete: jasmine.createSpy('markComplete').and.callFake((s: SectionId) => {
      statusSignal.update(prev => ({ ...prev, [s]: 'complete' }));
      if (Object.values(statusSignal()).every(v => v === 'complete')) {
        allCompleteSignal.set(true);
      }
    }),
  };
}

describe('OnboardingHubComponent', () => {
  let fixture: ComponentFixture<OnboardingHubComponent>;
  let stateMock: ReturnType<typeof makeStateMock>;
  let router: Router;

  beforeEach(async () => {
    stateMock = makeStateMock();
    await TestBed.configureTestingModule({
      imports: [OnboardingHubComponent],
      providers: [
        { provide: OnboardingStateService, useValue: stateMock },
        provideRouter([]),
      ],
    }).compileComponents();

    router = TestBed.inject(Router);
    fixture = TestBed.createComponent(OnboardingHubComponent);
    fixture.detectChanges();
  });

  // ── Structural ──────────────────────────────────────────────────────────────

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('renders 4 section cards', () => {
    const cards = fixture.nativeElement.querySelectorAll('.section-card');
    expect(cards.length).toBe(4);
  });

  it('Exercise card (index 3) has disabled attribute', () => {
    const cards: NodeListOf<HTMLButtonElement> =
      fixture.nativeElement.querySelectorAll('.section-card');
    expect(cards[3].disabled).toBeTrue();
  });

  it('Exercise card has aria-disabled="true"', () => {
    const cards: NodeListOf<HTMLButtonElement> =
      fixture.nativeElement.querySelectorAll('.section-card');
    expect(cards[3].getAttribute('aria-disabled')).toBe('true');
  });

  it('active section cards (0–2) are not disabled', () => {
    const cards: NodeListOf<HTMLButtonElement> =
      fixture.nativeElement.querySelectorAll('.section-card');
    for (let i = 0; i < 3; i++) {
      expect(cards[i].disabled).toBeFalse();
    }
  });

  it('renders all 4 section titles', () => {
    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain('Account');
    expect(text).toContain('Tasks & Routines');
    expect(text).toContain('Food & Meals');
    expect(text).toContain('Exercise');
  });

  // ── Badge initial state ─────────────────────────────────────────────────────

  it('active section badges initially have badge--muted class', () => {
    const badges: NodeListOf<HTMLElement> =
      fixture.nativeElement.querySelectorAll('.card-badge');
    for (let i = 0; i < 3; i++) {
      expect(badges[i].classList).toContain('badge--muted');
      expect(badges[i].classList).not.toContain('badge--done');
    }
  });

  it('active section badges initially show "not started" text', () => {
    const badges: NodeListOf<HTMLElement> =
      fixture.nativeElement.querySelectorAll('.card-badge');
    for (let i = 0; i < 3; i++) {
      expect(badges[i].textContent?.trim().toLowerCase()).toContain('not started');
    }
  });

  it('Exercise badge shows "coming soon"', () => {
    const badges: NodeListOf<HTMLElement> =
      fixture.nativeElement.querySelectorAll('.card-badge');
    expect(badges[3].textContent?.trim().toLowerCase()).toContain('coming soon');
  });

  it('Exercise badge has badge--disabled class, not badge--muted', () => {
    const badges: NodeListOf<HTMLElement> =
      fixture.nativeElement.querySelectorAll('.card-badge');
    expect(badges[3].classList).toContain('badge--disabled');
    expect(badges[3].classList).not.toContain('badge--muted');
    expect(badges[3].classList).not.toContain('badge--done');
  });

  // ── Badge reactive updates ──────────────────────────────────────────────────

  it('account badge shows ✓ done after markComplete("account")', () => {
    stateMock.markComplete('account');
    fixture.detectChanges();
    const badges: NodeListOf<HTMLElement> =
      fixture.nativeElement.querySelectorAll('.card-badge');
    expect(badges[0].classList).toContain('badge--done');
    expect(badges[0].classList).not.toContain('badge--muted');
    expect(badges[0].textContent?.trim().toLowerCase()).toContain('done');
  });

  it('tasks badge shows ✓ done after markComplete("tasks")', () => {
    stateMock.markComplete('tasks');
    fixture.detectChanges();
    const badges: NodeListOf<HTMLElement> =
      fixture.nativeElement.querySelectorAll('.card-badge');
    expect(badges[1].classList).toContain('badge--done');
  });

  it('food badge shows ✓ done after markComplete("food")', () => {
    stateMock.markComplete('food');
    fixture.detectChanges();
    const badges: NodeListOf<HTMLElement> =
      fixture.nativeElement.querySelectorAll('.card-badge');
    expect(badges[2].classList).toContain('badge--done');
  });

  it('completing a section adds section-card--done class to that card', () => {
    stateMock.markComplete('account');
    fixture.detectChanges();
    const cards: NodeListOf<HTMLElement> =
      fixture.nativeElement.querySelectorAll('.section-card');
    expect(cards[0].classList).toContain('section-card--done');
    expect(cards[1].classList).not.toContain('section-card--done');
  });

  // ── CTA button state ────────────────────────────────────────────────────────

  it('CTA has btn--ghost style when 0 sections are complete', () => {
    const btn: HTMLButtonElement = fixture.nativeElement.querySelector('.btn-cta');
    expect(btn.classList).toContain('btn--ghost');
    expect(btn.classList).not.toContain('btn--accent');
  });

  it('CTA stays ghost when only 2 of 3 sections are complete', () => {
    stateMock.markComplete('account');
    stateMock.markComplete('tasks');
    fixture.detectChanges();
    const btn: HTMLButtonElement = fixture.nativeElement.querySelector('.btn-cta');
    expect(btn.classList).toContain('btn--ghost');
    expect(btn.classList).not.toContain('btn--accent');
  });

  it('CTA becomes btn--accent when all 3 sections are complete', () => {
    (['account', 'tasks', 'food'] as SectionId[]).forEach(s => stateMock.markComplete(s));
    fixture.detectChanges();
    const btn: HTMLButtonElement = fixture.nativeElement.querySelector('.btn-cta');
    expect(btn.classList).toContain('btn--accent');
    expect(btn.classList).not.toContain('btn--ghost');
  });

  // ── Navigation ──────────────────────────────────────────────────────────────

  it('clicking Account card navigates to /onboarding/account', () => {
    spyOn(router, 'navigate');
    const cards: NodeListOf<HTMLButtonElement> =
      fixture.nativeElement.querySelectorAll('.section-card');
    cards[0].click();
    expect(router.navigate).toHaveBeenCalledWith(['/onboarding/account']);
  });

  it('clicking Tasks card navigates to /onboarding/tasks', () => {
    spyOn(router, 'navigate');
    const cards: NodeListOf<HTMLButtonElement> =
      fixture.nativeElement.querySelectorAll('.section-card');
    cards[1].click();
    expect(router.navigate).toHaveBeenCalledWith(['/onboarding/tasks']);
  });

  it('clicking Food card navigates to /onboarding/food', () => {
    spyOn(router, 'navigate');
    const cards: NodeListOf<HTMLButtonElement> =
      fixture.nativeElement.querySelectorAll('.section-card');
    cards[2].click();
    expect(router.navigate).toHaveBeenCalledWith(['/onboarding/food']);
  });

  it('navigate() guard: disabled section does not call router.navigate', () => {
    spyOn(router, 'navigate');
    fixture.componentInstance.navigate({
      id: 'exercise', icon: '🏃', title: 'Exercise',
      description: '', route: '', disabled: true,
    });
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('clicking CTA navigates to /onboarding/review', () => {
    spyOn(router, 'navigate');
    const btn: HTMLButtonElement = fixture.nativeElement.querySelector('.btn-cta');
    btn.click();
    expect(router.navigate).toHaveBeenCalledWith(['/onboarding/review']);
  });

  // ── Footer note ─────────────────────────────────────────────────────────────

  it('renders the "weekly planning wizard" footer note', () => {
    const note: HTMLElement = fixture.nativeElement.querySelector('.hub-note');
    expect(note?.textContent).toContain('weekly planning wizard');
  });
});
