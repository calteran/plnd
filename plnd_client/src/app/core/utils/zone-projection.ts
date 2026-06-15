import { TimezoneAnchorDto } from '../models/timezone';

export interface DaySwitch { fromZone: string; toZone: string; anchor: TimezoneAnchorDto; }
export interface DayZoneView {
  kind: 'same' | 'divergent' | 'travel';
  incomingZone: string | null;   // zone at the start of the day
  currentZone: string;           // zone in effect now
  switch?: DaySwitch;            // present iff kind === 'travel' (first intra-day switch)
}

/** Anchors sorted by (effective_date, effective_time NULLS FIRST) — mirrors the backend order. */
function ordered(anchors: TimezoneAnchorDto[]): TimezoneAnchorDto[] {
  return [...anchors].sort((a, b) =>
    a.effective_date !== b.effective_date
      ? a.effective_date.localeCompare(b.effective_date)
      : (a.effective_time ?? '').localeCompare(b.effective_time ?? ''));
}

/** Zone at the START of `date`: most recent anchor strictly before `date`, plus any
 *  whole-day (effective_time === null) anchor on `date` itself. */
function incomingZoneAt(anchors: TimezoneAnchorDto[], date: string): string | null {
  let zone: string | null = null;
  for (const a of ordered(anchors)) {
    if (a.effective_date < date) zone = a.zone;
    else if (a.effective_date === date && a.effective_time === null) zone = a.zone;
    else break;
  }
  return zone;
}

export function classifyDay(anchors: TimezoneAnchorDto[], date: string, currentZone: string): DayZoneView {
  const incomingZone = incomingZoneAt(anchors, date);
  const intraday = ordered(anchors).filter(a => a.effective_date === date && a.effective_time !== null);

  if (intraday.length > 0) {
    const first = intraday[0];
    const fromZone = incomingZone ?? currentZone;
    return { kind: 'travel', incomingZone, currentZone, switch: { fromZone, toZone: first.zone, anchor: first } };
  }
  const effective = incomingZone ?? currentZone;
  return { kind: effective === currentZone ? 'same' : 'divergent', incomingZone, currentZone };
}
