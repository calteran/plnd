export interface User {
  user_id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
  is_active: boolean;
  last_login: string | null;
}

export interface UpdateProfileRequest {
  display_name?: string;
  avatar_url?: string;
}
