import { AppBootLoader } from "@/components/layout/AppBootLoader";
import { useAuth } from "@/contexts/AuthContext";
import { AuthenticatedRedirect } from "@/components/auth/AuthenticatedRedirect";
import type { ReactNode } from "react";

export function GuestRoute({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();

  if (loading) {
    return <AppBootLoader />;
  }

  if (session) {
    return <AuthenticatedRedirect />;
  }

  return children;
}
