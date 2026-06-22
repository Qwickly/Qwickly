import { Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { AuthenticatedRedirect } from "@/components/auth/AuthenticatedRedirect";
import type { ReactNode } from "react";

export function GuestRoute({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (session) {
    return <AuthenticatedRedirect />;
  }

  return children;
}
