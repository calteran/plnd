export interface ScheduleTypeResponse {
  type_id: string;
  user_id: string;
  name: string;
  days: number[];      // 0=Sun … 6=Sat, matches UserPreferences.week_start_day convention
  wake_time: string;   // "HH:MM"
  bed_time: string;    // "HH:MM"
  created_at: string;
  updated_at: string;
}

export interface CreateScheduleTypeRequest {
  name: string;
  days: number[];
  wake_time: string;
  bed_time: string;
}
