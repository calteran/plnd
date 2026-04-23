// Aligned with backend issue #516. Bitmask: bit 0=Sun, bit 1=Mon, …, bit 6=Sat.
export interface ScheduleTypeResponse {
  id: string;
  user_id: string;
  name: string;
  days_bitmask: number;
  wake_time: string;    // "HH:MM:SS"
  bed_time: string;     // "HH:MM:SS"
  is_cycle: boolean;
  cycle_length: number | null;
  anchor_date: string | null; // ISO date or null
  created_at: string;
}

export interface CreateScheduleTypeRequest {
  name: string;
  days_bitmask: number;
  wake_time: string;    // "HH:MM" — backend accepts HH:MM format
  bed_time: string;     // "HH:MM"
  is_cycle: boolean;
  cycle_length: number | null;
  anchor_date: string | null; // ISO date or null
}
