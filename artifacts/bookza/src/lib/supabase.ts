import { createClient } from "@supabase/supabase-js";

type RuntimeEnv = Record<string, string | undefined>;

const FALLBACK_SUPABASE_URL = "https://kzfixfcatknkkqttnvvi.supabase.co";
const FALLBACK_SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt6Zml4ZmNhdGtua2txdHRudnZpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExODQ5MDYsImV4cCI6MjA5Njc2MDkwNn0.NFJOSWvOstCMEgQw0BBD1IV4kZLrfdoKO2RY3Qi6g8w";

const runtimeEnv = (window as Window & { __ENV__?: RuntimeEnv }).__ENV__ ?? {};
const runtimeSupabaseUrl = runtimeEnv.VITE_SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL || FALLBACK_SUPABASE_URL;
const runtimeSupabaseAnonKey = runtimeEnv.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || FALLBACK_SUPABASE_ANON_KEY;

if (!runtimeEnv.VITE_SUPABASE_URL || !runtimeEnv.VITE_SUPABASE_ANON_KEY) {
  console.warn("Supabase runtime env vars were not provided. Falling back to the project defaults so the app can still render.");
}

export const supabaseUrl = runtimeSupabaseUrl;
export const supabaseAnonKey = runtimeSupabaseAnonKey;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: window.localStorage,
  },
});
