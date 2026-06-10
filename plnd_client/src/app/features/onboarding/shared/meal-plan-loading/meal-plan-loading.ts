import {
  Component,
  OnDestroy,
  OnInit,
  computed,
  input,
  output,
  signal,
} from '@angular/core';

import { detectReducedMotion } from '../../../../core/utils/browser-utils';

export type StageMode = 'spiral' | 'drop';

interface Particle {
  id: number;
  kind: 'food' | 'text';
  text: string;
  angle: number;        // perimeter entry angle (deg) — spiral mode only
  startX?: number;      // drop mode: starting horizontal % [5, 95]
  targetX?: number;     // drop mode: landing horizontal % [40, 60]
  delayMs: number;      // animation delay so staggered particles look natural
}

export interface SlotsForDay {
  day: string;          // ISO date string
  slots: string[];      // e.g. ['breakfast', 'lunch', 'dinner']
}

export const FOOD_EMOJI = ['🥕', '🥦', '🍅', '🥑', '🌿', '🥚', '🐟', '🥖'];

export const PLAYFUL_TEXTS = [
  'Reticulating splines…',
  'Consulting the spice rack…',
  'Balancing variety…',
  'Looking for high-protein options…',
  'Untangling your week…',
  'Mixing your week of meals…',
  'Stirring up the menu…',
  'Negotiating with Tuesday…',
];

// Generation cadence — each tick emits one particle of the given kind.
export const FOOD_INTERVAL_MS     = 800;
export const TEXT_INTERVAL_MS     = 1100;
export const PARTICLE_LIFETIME_MS = 6000;
export const MODE_DURATION_MS     = 10_000;
export const STATIC_CAPTION_MS    = 4000;
export const MAX_PARTICLES        = 16;

// Reassurance cues for long rate-limit backoffs (#872). A 429-throttled week
// generation can stay in flight far longer than usual; these gentle, non-alarming
// notes confirm the wizard hasn't stalled. Calm tone — no spinners, no error styling.
export const STILL_WORKING_MS          = 30_000;
export const STILL_WORKING_EXTENDED_MS = 90_000;
export const STILL_WORKING_TEXT          = 'Still working on your week…';
export const STILL_WORKING_EXTENDED_TEXT =
  "Thanks for hanging in there — this one's taking a little longer than usual.";

// Stage width in px — used to convert drop-mode startX/targetX from % to px
// offsets for the dropAndDrift keyframe's translateX. Matches .stage width.
export const STAGE_WIDTH_PX       = 360;

const PERIMETER_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315];

function dayLabel(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString('en-US', { weekday: 'long' });
}

@Component({
  selector: 'app-meal-plan-loading',
  standalone: true,
  template: `
    <div class="loader">
      <p class="heading">Planning this week's meals</p>

      @if (reducedMotion()) {
        <!-- Static fallback: bowl shape only (no animated ingredients) + rotating caption -->
        <div class="static-stage">
          <div class="bowl-base">
            <svg width="140" height="140" viewBox="0 0 120 120" aria-hidden="true">
              <g transform="translate(60 60) scale(1 0.906) translate(-60 -60)">
                <circle cx="60" cy="60" r="54" fill="#7c2d12"/>
                <circle cx="60" cy="60" r="50" fill="#b45309"/>
                <circle cx="60" cy="60" r="44" fill="#ecfccb"/>
                <path d="M 16 60 A 44 44 0 0 0 104 60 L 104 66 A 44 44 0 0 1 16 66 Z" fill="#365314" opacity="0.14"/>
              </g>
            </svg>
          </div>
        </div>
        <p class="static-caption" role="status" aria-live="polite" aria-label="Planning progress">
          {{ staticCaption() }}
        </p>
      } @else {
        <div class="stage" [attr.data-mode]="mode()">
          <div class="bowl-base">
            <!-- Steam wisps rising above the bowl -->
            <svg class="steam s1" viewBox="0 0 14 26" aria-hidden="true">
              <path d="M7 24 C 1 18, 13 12, 7 7 C 3 3, 11 1, 7 0"/>
            </svg>
            <svg class="steam s2" viewBox="0 0 14 26" aria-hidden="true">
              <path d="M7 24 C 1 18, 13 12, 7 7 C 3 3, 11 1, 7 0"/>
            </svg>
            <svg class="steam s3" viewBox="0 0 14 26" aria-hidden="true">
              <path d="M7 24 C 1 18, 13 12, 7 7 C 3 3, 11 1, 7 0"/>
            </svg>

            <!-- Bowl + swirling ingredients -->
            <svg width="140" height="140" viewBox="0 0 120 120" aria-hidden="true">
              <g transform="translate(60 60) scale(1 0.906) translate(-60 -60)">
                <!-- Structure: exterior → rim band → contents → crescent shadow -->
                <circle cx="60" cy="60" r="54" fill="#7c2d12"/>
                <circle cx="60" cy="60" r="50" fill="#b45309"/>
                <circle cx="60" cy="60" r="44" fill="#ecfccb"/>
                <path d="M 16 60 A 44 44 0 0 0 104 60 L 104 66 A 44 44 0 0 1 16 66 Z" fill="#365314" opacity="0.14"/>

                <!-- Carrots (3, 13s cycle) -->
                <rect class="ing" x="58" y="58" width="10" height="3.5" rx="1.5" fill="#ea580c" style="--start: 10deg; --dur: 13s; --del: 0s;"/>
                <rect class="ing" x="58" y="58" width="9"  height="3.5" rx="1.5" fill="#ea580c" style="--start: 130deg; --dur: 13s; --del: -4.3s;"/>
                <rect class="ing" x="58" y="58" width="8"  height="3.5" rx="1.5" fill="#ea580c" style="--start: 250deg; --dur: 13s; --del: -8.6s;"/>

                <!-- Peas (4, 11s cycle) -->
                <circle class="ing" cx="60" cy="60" r="2.8" fill="#65a30d" style="--start: 45deg; --dur: 11s; --del: 0s;"/>
                <circle class="ing" cx="60" cy="60" r="2.8" fill="#65a30d" style="--start: 135deg; --dur: 11s; --del: -2.7s;"/>
                <circle class="ing" cx="60" cy="60" r="2.8" fill="#65a30d" style="--start: 225deg; --dur: 11s; --del: -5.5s;"/>
                <circle class="ing" cx="60" cy="60" r="2.5" fill="#65a30d" style="--start: 315deg; --dur: 11s; --del: -8.2s;"/>

                <!-- Noodle squiggles (2, 16s cycle) -->
                <path class="ing" d="M 60 60 q 6 -4 12 0 t 12 0" stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round" opacity="0.85" style="--start: 75deg; --dur: 16s; --del: 0s;"/>
                <path class="ing" d="M 60 60 q 6 -4 12 0 t 12 0" stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round" opacity="0.7"  style="--start: 255deg; --dur: 16s; --del: -8s;"/>

                <!-- Herb specks (3, 9s cycle) -->
                <circle class="ing" cx="60" cy="60" r="1.4" fill="#15803d" style="--start: 90deg; --dur: 9s; --del: 0s;"/>
                <circle class="ing" cx="60" cy="60" r="1.4" fill="#15803d" style="--start: 210deg; --dur: 9s; --del: -3s;"/>
                <circle class="ing" cx="60" cy="60" r="1.4" fill="#15803d" style="--start: 330deg; --dur: 9s; --del: -6s;"/>
              </g>
            </svg>
          </div>

          <!-- Spiral particles (orbit the bowl from the perimeter) -->
          @for (p of spiralParticles(); track p.id) {
            <span
              [class]="p.kind === 'food' ? 'particle food' : 'particle text'"
              [style.--angle.deg]="p.angle"
              [style.animation-delay.ms]="p.delayMs">{{ p.text }}</span>
          }

          <!-- Drop particles (arc inward from any horizontal start, land inside bowl) -->
          @for (p of dropParticles(); track p.id) {
            <span
              [class]="p.kind === 'food' ? 'drop-particle food' : 'drop-particle text'"
              [style.left.%]="p.targetX"
              [style.--start-x.px]="dropOffsetPx(p)"
              [style.animation-delay.ms]="p.delayMs">{{ p.text }}</span>
          }
        </div>
        <p class="aria-only" role="status" aria-live="polite" aria-label="Planning progress">
          {{ lastTextParticle() }}
        </p>
      }

      @if (reassurance()) {
        <p class="reassurance" role="status" aria-live="polite">{{ reassurance() }}</p>
      }

      <button class="cancel-link" type="button" (click)="cancelClick.emit()">Cancel</button>
    </div>
  `,
  styles: [`
    :host { display: block; }

    .loader {
      background: var(--color-surface-warm, #fef3c7);
      border-radius: 14px;
      padding: 28px 20px 18px;
      min-height: 380px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 18px;
      position: relative;
      overflow: hidden;
    }

    .heading {
      font-size: 16px;
      font-weight: 800;
      color: var(--color-text-primary, #78350f);
      letter-spacing: -0.01em;
      margin: 0;
      text-align: center;
      position: relative;
      z-index: 10;
    }

    .stage,
    .static-stage {
      position: relative;
      width: 360px;
      max-width: 100%;
      height: 240px;
    }
    .stage {
      display: flex; align-items: center; justify-content: center;
    }
    .static-stage {
      display: flex; align-items: center; justify-content: center;
    }

    /* ── Bowl wrapper (holds inline SVG + steam wisps) ── */
    .bowl-base {
      position: relative;
      width: 140px;
      height: 140px;
      z-index: 1;
    }
    .bowl-base svg { display: block; }

    /* ── Swirling ingredients inside the bowl SVG ── */
    .ing {
      transform-box: view-box;
      transform-origin: 60px 60px;
      animation: ing-spiral var(--dur, 12s) linear infinite;
      animation-delay: var(--del, 0s);
      opacity: 0;
    }
    @keyframes ing-spiral {
      0%   { transform: rotate(var(--start)) translate(36px) rotate(calc(-1 * var(--start))) scale(0.5); opacity: 0; }
      10%  { transform: rotate(calc(var(--start) +  54deg)) translate(34px) rotate(calc(-1 * (var(--start) +  54deg))) scale(1);   opacity: 1; }
      85%  { transform: rotate(calc(var(--start) + 459deg)) translate(6px)  rotate(calc(-1 * (var(--start) + 459deg))) scale(1);   opacity: 1; }
      100% { transform: rotate(calc(var(--start) + 540deg)) translate(0px)  rotate(calc(-1 * (var(--start) + 540deg))) scale(0.3); opacity: 0; }
    }

    /* ── Steam wisps ── */
    .steam {
      position: absolute;
      left: 50%;
      top: -14px;
      width: 14px;
      height: 26px;
      transform: translateX(-50%);
      opacity: 0;
      pointer-events: none;
      z-index: 2;
    }
    .steam path {
      stroke: var(--color-accent-dark, #b45309);
      stroke-width: 2.5;
      fill: none;
      stroke-linecap: round;
      opacity: 0.55;
    }
    .steam.s1 { animation: rise 3.2s ease-out infinite; }
    .steam.s2 { animation: rise 3.2s ease-out 1.0s infinite; left: 38%; }
    .steam.s3 { animation: rise 3.2s ease-out 2.0s infinite; left: 62%; }
    @keyframes rise {
      0%   { transform: translate(-50%, 10px) scale(0.7); opacity: 0; }
      30%  { opacity: 0.65; }
      100% { transform: translate(-50%, -36px) scale(1.1); opacity: 0; }
    }

    /* ── Spiral particles ── */
    .particle {
      position: absolute;
      top: 50%; left: 50%;
      transform-origin: 0 0;
      animation: spiralIn 5.2s cubic-bezier(0.55, 0.05, 0.6, 1) forwards;
      opacity: 0;
      z-index: 3;
    }
    .particle.food {
      font-size: 22px;
      line-height: 1;
    }
    .particle.text {
      background: rgba(255, 255, 255, 0.88);
      border: 1px solid var(--color-accent-light, #fde68a);
      color: var(--color-accent-dark, #92400e);
      font-size: 11px;
      font-style: italic;
      padding: 3px 9px;
      border-radius: 12px;
      white-space: nowrap;
      box-shadow: 0 1px 3px rgba(217, 119, 6, 0.18);
    }
    @keyframes spiralIn {
      0%   { transform: rotate(var(--angle)) translate(140px) rotate(calc(-1 * var(--angle))) scale(0.7); opacity: 0; }
      8%   { transform: rotate(var(--angle)) translate(140px) rotate(calc(-1 * var(--angle))) scale(1);   opacity: 1; }
      35%  { transform: rotate(var(--angle)) translate(140px) rotate(calc(-1 * var(--angle))) scale(1);   opacity: 1; }
      100% { transform: rotate(calc(var(--angle) + 540deg)) translate(0) rotate(calc(-1 * var(--angle) - 540deg)) scale(0.3); opacity: 0; }
    }

    /* ── Drop particles (curved fall into the bowl) ── */
    .drop-particle {
      position: absolute;
      top: 0;
      animation: dropAndDrift 3.6s ease-in forwards;
      opacity: 0;
      z-index: 3;
    }
    .drop-particle.food {
      font-size: 22px;
      width: 22px; height: 22px;
      margin-left: -11px;
      text-align: center;
      line-height: 22px;
    }
    .drop-particle.text {
      background: rgba(255, 255, 255, 0.88);
      border: 1px solid var(--color-accent-light, #fde68a);
      color: var(--color-accent-dark, #92400e);
      font-size: 10px;
      font-style: italic;
      padding: 2px 8px;
      border-radius: 11px;
      white-space: nowrap;
      transform-origin: center;
    }
    @keyframes dropAndDrift {
      0%   { transform: translate(var(--start-x, 0px), -30px) scale(0.6); opacity: 0; }
      18%  { opacity: 1; }
      60%  { transform: translate(calc(var(--start-x, 0px) * 0.22), 55px) scale(0.95); opacity: 1; }
      82%  { transform: translate(0, 95px) scale(1); opacity: 1; }
      100% { transform: translate(0, 125px) scale(0.3); opacity: 0; }
    }

    /* ── Static fallback caption (reduced motion) ── */
    .static-caption {
      font-size: 13px;
      font-style: italic;
      color: var(--color-accent-dark, #92400e);
      margin: 0;
      text-align: center;
      min-height: 18px;
    }

    /* ── Visually-hidden aria-live region (text-particles announce here) ── */
    .aria-only {
      position: absolute;
      width: 1px; height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }

    /* ── Reassurance note (long rate-limit backoffs, #872) ── */
    .reassurance {
      font-size: 12px;
      font-style: italic;
      color: var(--color-accent-dark, #92400e);
      background: rgba(255, 255, 255, 0.6);
      border-radius: 10px;
      padding: 5px 12px;
      margin: 0;
      text-align: center;
      max-width: 320px;
      line-height: 1.35;
      z-index: 10;
    }

    /* ── Cancel link ── */
    .cancel-link {
      background: transparent;
      border: none;
      color: var(--color-text-muted, #b45309);
      font-size: 12px;
      font-style: italic;
      cursor: pointer;
      padding: 4px 8px;
      text-decoration: underline dotted;
      z-index: 10;
    }
    .cancel-link:hover { color: var(--color-accent-dark, #92400e); }

    @media (prefers-reduced-motion: reduce) {
      .ing,
      .steam,
      .particle,
      .drop-particle { animation: none !important; transition: none !important; }
    }
  `],
})
export class MealPlanLoadingComponent implements OnInit, OnDestroy {
  readonly slotsByDay   = input.required<SlotsForDay[]>();
  readonly blockedNames = input.required<string[]>();
  readonly cancelClick  = output<void>();

  protected readonly mode             = signal<StageMode>('spiral');
  protected readonly spiralParticles  = signal<Particle[]>([]);
  protected readonly dropParticles    = signal<Particle[]>([]);
  protected readonly lastTextParticle = signal<string>('');
  protected readonly staticCaption    = signal<string>('Planning…');
  protected readonly reducedMotion    = signal<boolean>(detectReducedMotion());
  protected readonly reassurance      = signal<string>('');

  private nextParticleId = 0;
  private foodTimer: ReturnType<typeof setInterval> | null = null;
  private textTimer: ReturnType<typeof setInterval> | null = null;
  private modeTimer: ReturnType<typeof setInterval> | null = null;
  private staticTimer: ReturnType<typeof setInterval> | null = null;
  private stillWorkingTimer: ReturnType<typeof setTimeout> | null = null;
  private stillWorkingExtTimer: ReturnType<typeof setTimeout> | null = null;
  private particleRemovers: ReturnType<typeof setTimeout>[] = [];

  // Pre-built pool of slot/day captions, recomputed when inputs change.
  private readonly slotCaptions = computed(() =>
    this.slotsByDay().flatMap(({ day, slots }) => [
      ...slots.map(slot => `Picking ${slot} for ${dayLabel(day)}…`),
      `Searching ${dayLabel(day)} options…`,
    ])
  );

  private readonly blockedCaptions = computed(() =>
    this.blockedNames().flatMap(name => [
      `Avoiding ${name} (you marked them blocked)…`,
      `Skipping ${name}…`,
    ])
  );

  ngOnInit(): void {
    // Reassurance timers run regardless of motion preference — the wizard can stall on
    // a long rate-limit backoff in either render mode. Cleared on destroy, which (because
    // this component is only mounted while generating) coincides with generation
    // completing or erroring — so the message clears automatically. (#872)
    this.stillWorkingTimer = setTimeout(
      () => this.reassurance.set(STILL_WORKING_TEXT),
      STILL_WORKING_MS,
    );
    this.stillWorkingExtTimer = setTimeout(
      () => this.reassurance.set(STILL_WORKING_EXTENDED_TEXT),
      STILL_WORKING_EXTENDED_MS,
    );

    if (this.reducedMotion()) {
      this.staticCaption.set(this.pickText() ?? 'Planning…');
      this.staticTimer = setInterval(
        () => this.staticCaption.set(this.pickText() ?? 'Planning…'),
        STATIC_CAPTION_MS,
      );
      return;
    }

    this.foodTimer = setInterval(() => this.emitFoodParticle(), FOOD_INTERVAL_MS);
    this.textTimer = setInterval(() => this.emitTextParticle(), TEXT_INTERVAL_MS);
    this.modeTimer = setInterval(
      () => this.mode.update(m => (m === 'spiral' ? 'drop' : 'spiral')),
      MODE_DURATION_MS,
    );
  }

  ngOnDestroy(): void {
    if (this.foodTimer)   clearInterval(this.foodTimer);
    if (this.textTimer)   clearInterval(this.textTimer);
    if (this.modeTimer)   clearInterval(this.modeTimer);
    if (this.staticTimer) clearInterval(this.staticTimer);
    if (this.stillWorkingTimer)    clearTimeout(this.stillWorkingTimer);
    if (this.stillWorkingExtTimer) clearTimeout(this.stillWorkingExtTimer);
    this.particleRemovers.forEach(t => clearTimeout(t));
    this.particleRemovers = [];
  }

  /**
   * Convert a drop particle's startX/targetX (both in % of stage width) into the px
   * offset used by `--start-x` in the `dropAndDrift` keyframe. Falls back to 0 if either
   * field is missing (defensive — should never happen for drop-mode particles).
   */
  protected dropOffsetPx(p: Particle): number {
    if (p.startX === undefined || p.targetX === undefined) return 0;
    return ((p.startX - p.targetX) * STAGE_WIDTH_PX) / 100;
  }

  private emitFoodParticle(): void {
    const text  = FOOD_EMOJI[Math.floor(Math.random() * FOOD_EMOJI.length)];
    const angle = PERIMETER_ANGLES[Math.floor(Math.random() * PERIMETER_ANGLES.length)];
    this.appendParticle({
      id: this.nextParticleId++,
      kind: 'food',
      text,
      angle,
      ...this.dropCoords(),
      delayMs: 0,
    });
  }

  private emitTextParticle(): void {
    const text = this.pickText();
    if (!text) return;
    const angle = PERIMETER_ANGLES[Math.floor(Math.random() * PERIMETER_ANGLES.length)];
    this.appendParticle({
      id: this.nextParticleId++,
      kind: 'text',
      text,
      angle,
      ...this.dropCoords(),
      delayMs: 0,
    });
    this.lastTextParticle.set(text);
  }

  /**
   * Generate drop-mode coordinates: startX is any horizontal start (5-95% of stage),
   * targetX is the safe landing zone inside the bowl interior (40-60%). Returns
   * undefined fields for spiral mode so the Particle type stays clean.
   */
  private dropCoords(): { startX?: number; targetX?: number } {
    if (this.mode() !== 'drop') return {};
    return {
      startX:  5  + Math.random() * 90,
      targetX: 40 + Math.random() * 20,
    };
  }

  /**
   * Pick a text from the weighted pools.
   * Weights: slots 40%, blocked 20%, playful 40%. If blocked is empty, splits 50/50.
   */
  private pickText(): string | null {
    const hasBlocked  = this.blockedCaptions().length > 0;
    const hasSlots    = this.slotCaptions().length > 0;
    const r = Math.random();
    if (hasBlocked && hasSlots) {
      if (r < 0.40) return this.sample(this.slotCaptions());
      if (r < 0.60) return this.sample(this.blockedCaptions());
      return this.sample(PLAYFUL_TEXTS);
    }
    if (hasSlots) {
      return r < 0.5 ? this.sample(this.slotCaptions()) : this.sample(PLAYFUL_TEXTS);
    }
    if (hasBlocked) {
      return r < 0.5 ? this.sample(this.blockedCaptions()) : this.sample(PLAYFUL_TEXTS);
    }
    return this.sample(PLAYFUL_TEXTS);
  }

  private sample<T>(arr: T[]): T | null {
    return arr.length === 0 ? null : arr[Math.floor(Math.random() * arr.length)];
  }

  private appendParticle(p: Particle): void {
    const list = this.mode() === 'spiral' ? this.spiralParticles : this.dropParticles;
    list.update(curr => {
      const next = [...curr, p];
      return next.length > MAX_PARTICLES ? next.slice(next.length - MAX_PARTICLES) : next;
    });
    const removeT = setTimeout(() => {
      list.update(curr => curr.filter(x => x.id !== p.id));
    }, PARTICLE_LIFETIME_MS);
    this.particleRemovers.push(removeT);
  }
}
