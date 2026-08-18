import { Redirect } from "wouter";
import { Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { fetchMyStaffMembership } from "@/lib/staff-portal";
import type { ReactNode } from "react";

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
    </div>
  );
}

export function StaffProtectedRoute({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  const userId = session?.user.id;

  const { data: membership, isLoading: membershipLoading } = useQuery({
    queryKey: ["staff-membership", userId],
    queryFn: () => fetchMyStaffMembership(userId!),
    enabled: Boolean(userId),
  });

  if (loading || (userId && membershipLoading)) {
    return <LoadingScreen />;
  }

  if (!session || !membership) {
    return <Redirect to="/staff-login" />;
  }

  return children;
}
