import { Redirect } from "wouter";
import { Loader2 } from "lucide-react";
import { usePermissions, type Permissions } from "@/hooks/use-permissions";
import type { ReactNode } from "react";

/**
 * Gates a route behind a permission predicate — redirects to /dashboard if
 * the signed-in user's role doesn't pass. UI-only guard; the real security
 * boundary is the RLS policies added in
 * supabase/migrations/20260819000000_team_roles.sql, so a rejected page
 * can't be reached usefully anyway even if this were bypassed.
 */
export function PermissionRoute({
  require,
  children,
}: {
  require: (perms: Permissions) => boolean;
  children: ReactNode;
}) {
  const perms = usePermissions();

  if (perms.loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!require(perms)) {
    return <Redirect to="/dashboard" />;
  }

  return children;
}
