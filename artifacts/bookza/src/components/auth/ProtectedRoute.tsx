import { Redirect } from "wouter";
import { AppBootLoader } from "@/components/layout/AppBootLoader";
import { useAuth } from "@/contexts/AuthContext";
import type { ReactNode } from "react";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();

  if (loading) {
    // The same loader index.html painted before the bundle arrived — this is
    // the render that replaces it, so anything else here reads as a glitch.
    return <AppBootLoader label="Signing you in" />;
  }

  if (!session) {
    return <Redirect to="/login" />;
  }

  return children;
}
