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
        <!-- Static fallback: still bowl + single rotating caption (no animation) -->
        <div class="static-stage">
          <div class="bowl-base"></div>
        </div>
        <p class="static-caption" role="status" aria-live="polite" aria-label="Planning progress">
          {{ staticCaption() }}
        </p>
      } @else {
        <div class="stage">
          <div class="mode-stage spiral" [class.active]="mode() === 'spiral'">
            <div class="bowl-base"></div>
            <div class="bowl-sweep"></div>
            @for (p of spiralParticles(); track p.id) {
              <span
                [class]="p.kind === 'food' ? 'particle food' : 'particle text'"
                [style.--angle.deg]="p.angle"
                [style.animation-delay.ms]="p.delayMs">{{ p.text }}</span>
            }
          </div>
          <div class="mode-stage drop" [class.active]="mode() === 'drop'">
            <div class="plate"></div>
            @for (p of dropParticles(); track p.id) {
              <span
                [class]="p.kind === 'food' ? 'drop-particle food' : 'drop-particle text'"
                [style.left.%]="p.angle"
                [style.animation-delay.ms]="p.delayMs">{{ p.text }}</span>
            }
          </div>
        </div>
        <p class="aria-only" role="status" aria-live="polite" aria-label="Planning progress">
          {{ lastTextParticle() }}
        </p>
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
    .static-stage {
      display: flex; align-items: center; justify-content: center;
    }

    .mode-stage {
      position: absolute; inset: 0;
      display: flex; align-items: center; justify-content: center;
      opacity: 0;
      transition: opacity 0.9s ease-in-out;
      z-index: 1;
    }
    .mode-stage.active { opacity: 1; }

    /* ── Bowl (CSS placeholder; SVG follow-up #768) ── */
    .bowl-base {
      width: 110px; height: 110px;
      border-radius: 50%;
      background: radial-gradient(circle at 50% 35%,
        var(--color-accent-light, #fde68a) 0%,
        var(--color-accent, #d97706) 80%);
      box-shadow:
        inset 0 -8px 16px rgba(0,0,0,0.22),
        0 4px 18px rgba(217,119,6,0.3);
      position: relative;
      z-index: 1;
    }
    .bowl-sweep {
      position: absolute;
      width: 94px; height: 94px;
      border-radius: 50%;
      background: conic-gradient(from 0deg,
        rgba(255,255,255,0) 0%,
        rgba(255,255,255,0.55) 18%,
        rgba(255,255,255,0) 35%);
      animation: stir 2.4s linear infinite;
      mix-blend-mode: overlay;
      z-index: 2;
      pointer-events: none;
    }
    @keyframes stir { to { transform: rotate(360deg); } }

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

    /* ── Plate (CSS placeholder; SVG follow-up #768) ── */
    .plate {
      position: absolute;
      bottom: 30px;
      width: 220px; height: 22px;
      border-radius: 50%;
      background: radial-gradient(ellipse at 50% 35%,
        var(--color-surface-warm, #fef3c7) 0%,
        var(--color-accent-warm, #fbbf24) 80%);
      box-shadow: 0 4px 14px rgba(217, 119, 6, 0.3);
      z-index: 1;
    }

    /* ── Drop particles ── */
    .drop-particle {
      position: absolute;
      top: 0;
      animation: dropFall 3.4s ease-in forwards;
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
    @keyframes dropFall {
      0%   { transform: translateY(-30px) scale(0.6); opacity: 0; }
      18%  { opacity: 1; }
      82%  { transform: translateY(160px) scale(1);   opacity: 1; }
      100% { transform: translateY(180px) scale(0.4); opacity: 0; }
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
      .bowl-sweep,
      .particle,
      .drop-particle,
      .mode-stage { animation: none !important; transition: none !important; }
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

  private nextParticleId = 0;
  private foodTimer: ReturnType<typeof setInterval> | null = null;
  private textTimer: ReturnType<typeof setInterval> | null = null;
  private modeTimer: ReturnType<typeof setInterval> | null = null;
  private staticTimer: ReturnType<typeof setInterval> | null = null;
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
    this.particleRemovers.forEach(t => clearTimeout(t));
    this.particleRemovers = [];
  }

  private emitFoodParticle(): void {
    const text  = FOOD_EMOJI[Math.floor(Math.random() * FOOD_EMOJI.length)];
    const angle = PERIMETER_ANGLES[Math.floor(Math.random() * PERIMETER_ANGLES.length)];
    this.appendParticle({
      id: this.nextParticleId++,
      kind: 'food',
      text,
      angle: this.mode() === 'spiral' ? angle : 30 + Math.random() * 40, // % horizontal pos in drop mode
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
      angle: this.mode() === 'spiral' ? angle : 30 + Math.random() * 40,
      delayMs: 0,
    });
    this.lastTextParticle.set(text);
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
