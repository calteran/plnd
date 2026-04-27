import { Component, OnInit, OnDestroy, input, signal } from '@angular/core';

export interface MessagePart {
  text: string;
  isTag?: boolean;
}

interface ChatMessage {
  id: number;
  parts: MessagePart[];
}

function plain(text: string): MessagePart[] {
  return [{ text }];
}

const GENERIC_MESSAGES: MessagePart[][] = [
  plain('Analysing your energy patterns…'),
  plain('Negotiating with Tuesday…'),
  plain('Untangling your week…'),
  plain('Coaxing tasks into sensible order…'),
  plain('Consulting the calendar spirits…'),
  plain('Convincing Monday to cooperate…'),
  plain('Aligning the cosmic schedule…'),
  plain('Applying temporal smoothing…'),
  plain('Herding cats (metaphorically)…'),
  plain('Optimising for sanity…'),
  plain('Cross-referencing your best hours…'),
  plain('Resolving scheduling paradoxes…'),
  plain('Defragmenting your week…'),
  plain('Almost there…'),
];

const EASTER_EGG: MessagePart[] = plain('Reticulating splines…');

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const MAX_KEEP              = 6;
export const MIN_DELAY_MS          = 1100;
export const MAX_DELAY_MS          = 2400;
export const TYPING_GAP_MS         = 150;
export const EASTER_EGG_EVERY      = 15;
export const MAX_PERSONALISED_NAMES = 5;

@Component({
  selector: 'app-onboarding-loading-screen',
  standalone: true,
  template: `
    <div class="loading-screen">

      <div class="plan-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <path d="M19 3h-1V1h-2v2H8V1H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14
                   a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 16H5V8h14v11z
                   M9 10H7v2h2zm4 0h-2v2h2zm4 0h-2v2h2zm-8 4H7v2h2zm4 0h-2v2h2z"/>
        </svg>
      </div>

      <div class="heading-block">
        <h2>Building your plan</h2>
        <p class="subtitle">This should only take a moment&hellip;</p>
      </div>

      <div class="chat-window">
        <div class="chat-list">
          @for (msg of messages(); track msg.id) {
            <div class="bubble entering">
              @for (part of msg.parts; track $index) {
                @if (part.isTag) {
                  <span class="tag">{{ part.text }}</span>
                } @else {
                  {{ part.text }}
                }
              }
            </div>
          }
          @if (showTyping()) {
            <div class="typing-bubble" aria-label="Thinking">
              <span class="dot"></span>
              <span class="dot"></span>
              <span class="dot"></span>
            </div>
          }
        </div>
      </div>

    </div>
  `,
  styles: [`
    .loading-screen {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 18px;
      padding: 28px 24px 32px;
      background: #fef9f0;
      min-height: 340px;
    }

    .plan-icon {
      width: 52px; height: 52px;
      background: var(--color-accent, #d97706);
      border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
      animation: iconPulse 2.2s ease-in-out infinite;
    }
    .plan-icon svg { width: 26px; height: 26px; fill: white; }

    @keyframes iconPulse {
      0%,100% { box-shadow: 0 0 0 0 rgba(217,119,6,0.4); }
      50%      { box-shadow: 0 0 0 12px rgba(217,119,6,0); }
    }

    .heading-block { text-align: center; }
    .heading-block h2 {
      font-size: 18px; font-weight: 800;
      color: var(--color-text-primary, #78350f);
      margin: 0 0 4px; letter-spacing: -0.01em;
    }
    .subtitle { font-size: 13px; color: var(--color-text-secondary, #b45309); margin: 0; }

    .chat-window {
      width: 100%; height: 210px;
      position: relative; overflow: hidden;
      -webkit-mask-image: linear-gradient(to bottom, transparent 0px, black 36px);
      mask-image:         linear-gradient(to bottom, transparent 0px, black 36px);
    }

    .chat-list {
      position: absolute; bottom: 0; left: 0; right: 0;
      display: flex; flex-direction: column;
    }

    .bubble {
      margin-bottom: 8px;
      padding: 8px 14px;
      border-radius: 18px; border-bottom-left-radius: 4px;
      font-size: 13px; line-height: 1.45;
      color: var(--color-text-primary, #78350f);
      background: #fffbf0;
      border: 1px solid var(--color-accent-border, #fde68a);
      max-width: 88%;
    }

    .bubble.entering {
      animation: bubbleIn 0.35s ease forwards;
    }

    @keyframes bubbleIn {
      from { opacity: 0; transform: translateY(6px) scale(0.97); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }

    .tag {
      display: inline-block;
      background: var(--color-accent-light, #fef3c7);
      color: var(--color-accent-dark, #92400e);
      border-radius: 10px; padding: 1px 7px;
      font-size: 11px; font-weight: 700; margin: 0 2px;
    }

    .typing-bubble {
      margin-bottom: 8px;
      padding: 10px 14px;
      border-radius: 18px; border-bottom-left-radius: 4px;
      background: #fffbf0;
      border: 1px solid var(--color-accent-border, #fde68a);
      display: inline-flex; gap: 4px; align-items: center;
      animation: bubbleIn 0.3s ease forwards;
    }

    .dot {
      width: 6px; height: 6px; border-radius: 50%;
      background: var(--color-accent, #d97706);
      animation: dotBounce 0.7s ease-in-out infinite;
    }
    .dot:nth-child(2) { animation-delay: 0.14s; }
    .dot:nth-child(3) { animation-delay: 0.28s; }

    @keyframes dotBounce {
      0%,100% { transform: translateY(0); opacity: 0.5; }
      50%      { transform: translateY(-4px); opacity: 1; }
    }
  `],
})
export class OnboardingLoadingScreenComponent implements OnInit, OnDestroy {
  readonly taskCount    = input.required<number>();
  readonly routineCount = input.required<number>();
  readonly taskNames    = input.required<string[]>();

  protected readonly messages   = signal<ChatMessage[]>([]);
  protected readonly showTyping = signal(false);

  private pendingT1: ReturnType<typeof setTimeout> | null = null;
  private pendingT2: ReturnType<typeof setTimeout> | null = null;
  private msgIdCounter = 0;

  private personalisedPool: MessagePart[][] = [];
  private usedPersonalisedCount = 0;
  private genericPool: MessagePart[][] = [];
  private genericIdx = 0;
  private eggCounter = 0;

  ngOnInit(): void {
    this.personalisedPool = shuffle(this.buildPersonalisedPool());
    this.genericPool = shuffle([...GENERIC_MESSAGES]);
    this.scheduleNext();
  }

  ngOnDestroy(): void {
    if (this.pendingT1 !== null) clearTimeout(this.pendingT1);
    if (this.pendingT2 !== null) clearTimeout(this.pendingT2);
  }

  private buildPersonalisedPool(): MessagePart[][] {
    const count    = this.taskCount();
    const routines = this.routineCount();
    const names    = this.taskNames();
    const msgs: MessagePart[][] = [];

    msgs.push([
      { text: 'Found ' },
      { text: `${count} task${count !== 1 ? 's' : ''}`, isTag: true },
      { text: ' & ' },
      { text: `${routines} routine${routines !== 1 ? 's' : ''}`, isTag: true },
    ]);

    const templates: Array<(n: string) => MessagePart[]> = [
      n => [{ text: 'Protecting time for ' }, { text: n, isTag: true }, { text: '…' }],
      n => [{ text: 'Fitting ' }, { text: n, isTag: true }, { text: ' into your morning…' }],
      n => [{ text: 'Scheduling ' }, { text: n, isTag: true }, { text: ' around your focus blocks…' }],
      n => [{ text: 'Reserving buffer after ' }, { text: n, isTag: true }, { text: '…' }],
    ];

    for (const name of names.slice(0, MAX_PERSONALISED_NAMES)) {
      const tpl = templates[Math.floor(Math.random() * templates.length)];
      msgs.push(tpl(name));
    }

    return msgs;
  }

  private nextMessage(): MessagePart[] {
    const total = this.personalisedPool.length;
    const useGeneric = total === 0 || Math.random() < this.usedPersonalisedCount / total;

    if (!useGeneric) {
      return this.personalisedPool[this.usedPersonalisedCount++];
    }

    this.eggCounter++;
    if (this.eggCounter % EASTER_EGG_EVERY === 0) return EASTER_EGG;

    if (this.genericIdx >= this.genericPool.length) {
      this.genericPool = shuffle([...GENERIC_MESSAGES]);
      this.genericIdx = 0;
    }
    return this.genericPool[this.genericIdx++];
  }

  private scheduleNext(): void {
    this.showTyping.set(true);
    const ms = MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS);
    this.pendingT1 = setTimeout(() => {
      this.pendingT1 = null;
      this.showTyping.set(false);
      this.msgIdCounter++;
      this.messages.update(prev => {
        const next = [...prev, { id: this.msgIdCounter, parts: this.nextMessage() }];
        return next.length > MAX_KEEP ? next.slice(next.length - MAX_KEEP) : next;
      });
      this.pendingT2 = setTimeout(() => {
        this.pendingT2 = null;
        this.scheduleNext();
      }, TYPING_GAP_MS);
    }, ms);
  }
}
