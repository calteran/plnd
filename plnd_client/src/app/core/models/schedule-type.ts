// Frontend-first model anticipating backend issue #516.
// Fields reflect the UI spec; align with backend response shape when #516 ships.
// wake_time / bed_time format: expect "HH:MM:SS" to match UserPreferences.wake_time convention,
// but confirm against actual backend response once #516 is implemented.
export interface ScheduleTypeResponse {
  type_id: string;
  user_id: string;
  name: string;
  days: number[];        // 0=Sun … 6=Sat, matches UserPreferences.week_start_day convention
  wake_time: string;     // "HH:MM:SS" (PostgreSQL TIME — confirm with #516)
  bed_time: string;      // "HH:MM:SS" (PostgreSQL TIME — confirm with #516)
  created_at: string;
  updated_at: string;
}

export interface CreateScheduleTypeRequest {
  name: string;
  days: number[];
  wake_time: string;
  bed_time: string;
}
