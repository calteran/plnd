import { Component, ElementRef, ViewChild, inject, input, output, signal } from '@angular/core';
import { AgentService } from '../../../../core/services/agent.service';
import { ConversationTurn, UiSignal } from '../../../../core/models/agent';
import { ItemType } from '../../../../core/models/schedule';

/** Emitted after agent confirmation so parent components can respond (e.g. schedule reload). */
export interface AddedEntry {
  label: string;
  type: ItemType;
  id?: string;
  duration?: number;
}

// Keep in sync with ItemType in core/models/schedule.ts
function toItemType(actionType: string | undefined): ItemType {
  if (actionType === 'exercise' || actionType === 'appointment') return actionType;
  return 'task';
}

@Component({
  selector: 'app-add-entry',
  standalone: true,
  imports: [],
  template: `
    @if (!isOpen()) {
      <div class="add-row" (click)="open()" role="button" tabindex="0"
           (keydown.enter)="open()" (keydown.space)="open()" aria-label="Open entry form">
        <div class="gutter"></div>
        <div class="add-checkbox" aria-hidden="true">+</div>
        <span class="add-label">Add something…</span>
      </div>
    } @else {
      <div class="entry-panel">
        <div class="input-wrapper">
          <input
            #entryInput
            class="entry-input"
            [class.loading]="isLoading()"
            [value]="_text()"
            (input)="_text.set($any($event.target).value)"
            placeholder="e.g. vitamins with breakfast, walk after lunch, dentist 2pm…"
            (keydown.escape)="close()"
            (keydown.enter)="submit()"
            [attr.readonly]="isLoading() ? '' : null"
            aria-label="Add something to your day"
          />
          @if (isLoading()) {
            <div class="input-spinner" aria-hidden="true"></div>
          }
        </div>

        @if (pendingSignals().length > 0) {
          <div class="signal-form">
            @for (sig of pendingSignals(); track sig.field) {
              @switch (sig.type) {
                @case ('show_checkbox') {
                  <label class="signal-label">
                    <input
                      type="checkbox"
                      [checked]="signalAnswers()[sig.field] ?? sig.default ?? false"
                      (change)="setAnswer(sig.field, $any($event.target).checked)"
                    />
                    {{ sig.label ?? sig.field }}
                  </label>
                }
                @case ('show_select') {
                  <label class="signal-label">
                    {{ sig.label ?? sig.field }}
                    <select
                      [value]="signalAnswers()[sig.field] ?? sig.default ?? ''"
                      (change)="setAnswer(sig.field, $any($event.target).value)"
                    >
                      @for (opt of sig.options ?? []; track opt) {
                        <option [value]="opt">{{ opt }}</option>
                      }
                    </select>
                  </label>
                }
              }
            }
          </div>
        }

        @if (errorMessage()) {
          <p class="agent-error">{{ errorMessage() }}</p>
        }

        <div class="entry-actions">
          <label class="toggle-adding-more">
            <input
              type="checkbox"
              [checked]="addingMore()"
              (change)="addingMore.set($any($event.target).checked)"
            />
            Adding more
          </label>
          <button class="btn-cancel" type="button" (click)="close()">Cancel</button>
          @if (pendingSignals().length > 0) {
            <button class="btn-continue" type="button" (click)="continueWithAnswers()">Continue</button>
          } @else {
            <button class="btn-add" type="button" (click)="submit()" [disabled]="!_text().trim() || isLoading()">Add</button>
          }
        </div>
      </div>
    }
  `,
  styleUrl: './add-entry.scss'
})
export class AddEntryComponent {
  @ViewChild('entryInput') private entryInput?: ElementRef<HTMLInputElement>;

  private readonly agentService = inject(AgentService);

  /** The day the user is currently viewing (YYYY-MM-DD). Passed in by the parent. */
  readonly date = input<string>('');
  /** Anchors the input text that opened the current conversation thread. */
  private _conversationInput = '';

  readonly added              = output<AddedEntry>();
  readonly confirmed          = output<string>();
  readonly isOpen             = signal(false);
  protected readonly _text    = signal('');
  readonly isLoading                      = signal(false);
  protected readonly addingMore           = signal(false);
  protected readonly pendingSignals       = signal<UiSignal[]>([]);
  protected readonly signalAnswers        = signal<Record<string, unknown>>({});
  protected readonly conversationHistory  = signal<ConversationTurn[]>([]);
  protected readonly errorMessage         = signal<string | null>(null);

  open(): void {
    this.isOpen.set(true);
    this.addingMore.set(false);
    setTimeout(() => this.entryInput?.nativeElement.focus(), 0);
  }

  close(): void {
    this.isOpen.set(false);
    this._text.set('');
    this.isLoading.set(false);
    this.addingMore.set(false);
    this.pendingSignals.set([]);
    this.signalAnswers.set({});
    this.conversationHistory.set([]);
    this.errorMessage.set(null);
    this._conversationInput = '';
  }

  setAnswer(field: string, value: unknown): void {
    this.signalAnswers.update(a => ({ ...a, [field]: value }));
  }

  continueWithAnswers(): void {
    const signals = this.pendingSignals();
    // Merge sig.default for any field the user did not explicitly interact with
    const answers: Record<string, unknown> = { ...this.signalAnswers() };
    for (const sig of signals) {
      if (!(sig.field in answers) && sig.default !== undefined) {
        answers[sig.field] = sig.default;
      }
    }
    this.conversationHistory.update(h => [...h, { signals, answers }]);
    this.pendingSignals.set([]);
    this.signalAnswers.set({});
    this.submit();
  }

  submit(): void {
    const input = this._text().trim();
    if (!input || this.isLoading()) return;

    // New input while mid-conversation → discard the stale context
    if (this.conversationHistory().length > 0 && input !== this._conversationInput) {
      this.conversationHistory.set([]);
      this.pendingSignals.set([]);
      this.signalAnswers.set({});
    }

    // Anchor the input text for this conversation thread
    if (this.conversationHistory().length === 0) {
      this._conversationInput = input;
    }

    this.isLoading.set(true);
    this.errorMessage.set(null);

    this.agentService
      .createTask({ input, date: this.date(), context: this.conversationHistory() })
      .subscribe({
        next: res => {
          this.isLoading.set(false);
          if (res.actions_taken.length > 0) {
            // Task was created — complete the flow regardless of any informational ui_signals.
            const action = res.actions_taken[0];
            this.added.emit({ label: input, type: toItemType(action?.type), id: action?.task_id });
            this.confirmed.emit(res.confirmation);
            this.conversationHistory.set([]);
            this.pendingSignals.set([]);
            this.signalAnswers.set({});
            if (this.addingMore()) {
              this._text.set('');
              this._conversationInput = '';
              setTimeout(() => this.entryInput?.nativeElement.focus(), 0);
            } else {
              this.close();
            }
          } else if (res.ui_signals.length > 0) {
            // No task created yet — show clarification signals.
            this.pendingSignals.set(res.ui_signals);
          }
        },
        error: () => {
          this.isLoading.set(false);
          this.errorMessage.set('Something went wrong. Please try again.');
        },
      });
  }
}
