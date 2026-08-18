import type { ReactNode } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { LogOut } from "lucide-react";
import logo from "@/assets/Watermark-1.svg";

/**
 * Minimal top-bar shell for the staff self-service portal — deliberately not
 * the owner AppLayout/Sidebar (staff have exactly one page, no owner nav).
 */
export function StaffPortalShell({
  staffName,
  children,
}: {
  staffName?: string;
  children: ReactNode;
}) {
  const [, setLocation] = useLocation();

  const onLogout = async () => {
    await supabase.auth.signOut();
    setLocation("/staff-login");
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3 sm:px-6">
          <img src={logo} alt="Qwickly" className="h-7 w-auto" />
          <div className="flex items-center gap-3">
            {staffName && <span className="text-sm font-medium text-foreground">{staffName}</span>}
            <Button variant="ghost" size="sm" onClick={() => void onLogout()}>
              <LogOut className="mr-2 h-4 w-4" />
              Log out
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
