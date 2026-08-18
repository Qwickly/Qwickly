import { supabase } from "@/lib/supabase";

export type TeamRole = "owner" | "admin" | "user" | "viewer";

export type TeamMembership = {
  id: string;
  businessId: string;
  name: string;
  role: TeamRole;
};

/**
 * Resolves the current session's team_members row, if any. Returns null for
 * the literal business owner (who has no team_members row of their own) and
 * for anyone with no membership at all. Mirrors fetchMyStaffMembership in
 * lib/staff-portal.ts, but for the main-app team roles rather than the
 * narrow bookable-staff portal.
 */
export async function fetchMyTeamMembership(userId: string): Promise<TeamMembership | null> {
  const { data, error } = await supabase
    .from("team_members")
    .select("id, business_id, name, role")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  return {
    id: data.id as string,
    businessId: data.business_id as string,
    name: data.name as string,
    role: data.role as TeamRole,
  };
}
