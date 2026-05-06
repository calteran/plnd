export interface UserPreferences {
  user_id: string;
  week_start_day: number;          // 0=Sun … 6=Sat
  planning_trigger_offset: number; // signed days relative to plan_start
  default_plan_length_days: number; // 1–90
  planning_time?: string;          // "HH:MM:SS" — weekly planning reminder time
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
  planning_time?: string;
  email_notifications_enabled?: boolean;
  sms_notifications_enabled?: boolean;
  push_notifications_enabled?: boolean;
  phone_number?: string | null;
}
