export type TaskType = 'meal' | 'exercise' | 'work' | 'leisure' | 'appointment' | 'medication' | 'general';
export type RecurrenceType = 'daily' | 'weekdays' | 'weekly' | 'custom';
export type EnergyLevel = 'low' | 'medium' | 'high';

export interface ScheduleTemplate {
  template_id: string;
  user_id: string;
  task_type: TaskType;
  title: string;
  recurrence: RecurrenceType;
  recurrence_rule: string | null;
  time_window_start: string | null;
  time_window_end: string | null;
  duration_minutes: number | null;
  energy_required: EnergyLevel;
  is_milepost: boolean;
  task_ref_id: string | null;
  task_ref_type: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateScheduleTemplateRequest {
  task_type: TaskType;
  title: string;
  recurrence: RecurrenceType;
  recurrence_rule?: string;
  time_window_start?: string;
  time_window_end?: string;
  duration_minutes?: number;
  energy_required?: EnergyLevel;
  is_milepost?: boolean;
  task_ref_id?: string;
  task_ref_type?: string;
}

export interface UpdateScheduleTemplateRequest {
  title: string;
  recurrence: RecurrenceType;
  recurrence_rule?: string;
  time_window_start?: string;
  time_window_end?: string;
  duration_minutes?: number;
  energy_required?: EnergyLevel;
  is_milepost?: boolean;
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
  weekDay?: number,
  customRule?: string
): string {
  switch (recurrence) {
    case 'daily':    return 'FREQ=DAILY';
    case 'weekdays': return 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR';
    case 'weekly': { const day = RRULE_DAYS[weekDay ?? 1] ?? 'MO'; return `FREQ=WEEKLY;BYDAY=${day}`; }
    case 'custom':   return customRule ?? '';
    default:         return '';
  }
}
