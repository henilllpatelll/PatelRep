import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import "react-native-url-polyfill/auto";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

export type UserRole =
  | "housekeeper"
  | "engineer"
  | "housekeeping_supervisor"
  | "chief_engineer"
  | "front_desk"
  | "gm";

export interface UserProfile {
  id: string;
  hotel_id: string;
  role: UserRole;
  full_name: string;
  preferred_language: "en" | "es";
  expo_push_token?: string;
}
