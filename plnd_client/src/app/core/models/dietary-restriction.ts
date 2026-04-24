export type RestrictionType = 'allergy' | 'intolerance' | 'preference' | 'cultural_religious';

export const RESTRICTION_TYPES: RestrictionType[] = ['allergy', 'intolerance', 'preference', 'cultural_religious'];

export interface DietaryRestriction {
  restriction_id: string;
  user_id: string;
  restriction_type: RestrictionType;
  name: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateRestrictionRequest {
  restriction_type: RestrictionType;
  name: string;
  notes?: string;
}

export interface UpdateRestrictionRequest {
  notes: string | null;
}
