export type SlotKind = 'slot' | 'meal';

/** One drop target within a single day, in visual reading order. */
export interface DaySlot {
  /** after_anchor label, meal id/name, or '<sched>'. */
  slotKey: string;
  kind: SlotKind;
  /** Ordered ids of the tasks currently in this slot. */
  taskIds: string[];
}

/** The slots of one day, top-to-bottom. */
export type DayLayout = DaySlot[];

export type Crossing = 'same-slot' | 'to-slot' | 'into-meal' | 'out-of-meal';

/** Where an earlier/later step lands. `index` is the 0-based insert index in the target slot. */
export interface MoveResult {
  slotKey: string;
  kind: SlotKind;
  index: number;
  crossing: Crossing;
}

/** Locate a task: which slot it's in and its index within that slot. */
function locate(layout: DayLayout, taskId: string): { slotIdx: number; within: number } | null {
  for (let s = 0; s < layout.length; s++) {
    const within = layout[s].taskIds.indexOf(taskId);
    if (within !== -1) return { slotIdx: s, within };
  }
  return null;
}

function crossingFor(from: SlotKind, to: SlotKind): Crossing {
  if (from === to) return 'to-slot';
  return to === 'meal' ? 'into-meal' : 'out-of-meal';
}

/**
 * Step a task one position earlier ('up') or later ('down') through the day's
 * reading order. Within a slot it reorders; at a slot edge it crosses into the
 * adjacent slot (its end when stepping up, its start when stepping down), which
 * lands correctly in an empty slot. Returns null at the day's first/last position.
 */
export function stepWithinDay(layout: DayLayout, taskId: string, dir: 'up' | 'down'): MoveResult | null {
  const loc = locate(layout, taskId);
  if (!loc) return null;
  const cur = layout[loc.slotIdx];

  if (dir === 'up') {
    if (loc.within > 0) {
      return { slotKey: cur.slotKey, kind: cur.kind, index: loc.within - 1, crossing: 'same-slot' };
    }
    // Top of its slot — move to the previous slot, inserting at its end.
    if (loc.slotIdx === 0) return null;
    const prev = layout[loc.slotIdx - 1];
    return { slotKey: prev.slotKey, kind: prev.kind, index: prev.taskIds.length, crossing: crossingFor(cur.kind, prev.kind) };
  }

  // dir === 'down'
  if (loc.within < cur.taskIds.length - 1) {
    return { slotKey: cur.slotKey, kind: cur.kind, index: loc.within + 1, crossing: 'same-slot' };
  }
  // Bottom of its slot — move to the next slot, inserting at its start.
  if (loc.slotIdx === layout.length - 1) return null;
  const next = layout[loc.slotIdx + 1];
  return { slotKey: next.slotKey, kind: next.kind, index: 0, crossing: crossingFor(cur.kind, next.kind) };
}

/** The slot key a day-jumped task lands in on the target day: same key if present, else unanchored. */
export function resolveDayJump(currentSlotKey: string, targetDaySlotKeys: string[]): string {
  return targetDaySlotKeys.includes(currentSlotKey) ? currentSlotKey : '<sched>';
}

/** Compose the aria-live message for a within-day move. */
export function describeMove(p: { crossing: Crossing; dir: 'up' | 'down'; targetLabel?: string; sourceLabel?: string }): string {
  switch (p.crossing) {
    case 'same-slot':   return p.dir === 'up' ? 'Moved up' : 'Moved down';
    case 'into-meal':   return `Moved into ${p.targetLabel}`;
    case 'out-of-meal': return `Moved out of ${p.sourceLabel}`;
    case 'to-slot':     return `Moved to ${p.targetLabel}`;
  }
}

/** Compose the aria-live message for a cross-day jump. */
export function describeDayJump(p: { dayLabel: string; targetLabel?: string }): string {
  return `Moved to ${p.dayLabel}, ${p.targetLabel ?? 'unanchored'}`;
}
