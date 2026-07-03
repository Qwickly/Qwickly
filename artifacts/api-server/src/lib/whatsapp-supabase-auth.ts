import { promises as fs } from "fs";
import path from "path";
import { getSupabaseAdmin } from "./supabase";

/**
 * Custom auth strategy for whatsapp-web.js that stores session data in Supabase
 * instead of the local filesystem. This fixes the persistence issue on Railway
 * where the container filesystem is ephemeral.
 */
export class SupabaseAuth {
  private clientId: string;
  private tenantId: string;

  constructor(clientId: string, tenantId: string) {
    this.clientId = clientId;
    this.tenantId = tenantId;
  }

  async afterBrowserInitialized(): Promise<void> {
    // No-op
  }

  async beforeBrowserInitialized(): Promise<void> {
    // No-op
  }

  async clear(): Promise<void> {
    const { error } = await getSupabaseAdmin()
      .from("whatsapp_sessions")
      .update({ session_data: null })
      .eq("tenant_id", this.tenantId);

    if (error) {
      throw new Error(`Failed to clear session data: ${error.message}`);
    }
  }

  async deleteToken(tokenName: string): Promise<void> {
    const { data: session } = await getSupabaseAdmin()
      .from("whatsapp_sessions")
      .select("session_data")
      .eq("tenant_id", this.tenantId)
      .single();

    if (session?.session_data && typeof session.session_data === "object") {
      delete (session.session_data as Record<string, unknown>)[tokenName];
      
      const { error } = await getSupabaseAdmin()
        .from("whatsapp_sessions")
        .update({ session_data: session.session_data })
        .eq("tenant_id", this.tenantId);

      if (error) {
        throw new Error(`Failed to delete token: ${error.message}`);
      }
    }
  }

  async extractCredentials(): Promise<{
    token: string;
    encKey: string;
  } | null> {
    const { data: session } = await getSupabaseAdmin()
      .from("whatsapp_sessions")
      .select("session_data")
      .eq("tenant_id", this.tenantId)
      .single();

    if (!session?.session_data || typeof session.session_data !== "object") {
      return null;
    }

    const sessionData = session.session_data as Record<string, unknown>;
    const token = sessionData["WAToken1"] as string | undefined;
    const encKey = sessionData["EncKey"] as string | undefined;

    if (!token || !encKey) {
      return null;
    }

    return { token, encKey };
  }

  async isAuthenticated(): Promise<boolean> {
    const credentials = await this.extractCredentials();
    return credentials !== null;
  }

  async removeDataPath(): Promise<void> {
    // No-op - we don't use a data path
  }

  async setCredentials(credentials: {
    token: string;
    encKey: string;
  }): Promise<void> {
    const { data: session } = await getSupabaseAdmin()
      .from("whatsapp_sessions")
      .select("session_data")
      .eq("tenant_id", this.tenantId)
      .single();

    const existingData = session?.session_data && typeof session.session_data === "object"
      ? session.session_data
      : {};

    const sessionData = {
      ...existingData,
      WAToken1: credentials.token,
      EncKey: credentials.encKey,
    };

    const { error } = await getSupabaseAdmin()
      .from("whatsapp_sessions")
      .update({ session_data: sessionData })
      .eq("tenant_id", this.tenantId);

    if (error) {
      throw new Error(`Failed to set credentials: ${error.message}`);
    }
  }

  async setToken(tokenName: string, tokenValue: string): Promise<void> {
    const { data: session } = await getSupabaseAdmin()
      .from("whatsapp_sessions")
      .select("session_data")
      .eq("tenant_id", this.tenantId)
      .single();

    const existingData = session?.session_data && typeof session.session_data === "object"
      ? session.session_data
      : {};

    const sessionData = {
      ...existingData,
      [tokenName]: tokenValue,
    };

    const { error } = await getSupabaseAdmin()
      .from("whatsapp_sessions")
      .update({ session_data: sessionData })
      .eq("tenant_id", this.tenantId);

    if (error) {
      throw new Error(`Failed to set token: ${error.message}`);
    }
  }

  async getToken(tokenName: string): Promise<string | null> {
    const { data: session } = await getSupabaseAdmin()
      .from("whatsapp_sessions")
      .select("session_data")
      .eq("tenant_id", this.tenantId)
      .single();

    if (!session?.session_data || typeof session.session_data !== "object") {
      return null;
    }

    const value = (session.session_data as Record<string, unknown>)[tokenName];
    return typeof value === "string" ? value : null;
  }
}
