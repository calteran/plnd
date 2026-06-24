import { PlannedTask } from '../models/week-plan';

/** Sentinel slot key for tasks not paired with any anchor or meal. */
export const UNANCHORED_SLOT = '<sched>';

/**
 * Raw slot key for a task — `paired_meal_name ?? after_anchor ?? '<sched>'` — in its
 * original (display) casing. Use this ONLY when storing or emitting the value (e.g.
 * `paired_meal_name`/`after_anchor` on a commit request), never for comparison.
 *
 * Production meal names are Capitalized ('Breakfast'/'Lunch'/'Dinner') while the
 * place_tasks agent echoes anchor labels with unenforced casing, so a raw-vs-raw
 * comparison can silently drift. For any comparison use {@link slotMatchKey} /
 * {@link slotKeysMatch} instead (issue #1005).
 */
export function rawSlotKey(task: Pick<PlannedTask, 'paired_meal_name' | 'after_anchor'>): string {
  return task.paired_meal_name ?? task.after_anchor ?? UNANCHORED_SLOT;
}

/**
 * Case-insensitive match key for a task's slot. ALWAYS derive comparison keys through
 * this (or {@link slotKeysMatch}) so drifted casing coalesces into one logical slot.
 */
export function slotMatchKey(task: Pick<PlannedTask, 'paired_meal_name' | 'after_anchor'>): string {
  return rawSlotKey(task).toLowerCase();
}

/** True when `task` belongs to the slot identified by `slotKey` (case-insensitive). */
export function slotKeysMatch(task: Pick<PlannedTask, 'paired_meal_name' | 'after_anchor'>, slotKey: string): boolean {
  return slotMatchKey(task) === slotKey.toLowerCase();
}
