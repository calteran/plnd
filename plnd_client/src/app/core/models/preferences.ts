export interface UserPreferences {
  user_id: string;
  week_start_day: number;          // 0=Sun … 6=Sat
  planning_trigger_offset: number; // signed days relative to plan_start
  default_plan_length_days: number; // 1–90
  wake_time: string;                // "HH:MM:SS" — used by Phase 5 push scheduler
  created_at: string;
  updated_at: string;
}

export interface UpdatePreferencesRequest {
  week_start_day?: number;
  planning_trigger_offset?: number;
  default_plan_length_days?: number;
}
