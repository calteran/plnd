export interface DayTypeResponse {
  id: string;
  user_id: string;
  name: string;
  days_bitmask: number; // bit 0=Sun, bit 1=Mon, …, bit 6=Sat; 0 for cycle types
  wake_time: string;    // "HH:MM:SS"
  sleep_time: string;   // "HH:MM:SS"
  is_default: boolean;
  is_cycle: boolean;
  cycle_length: number | null;
  anchor_date: string | null;
  created_at: string;
}

export interface CreateDayTypeRequest {
  name: string;
  days_bitmask: number;
  wake_time: string;    // "HH:MM"
  sleep_time: string;   // "HH:MM"
  is_cycle: boolean;
  cycle_length: number | null;
  anchor_date: string | null;
}

// Legacy type aliases — removed in Task 8 once all consumers are updated
/** @deprecated Use DayTypeResponse */
export type ScheduleTypeResponse = DayTypeResponse;
/** @deprecated Use CreateDayTypeRequest */
export type CreateScheduleTypeRequest = CreateDayTypeRequest;
