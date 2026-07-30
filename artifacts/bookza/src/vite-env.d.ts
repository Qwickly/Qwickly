/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_SUPABASE_WHATSAPP_SEND_MESSAGE_URL: string;
  readonly VITE_AUTH_REDIRECT_ORIGIN?: string;
  readonly AUTH_REDIRECT_ORIGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
