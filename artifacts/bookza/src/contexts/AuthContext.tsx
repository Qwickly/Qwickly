import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

export type SignUpProfile = {
  firstName: string;
  lastName: string;
  businessName: string;
  businessType: string;
  phone: string;
};

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (
    email: string,
    password: string,
    profile: SignUpProfile,
  ) => Promise<{ error: string | null; needsEmailConfirmation: boolean }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error: string | null }>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: current } }) => {
      setSession(current);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  }, []);

  const signUp = useCallback(
    async (email: string, password: string, profile: SignUpProfile) => {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          // Send the confirmation link back into the SPA (not the static
          // marketing home page, which is Supabase's default Site URL and
          // silently drops the auth token). Landing on /login lets supabase-js
          // parse the session from the URL, then GuestRoute forwards the now-
          // authenticated user into onboarding.
          emailRedirectTo: `${window.location.origin}/login`,
          data: {
            first_name: profile.firstName,
            last_name: profile.lastName,
            full_name: `${profile.firstName} ${profile.lastName}`.trim(),
            business_name: profile.businessName,
            business_type: profile.businessType,
            phone: profile.phone,
          },
        },
      });

      if (error) {
        return { error: error.message, needsEmailConfirmation: false };
      }

      if (data.session) {
        await supabase.rpc("ensure_my_business").catch(() => undefined);
      }

      return {
        error: null,
        needsEmailConfirmation: !data.session,
      };
    },
    [],
  );

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/login`,
    });
    return { error: error?.message ?? null };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      signIn,
      signUp,
      signOut,
      resetPassword,
    }),
    [session, loading, signIn, signUp, signOut, resetPassword],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
