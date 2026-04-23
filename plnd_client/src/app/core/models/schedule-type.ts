// Aligned with backend issue #516.
export interface ScheduleTypeResponse {
  id: string;
  user_id: string;
  name: string;
  days_bitmask: number; // bit 0=Sun, bit 1=Mon, …, bit 6=Sat
  wake_time: string;    // "HH:MM:SS"
  bed_time: string;     // "HH:MM:SS"
  is_cycle: boolean;
  cycle_length: number | null; // days
  anchor_date: string | null;  // ISO date or null
  created_at: string;
}

export interface CreateScheduleTypeRequest {
  name: string;
  days_bitmask: number; // bit 0=Sun, bit 1=Mon, …, bit 6=Sat
  wake_time: string;    // "HH:MM"
  bed_time: string;     // "HH:MM"
  is_cycle: boolean;
  cycle_length: number | null; // days
  anchor_date: string | null;  // ISO date or null
}
