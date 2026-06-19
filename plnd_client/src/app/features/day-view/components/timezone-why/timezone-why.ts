import { Component, computed, input, output, signal, ChangeDetectionStrategy } from '@angular/core';
import { TimezoneAnchorDto } from '../../../../core/models/timezone';
import { parseDateOnly } from '../../../../core/utils/date-only';

// A short curated list of common IANA zones for the "Pick a different zone…" control.
// (Not exhaustive — the device/inferred paths cover the common cases; this is a manual override.)
const PICK_ZONES: { id: string; label: string }[] = [
  { id: 'America/New_York',    label: 'Eastern (New York)' },
  { id: 'America/Chicago',     label: 'Central (Chicago)' },
  { id: 'America/Denver',      label: 'Mountain (Denver)' },
  { id: 'America/Los_Angeles', label: 'Pacific (Los Angeles)' },
  { id: 'America/Anchorage',   label: 'Alaska (Anchorage)' },
  { id: 'Pacific/Honolulu',    label: 'Hawaii (Honolulu)' },
  { id: 'Europe/London',       label: 'United Kingdom (London)' },
  { id: 'Europe/Paris',        label: 'Central Europe (Paris)' },
];

@Component({
  selector: 'app-timezone-why',
  standalone: true,
  template: `
    <div class="tz-why-pop" role="dialog" aria-label="Timezone source">
      <p class="tz-why-pop__provenance">{{ provenance() }}</p>
      <div class="tz-why-pop__actions">
        <button type="button" class="tz-why-pop__btn" (click)="useCurrent.emit()">Use my current zone</button>
        @if (!picking()) {
          <button type="button" class="tz-why-pop__btn tz-why-pop__btn--ghost" (click)="picking.set(true)">Pick a different zone…</button>
        } @else {
          <select class="tz-why-pop__select" aria-label="Choose a timezone" (change)="onPick($event)">
            <option value="">Choose a zone…</option>
            @for (z of zones; track z.id) {
              <option [value]="z.id">{{ z.label }}</option>
            }
          </select>
        }
      </div>
      <button type="button" class="tz-why-pop__close" aria-label="Close" (click)="closed.emit()">×</button>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './timezone-why.scss',
})
export class TimezoneWhyComponent {
  readonly anchor      = input.required<TimezoneAnchorDto>();
  readonly currentZone = input.required<string>();
  readonly sourceLabel = input<string | null>(null); // originating task title for inferred, if known

  readonly useCurrent = output<void>();
  readonly pickZone   = output<string>(); // emits chosen IANA zone
  readonly closed     = output<void>();

  protected readonly zones = PICK_ZONES;
  protected readonly picking = signal(false);

  protected readonly provenance = computed(() => {
    const a = this.anchor();
    const d = parseDateOnly(a.effective_date);
    switch (a.source) {
      case 'device': return 'From your device';
      case 'user':   return `Set by you on ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
      case 'inferred': {
        const wd = d.toLocaleDateString('en-US', { weekday: 'long' });
        const label = this.sourceLabel();
        return label ? `Inferred from "${label}" on ${wd}` : 'Inferred from your travel plans';
      }
    }
  });

  protected onPick(ev: Event): void {
    const v = (ev.target as HTMLSelectElement).value;
    if (v) this.pickZone.emit(v);
  }
}
