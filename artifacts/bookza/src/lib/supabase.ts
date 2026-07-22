import { createClient } from "@supabase/supabase-js";

type RuntimeEnv = {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
};

const runtimeEnv = (window as Window & { __ENV__?: RuntimeEnv }).__ENV__ ?? {};
const runtimeSupabaseUrl = runtimeEnv.VITE_SUPABASE_URL || runtimeEnv.SUPABASE_URL;
const runtimeSupabaseAnonKey = runtimeEnv.VITE_SUPABASE_ANON_KEY || runtimeEnv.SUPABASE_ANON_KEY;

export const supabaseUrl = runtimeSupabaseUrl || import.meta.env.VITE_SUPABASE_URL || import.meta.env.SUPABASE_URL || "https://placeholder.supabase.co";
export const supabaseAnonKey = runtimeSupabaseAnonKey || import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.SUPABASE_ANON_KEY || "placeholder-anon-key";

if (!runtimeSupabaseUrl || !runtimeSupabaseAnonKey) {
  console.warn("Supabase runtime env vars were not provided. Falling back to build-time or placeholder values.");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});
