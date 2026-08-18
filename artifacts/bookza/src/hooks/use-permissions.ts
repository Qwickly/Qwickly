import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { fetchMyTeamMembership, type TeamRole } from "@/lib/team-portal";

export type Permissions = {
  role: TeamRole;
  loading: boolean;
  canManageTeam: boolean;
  canManageSettings: boolean;
  canManageStaff: boolean;
  canViewPayments: boolean;
  canViewAnalytics: boolean;
  canWriteBookings: boolean;
  canWriteClients: boolean;
  isReadOnly: boolean;
};

/**
 * What the current signed-in user is allowed to see/do. The literal business
 * owner (no team_members row) gets everything. Restricted roles come from
 * team_members.role — see supabase/migrations/20260819000000_team_roles.sql
 * for the matching RLS enforcement; this hook only drives the UI (nav/route
 * gating), it is not itself a security boundary.
 */
export function usePermissions(): Permissions {
  const { user } = useAuth();

  const { data: membership, isLoading } = useQuery({
    queryKey: ["team-membership", user?.id],
    queryFn: () => fetchMyTeamMembership(user!.id),
    enabled: Boolean(user?.id),
    staleTime: 60_000,
  });

  const role: TeamRole = membership?.role ?? "owner";

  const isOwner = role === "owner";
  const isAdmin = role === "admin";
  const isUser = role === "user";
  const isViewer = role === "viewer";

  return {
    role,
    loading: isLoading,
    canManageTeam: isOwner,
    canManageSettings: isOwner || isAdmin,
    canManageStaff: isOwner || isAdmin,
    canViewPayments: isOwner || isAdmin || isViewer,
    canViewAnalytics: isOwner || isAdmin || isViewer,
    canWriteBookings: isOwner || isAdmin || isUser,
    canWriteClients: isOwner || isAdmin || isUser,
    isReadOnly: isViewer,
  };
}
