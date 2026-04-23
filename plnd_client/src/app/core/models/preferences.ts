export interface UserPreferences {
  user_id: string;
  week_start_day: number;          // 0=Sun … 6=Sat
  planning_trigger_offset: number; // signed days relative to plan_start
  default_plan_length_days: number; // 1–90
  wake_time: string;                // "HH:MM:SS" — used by Phase 5 push scheduler
  planning_time?: string;           // "HH:MM:SS" — weekly planning reminder time
  breakfast_window_start?: string;  // "HH:MM:SS"
  breakfast_window_end?: string;
  lunch_window_start?: string;
  lunch_window_end?: string;
  dinner_window_start?: string;
  dinner_window_end?: string;
  email_notifications_enabled: boolean;
  sms_notifications_enabled: boolean;
  push_notifications_enabled: boolean;
  phone_number: string | null;
  created_at: string;
  updated_at: string;
}

export interface UpdatePreferencesRequest {
  week_start_day?: number;
  planning_trigger_offset?: number;
  default_plan_length_days?: number;
  wake_time?: string;
  planning_time?: string;
  breakfast_window_start?: string;
  breakfast_window_end?: string;
  lunch_window_start?: string;
  lunch_window_end?: string;
  dinner_window_start?: string;
  dinner_window_end?: string;
  email_notifications_enabled?: boolean;
  sms_notifications_enabled?: boolean;
  push_notifications_enabled?: boolean;
  phone_number?: string | null;
}
