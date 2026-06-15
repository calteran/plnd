// IANA timezone → display strings, via Intl CLDR generic names (no dependency).

function tzNamePart(zone: string, date: Date, kind: 'shortGeneric' | 'longGeneric'): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: kind })
    .formatToParts(date);
  return parts.find(p => p.type === 'timeZoneName')?.value ?? zone;
}

/** "America/Denver" → "DENVER" (last path segment, underscores→spaces, uppercased). */
export function zoneCity(zone: string): string {
  return zone.split('/').pop()!.replace(/_/g, ' ').toUpperCase();
}

/** Short generic zone label, e.g. "MT". Falls back to a "<Region> Time" Intl string for non-US zones. */
export function zoneShort(zone: string, date: Date): string {
  return tzNamePart(zone, date, 'shortGeneric');
}

/** Long generic zone label, e.g. "Mountain Time". */
export function zoneLong(zone: string, date: Date): string {
  return tzNamePart(zone, date, 'longGeneric');
}

/** UTC offset of `zone` at `date`, in whole minutes (e.g. America/Denver summer → -360). */
function offsetMinutes(zone: string, date: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(dtf.formatToParts(date).map(x => [x.type, x.value]));
  const asUTC = Date.UTC(
    +p['year'], +p['month'] - 1, +p['day'],
    +(p['hour'] === '24' ? '0' : p['hour']), +p['minute'], +p['second'],
  );
  return Math.round((asUTC - date.getTime()) / 60000);
}

function diffHours(a: string, b: string, date: Date): number {
  return Math.round((offsetMinutes(a, date) - offsetMinutes(b, date)) / 60);
}

/** "2h behind your current zone" / "ahead of" / "same as", dayZone vs currentZone. */
export function offsetPhrase(dayZone: string, currentZone: string, date: Date): string {
  const h = diffHours(dayZone, currentZone, date);
  if (h === 0) return 'same as your current zone';
  return h < 0 ? `${-h}h behind your current zone` : `${h}h ahead of your current zone`;
}

/** "5 hours earlier" / "5 hours later" for a switch fromZone → toZone. */
export function offsetWords(fromZone: string, toZone: string, date: Date): string {
  const h = diffHours(toZone, fromZone, date);
  const n = Math.abs(h);
  const unit = n === 1 ? 'hour' : 'hours';
  if (h === 0) return 'same time';
  return h < 0 ? `${n} ${unit} earlier` : `${n} ${unit} later`;
}
