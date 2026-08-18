import { Redirect } from "wouter";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import type { ReactNode } from "react";

/** Requires only a live session (no staff-membership check) — used for
 * /staff/set-password, reached right after staff-login.tsx already verified
 * membership. */
export function StaffSessionRoute({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!session) {
    return <Redirect to="/staff-login" />;
  }

  return children;
}
