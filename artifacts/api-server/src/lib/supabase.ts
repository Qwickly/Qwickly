import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

function getEnv(name: string, fallbackName?: string): string {
  const value = process.env[name] ?? (fallbackName ? process.env[fallbackName] : undefined);
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${fallbackName ? `${name} (or ${fallbackName})` : name}`,
    );
  }
  return value;
}

let supabaseAdminClient: SupabaseClient | null = null;
let supabaseAuthClient: SupabaseClient | null = null;
let _testAdminClient: any = null;

/** FOR TESTING ONLY — inject a fake client. Call clearTestSupabaseAdmin() after each test. */
export function _setTestSupabaseAdmin(client: any): void { _testAdminClient = client; }
export function _clearTestSupabaseAdmin(): void { _testAdminClient = null; }

export function isSupabaseAdminConfigured(): boolean {
  const supabaseUrl = process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"];
  const supabaseServiceRoleKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];

  return Boolean(supabaseUrl && supabaseServiceRoleKey);
}

export function getSupabaseAdmin(): SupabaseClient {
  if (_testAdminClient) return _testAdminClient as SupabaseClient;
  if (!supabaseAdminClient) {
    const supabaseUrl = getEnv("SUPABASE_URL", "VITE_SUPABASE_URL");
    const supabaseServiceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");

    supabaseAdminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  return supabaseAdminClient;
}

function getSupabaseAuthClient(): SupabaseClient {
  if (!supabaseAuthClient) {
    const supabaseUrl = getEnv("SUPABASE_URL", "VITE_SUPABASE_URL");
    const supabaseAnonKey = getEnv("SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY");

    supabaseAuthClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  return supabaseAuthClient;
}

export async function getUserFromAccessToken(accessToken: string): Promise<User> {
  const { data, error } = await getSupabaseAuthClient().auth.getUser(accessToken);
  if (error || !data.user) {
    throw new Error("Unauthorized");
  }

  return data.user;
}

export type AdminClient = SupabaseClient;
