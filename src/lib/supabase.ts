import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type Screenshot = {
  id: string;
  user_id: string;
  file_name: string;
  file_size: number;
  file_type: string;
  width: number | null;
  height: number | null;
  storage_path: string;
  thumbnail_path: string | null;
  ocr_text: string | null;
  ocr_confidence: number | null;
  ai_description: string | null;
  ai_tags: string[];
  custom_tags: string[];
  user_notes: string;
  is_favorite: boolean;
  is_archived: boolean;
  folder_id: string | null;
  source: string;
  view_count: number;
  created_at: string;
  updated_at: string;
};

export type Folder = {
  id: string;
  user_id: string;
  name: string;
  parent_id: string | null;
  color: string;
  icon: string;
  screenshot_count: number;
  created_at: string;
};

export type UserExtended = {
  id: string;
  plan: 'free' | 'pro' | 'team' | 'enterprise';
  storage_used: number;
  storage_limit: number;
  screenshot_count: number;
  onboarding_completed: boolean;
  preferences: Record<string, any>;
  stripe_customer_id: string | null;
  created_at: string;
  updated_at: string;
};
