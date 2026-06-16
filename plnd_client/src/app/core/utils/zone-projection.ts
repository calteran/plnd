import { TimezoneAnchorDto } from '../models/timezone';

export interface DaySwitch { fromZone: string; toZone: string; anchor: TimezoneAnchorDto; }
export interface DayZoneView {
  kind: 'same' | 'divergent' | 'travel';
  incomingZone: string | null;   // zone at the start of the day
  currentZone: string;           // zone in effect now
  switch?: DaySwitch;            // present iff kind === 'travel'
}
