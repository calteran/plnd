// Aligned with backend MealPatternEntryResponse.
// `name` is open text — no closed type constraint.

export interface MealPatternEntry {
  id: string;
  user_id: string;
  name: string;
  preferred_time: string;   // "HH:MM:SS" from Postgres; use preferredTimeHHMM() to display
  tolerance_minutes: number;
  sort_order: number;
  created_at: string;
}

export interface CreateMealPatternEntryRequest {
  name: string;
  preferred_time: string;   // "HH:MM"
  tolerance_minutes?: number;
  sort_order: number;
}

export interface UpdateMealPatternEntryRequest {
  name?: string;
  preferred_time?: string;
  tolerance_minutes?: number;
  sort_order?: number;
}

/** Extracts "HH:MM" from a Postgres TIME string like "08:00:00". */
export function preferredTimeHHMM(t: string): string {
  return t.slice(0, 5);
}
