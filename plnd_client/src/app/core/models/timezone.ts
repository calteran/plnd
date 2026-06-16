// Wire DTOs for the timezone endpoints (#929/#930). zone is an IANA name.
export type TimezoneSource = 'device' | 'user' | 'inferred';

export interface TimezoneAnchorDto {
  id: string;
  user_id: string;
  effective_date: string;          // YYYY-MM-DD
  effective_time: string | null;   // "HH:MM:SS" or null (whole-day)
  zone: string;                    // IANA, e.g. "America/Denver"
  source: TimezoneSource;
  source_ref: string | null;
  /** Human title of the originating task (resolved from `source_ref`), or null
   *  when there is no source or the referenced task no longer exists. Drives the
   *  inferred-anchor provenance line in the `(why?)` popover. */
  source_title: string | null;
  inference_group: string | null;
  created_at: string;
  updated_at: string;
}

export interface ResolveResponse { zone: string | null; }

export type DeviceAffirmOutcome = 'no_change' | 'appended' | 'recording' | 'standoff';

export interface StandoffConfirm { intended_zone: string; device_zone: string; }

export interface DeviceAffirmResponse {
  outcome: DeviceAffirmOutcome;
  effective_zone: string | null;
  confirm: StandoffConfirm | null;
}

export interface CreateAnchorRequest {
  effective_date: string;           // YYYY-MM-DD
  effective_time?: string | null;   // "HH:MM" optional
  zone: string;                     // IANA
  source_ref?: string | null;
  inference_group?: string | null;
}
