export type Theme = 'system' | 'light' | 'dark';

export interface UserPreferences {
  user_id: string;
  theme: Theme;
  created_at: string;
  updated_at: string;
}

export interface UpdatePreferencesRequest {
  theme?: Theme;
}
