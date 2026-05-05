export type TaskType = 'meal' | 'exercise' | 'work' | 'leisure' | 'appointment' | 'medication' | 'general';
export type RecurrenceType = 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly';
export type EnergyLevel = 'low' | 'medium' | 'high';

export interface Routine {
  routine_id: string;
  user_id: string;
  task_type: TaskType;
  title: string;
  recurrence_tag: string | null;
  recurrence_rule: string;
  time_window_start: string | null;
  time_window_end: string | null;
  duration_minutes: number | null;
  energy_required: EnergyLevel;
  is_anchor: boolean;
  task_ref_id: string | null;
  task_ref_type: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateRoutineRequest {
  task_type: TaskType;
  title: string;
  recurrence_rule: string;
  recurrence_tag?: RecurrenceType;
  time_window_start?: string;
  time_window_end?: string;
  duration_minutes?: number;
  energy_required?: EnergyLevel;
  is_anchor?: boolean;
  task_ref_id?: string;
  task_ref_type?: string;
}

export interface UpdateRoutineRequest {
  title: string;
  recurrence_rule: string;
  recurrence_tag?: RecurrenceType;
  time_window_start?: string;
  time_window_end?: string;
  duration_minutes?: number;
  energy_required?: EnergyLevel;
  is_anchor?: boolean;
  task_ref_id?: string;
  task_ref_type?: string;
}

const RRULE_DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/**
 * Translates a recurrence type to an RRULE string for storage in recurrence_rule.
 * weekDay uses the same 0=Sun…6=Sat convention as UserPreferences.week_start_day.
 */
export function rruleFromRecurrence(
  recurrence: RecurrenceType,
  weekDay?: number
): string {
  switch (recurrence) {
    case 'daily':    return 'FREQ=DAILY';
    case 'weekdays': return 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR';
    case 'weekly': { const day = RRULE_DAYS[weekDay ?? 1] ?? 'MO'; return `FREQ=WEEKLY;BYDAY=${day}`; }
    case 'monthly':  return 'FREQ=MONTHLY';
    case 'yearly':   return 'FREQ=YEARLY';
    default:         return '';
  }
}

/**
 * Derives a RecurrenceType tag from a canonical RRULE string.
 * Returns null for complex RRULEs that don't match any curated tag.
 */
export function recurrenceTagFromRrule(rrule: string): RecurrenceType | null {
  if (rrule === 'FREQ=DAILY') return 'daily';
  if (rrule === 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR') return 'weekdays';
  if (rrule === 'FREQ=MONTHLY') return 'monthly';
  if (rrule === 'FREQ=YEARLY') return 'yearly';
  if (rrule.startsWith('FREQ=WEEKLY')) return 'weekly';
  return null;
}
