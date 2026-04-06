import { Component, ElementRef, ViewChild, inject, output, signal } from '@angular/core';
import { AgentService } from '../../../../core/services/agent.service';
import { ConversationTurn, UiSignal } from '../../../../core/models/agent';
import { ItemType } from '../../../../core/models/schedule';

/** Emitted after agent confirmation so parent components can respond (e.g. schedule reload). */
export interface AddedEntry {
  label: string;
  type: ItemType;
  duration?: number;
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
        <input
          #entryInput
          class="entry-input"
          [value]="_text()"
          (input)="_text.set($any($event.target).value)"
          placeholder="e.g. vitamins with breakfast, walk after lunch, dentist 2pm…"
          (keydown.escape)="close()"
          (keydown.enter)="submit()"
          aria-label="Add something to your day"
        />

        @if (isLoading()) {
          <div class="loading" aria-live="polite" aria-label="Loading">…</div>
        }

        @if (pendingSignals().length > 0) {
          <div class="signal-form">
            @for (sig of pendingSignals(); track sig.field) {
              @switch (sig.type) {
                @case ('show_checkbox') {
                  <label class="signal-label">
                    <input
                      type="checkbox"
                      [checked]="!!signalAnswers()[sig.field]"
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

        @if (confirmation()) {
          <p class="agent-confirmation">{{ confirmation() }}</p>
        }

        @if (errorMessage()) {
          <p class="agent-error">{{ errorMessage() }}</p>
        }

        <div class="entry-actions">
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

  readonly added              = output<AddedEntry>();
  readonly isOpen             = signal(false);
  protected readonly _text    = signal('');
  readonly isLoading          = signal(false);
  readonly pendingSignals     = signal<UiSignal[]>([]);
  readonly signalAnswers      = signal<Record<string, unknown>>({});
  readonly conversationHistory = signal<ConversationTurn[]>([]);
  readonly confirmation       = signal<string | null>(null);
  readonly errorMessage       = signal<string | null>(null);

  open(): void {
    this.isOpen.set(true);
    setTimeout(() => this.entryInput?.nativeElement.focus(), 0);
  }

  close(): void {
    this.isOpen.set(false);
    this._text.set('');
    this.isLoading.set(false);
    this.pendingSignals.set([]);
    this.signalAnswers.set({});
    this.conversationHistory.set([]);
    this.confirmation.set(null);
    this.errorMessage.set(null);
  }

  setAnswer(field: string, value: unknown): void {
    this.signalAnswers.update(a => ({ ...a, [field]: value }));
  }

  continueWithAnswers(): void {
    this.conversationHistory.update(h => [
      ...h,
      { signals: this.pendingSignals(), answers: this.signalAnswers() },
    ]);
    this.pendingSignals.set([]);
    this.signalAnswers.set({});
    this.submit();
  }

  submit(): void {
    const input = this._text().trim();
    if (!input) return;

    this.isLoading.set(true);
    this.errorMessage.set(null);
    this.confirmation.set(null);

    this.agentService
      .createTask({ input, context: this.conversationHistory() })
      .subscribe({
        next: res => {
          this.isLoading.set(false);
          if (res.ui_signals.length > 0) {
            this.pendingSignals.set(res.ui_signals);
          } else {
            this.confirmation.set(res.confirmation);
            this.added.emit({ label: input, type: 'task' });
            this.conversationHistory.set([]);
            this.pendingSignals.set([]);
          }
        },
        error: () => {
          this.isLoading.set(false);
          this.errorMessage.set('Something went wrong. Please try again.');
        },
      });
  }
}
