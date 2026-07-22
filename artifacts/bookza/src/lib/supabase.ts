import { createClient } from "@supabase/supabase-js";

type RuntimeEnv = Record<string, string | undefined>;

const runtimeEnv = (window as Window & { __ENV__?: RuntimeEnv }).__ENV__ ?? {};
const runtimeSupabaseUrl = runtimeEnv.VITE_SUPABASE_URL;
const runtimeSupabaseAnonKey = runtimeEnv.VITE_SUPABASE_ANON_KEY;

const supabaseUrl = runtimeSupabaseUrl || import.meta.env.VITE_SUPABASE_URL || "https://placeholder.supabase.co";
const supabaseAnonKey = runtimeSupabaseAnonKey || import.meta.env.VITE_SUPABASE_ANON_KEY || "placeholder-anon-key";

if (!runtimeSupabaseUrl || !runtimeSupabaseAnonKey) {
  console.warn("Supabase runtime env vars were not provided. Falling back to placeholder values so the app can still render.");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});
