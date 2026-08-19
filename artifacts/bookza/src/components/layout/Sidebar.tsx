import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  Calendar as CalendarIcon,
  Users,
  UserSquare2,
  Scissors,
  Settings,
  LineChart,
  MessageCircle,
  Wallet,
  Megaphone,
  MonitorSmartphone,
  Bot,
  LogOut,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Lock,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { NAV_SHADOW, NAV_SURFACE_VERTICAL, brandNav } from "@/lib/brand";
import { useSidebar } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Sheet, SheetContent, SheetHeader, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useAuth } from "@/contexts/AuthContext";
import { useEntitlements } from "@/hooks/use-entitlements";
import { usePermissions, type Permissions } from "@/hooks/use-permissions";
import logo from "@/assets/qwickly-icon.svg";

type NavChild = { label: string; href: string };
type NavItem = {
  icon: LucideIcon;
  label: string;
  href: string;
  children?: NavChild[];
  /** Omit for items every role can see (Dashboard/Calendar/Bookings/Clients). */
  show?: (perms: Permissions) => boolean;
};

const navItems: NavItem[] = [
  { icon: LayoutDashboard, label: "Dashboard", href: "/dashboard" },
  { icon: CalendarIcon, label: "Calendar", href: "/calendar" },
  { icon: Users, label: "Bookings", href: "/bookings" },
  { icon: UserSquare2, label: "Clients", href: "/clients" },
  { icon: Scissors, label: "Services", href: "/services", show: (p) => p.canManageSettings },
  { icon: Users, label: "Staff", href: "/staff", show: (p) => p.canManageStaff },
  { icon: Wallet, label: "Payments", href: "/payments", show: (p) => p.canViewPayments },
  { icon: LineChart, label: "Analytics", href: "/analytics", show: (p) => p.canViewAnalytics },
  {
    icon: MessageCircle,
    label: "WhatsApp",
    href: "/whatsapp",
    show: (p) => p.canManageSettings,
    children: [
      { label: "Inbox", href: "/whatsapp" },
      { label: "Bot Setup", href: "/whatsapp/bot" },
    ],
  },
  { icon: Megaphone, label: "Marketing", href: "/marketing", show: (p) => p.canManageSettings },
  { icon: MonitorSmartphone, label: "Booking Page", href: "/booking-page", show: (p) => p.canManageSettings },
  { icon: Bot, label: "AI Assistant", href: "/ai-assistant", show: (p) => p.canManageSettings },
];

/*
 * The footer carries the same `show` predicates as the nav above, rather than
 * the inline `perms.canManageSettings &&` / `perms.role === "owner"` guards the
 * team-roles branch wrote at each JSX call site. Same rules, declared where the
 * items are declared — which is the only place someone adding a fourth footer
 * item will look.
 */
const footerItems: NavItem[] = [
  { icon: Sparkles, label: "Getting started", href: "/get-started" },
  { icon: Settings, label: "Settings", href: "/settings", show: (p) => p.canManageSettings },
  { icon: Wallet, label: "Billing", href: "/billing", show: (p) => p.role === "owner" },
];

/**
 * The collapsed rail shows icons only.
 *
 * Every piece takes this as a prop rather than reading shared state, so the
 * mobile sheet — which renders the same components inside a drawer that is
 * already a disclosure — simply never passes it and stays as it was.
 */
type Collapsible = { collapsed?: boolean };

/**
 * Wraps a rail control in the tooltip that restores its label, and gets out of
 * the way when the sidebar is open and the label is already on screen.
 *
 * Written as one helper because the alternative — a ternary at each of the
 * fifteen call sites — is where the two that were missed would hide.
 */
function RailLabel({
  collapsed,
  label,
  children,
}: Collapsible & { label: string; children: ReactNode }) {
  if (!collapsed) return <>{children}</>;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" className={brandNav.tooltip}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function SidebarBrand({ collapsed = false }: Collapsible) {
  return (
    <Link
      href="/dashboard"
      aria-label="Qwickly — dashboard"
      className={cn(
        "flex shrink-0 items-center gap-2.5",
        collapsed ? "justify-center px-2 py-4" : "px-4 py-5",
      )}
    >
      {/* The mark ships in the brand green, which has next to no separation
          from the green lobe it now sits on. White, as in the marketing nav. */}
      <img src={logo} alt="" className="h-7 w-auto shrink-0 brightness-0 invert" />
      {!collapsed && (
        <span className="text-base font-bold tracking-tight text-foreground">Qwickly</span>
      )}
    </Link>
  );
}

function SidebarNav({
  onNavigate,
  collapsed = false,
  setupLocked,
  size = "desktop",
}: Collapsible & {
  onNavigate?: () => void;
  setupLocked: boolean;
  size?: "desktop" | "mobile";
}) {
  const [location] = useLocation();
  // Shared react-query cache keyed on the user id, so calling this here and in
  // SidebarFooter is one request, not two.
  const perms = usePermissions();
  const visibleNavItems = navItems.filter((item) => !item.show || item.show(perms));

  const whatsappActive = location === "/whatsapp" || location.startsWith("/whatsapp/");
  const [whatsappOpen, setWhatsappOpen] = useState(whatsappActive);

  // Auto-expand the group when you navigate into the WhatsApp area (never
  // force-closes).
  useEffect(() => {
    if (whatsappActive) setWhatsappOpen(true);
  }, [whatsappActive]);

  const sizes =
    size === "desktop"
      ? { item: "py-2 text-sm", icon: "h-4 w-4", child: "py-1.5 text-sm" }
      : { item: "py-2.5 text-base", icon: "h-5 w-5", child: "py-2 text-base" };

  // Pills, like the marketing nav's links — its `border-radius: 999px` reads as
  // a rail of tablets at sidebar proportions.
  const base = "flex w-full cursor-pointer items-center rounded-full transition-colors";
  const row = collapsed ? "justify-center px-2" : "gap-2.5 px-3.5";

  if (setupLocked) {
    return (
      <nav className={cn("flex flex-1 flex-col pb-3", collapsed ? "px-1.5" : "px-2.5")}>
        <RailLabel collapsed={collapsed} label="Setup locked — start your free trial">
          <div
            className={cn(
              "rounded-2xl border border-foreground/12 bg-foreground/[0.06]",
              collapsed ? "grid h-10 place-items-center" : "p-4",
            )}
          >
            <div
              className={cn(
                "flex items-center gap-2 text-sm font-semibold text-foreground",
                collapsed && "gap-0",
              )}
            >
              <Lock className="h-4 w-4 shrink-0" />
              {!collapsed && "Setup locked"}
            </div>
            {!collapsed && (
              <p className="mt-2 text-xs leading-relaxed text-foreground/60">
                Start your free trial to unlock the dashboard, bookings, clients, services, and
                team tools.
              </p>
            )}
          </div>
        </RailLabel>
      </nav>
    );
  }

  return (
    // Flex with `gap`, not `space-y-*`: wouter renders each link as a bare
    // `<a>`, which is inline, and vertical margins do not apply to inline
    // boxes — the spacing was silently dropped and the pills sat edge to edge.
    // Flex items are blockified, so `gap` lands.
    <nav
      className={cn(
        // `sidebar-scroll` (index.css) overrides the app-wide scrollbar, which
        // is a 10px bar with a solid `--primary` thumb — a fat green stripe
        // down a green gradient. Here it is a 6px translucent white thumb on no
        // track at all.
        "sidebar-scroll flex flex-1 flex-col gap-0.5 overflow-y-auto pb-3",
        collapsed ? "px-1.5" : "px-2.5",
      )}
    >
      {visibleNavItems.map((item) => {
        const Icon = item.icon;
        // A section stays marked while you are anywhere inside it, not only on
        // its index — `/clients/:id` and `/staff/:id` are children of a nav
        // item rather than nav items themselves, and under an exact match
        // opening one silently unhighlights the whole rail.
        const isActive = location === item.href || location.startsWith(item.href + "/");

        // Collapsed, a disclosure has nowhere to disclose into: the children
        // would need labels the rail has no room for. The group degrades to the
        // plain link its parent href already points at.
        if (item.children && !collapsed) {
          return (
            <div key={item.href}>
              <div
                role="button"
                tabIndex={0}
                aria-expanded={whatsappOpen}
                onClick={() => setWhatsappOpen((open) => !open)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setWhatsappOpen((open) => !open);
                  }
                }}
                className={cn(base, row, sizes.item, brandNav.link)}
              >
                <Icon className={cn(sizes.icon, "shrink-0")} />
                <span className="flex-1 text-left">{item.label}</span>
                <ChevronDown
                  className={cn(
                    "h-4 w-4 shrink-0 transition-transform duration-200 ease-out",
                    whatsappOpen && "rotate-180",
                  )}
                />
              </div>
              <div
                className={cn(
                  "grid transition-[grid-template-rows,opacity] duration-200 ease-out",
                  whatsappOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
                )}
              >
                <div className="min-h-0 overflow-hidden">
                  <div className="mt-1 flex flex-col gap-1">
                    {item.children.map((child) => {
                      const active = location === child.href;
                      return (
                        <Link key={child.href} href={child.href}>
                          <div
                            onClick={onNavigate}
                            className={cn(
                              base,
                              sizes.child,
                              size === "desktop" ? "pl-10 pr-3.5" : "pl-11 pr-3.5",
                              brandNav.link,
                              active && brandNav.linkActive,
                            )}
                          >
                            {child.label}
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          );
        }

        return (
          <RailLabel key={item.href} collapsed={collapsed} label={item.label}>
            <Link
              href={item.href}
              // Collapsed, the icon is all that is left, so the link would
              // otherwise reach a screen reader unnamed. This sits on the Link
              // because wouter spreads it onto the underlying anchor; a label on
              // the inner div would be naming the wrong element. A tooltip is
              // not an accessible name and does not cover this.
              aria-label={collapsed ? item.label : undefined}
            >
              <div
                onClick={onNavigate}
                className={cn(
                  base,
                  row,
                  sizes.item,
                  brandNav.link,
                  isActive && brandNav.linkActive,
                )}
              >
                <Icon className={cn(sizes.icon, "shrink-0")} />
                {!collapsed && item.label}
              </div>
            </Link>
          </RailLabel>
        );
      })}
    </nav>
  );
}

function SidebarFooter({
  collapsed = false,
  onNavigate,
  setupLocked,
  onSignedOut,
  size = "desktop",
}: Collapsible & {
  onNavigate?: () => void;
  setupLocked: boolean;
  onSignedOut?: () => void;
  size?: "desktop" | "mobile";
}) {
  const [location, setLocation] = useLocation();
  const { signOut, user } = useAuth();
  const perms = usePermissions();

  const handleSignOut = async () => {
    await signOut();
    onSignedOut?.();
    setLocation("/login");
  };

  const sizes =
    size === "desktop"
      ? { item: "py-2 text-sm", icon: "h-4 w-4" }
      : { item: "py-2.5 text-base", icon: "h-5 w-5" };

  const base = "flex w-full cursor-pointer items-center rounded-full transition-colors";
  const row = collapsed ? "justify-center px-2" : "gap-2.5 px-3.5";

  return (
    <div
      className={cn(
        "mt-auto flex shrink-0 flex-col gap-0.5 border-t border-foreground/12",
        collapsed ? "p-1.5" : "p-2.5",
      )}
    >
      {footerItems.map((item) => {
        // Two independent reasons to hide a row, and they are not the same
        // thing: `show` is about what this role is ever allowed to reach,
        // `setupLocked` is about what is reachable before the trial starts.
        // Settings is the one page the locked state hides — Getting started and
        // Billing are how you get out of that state.
        if (item.show && !item.show(perms)) return null;
        if (setupLocked && item.href === "/settings") return null;

        const Icon = item.icon;
        const isActive = location === item.href;

        return (
          <RailLabel key={item.href} collapsed={collapsed} label={item.label}>
            <Link href={item.href} aria-label={collapsed ? item.label : undefined}>
              <div
                onClick={onNavigate}
                className={cn(
                  base,
                  row,
                  sizes.item,
                  brandNav.link,
                  isActive && brandNav.linkActive,
                )}
              >
                <Icon className={cn(sizes.icon, "shrink-0")} />
                {!collapsed && item.label}
              </div>
            </Link>
          </RailLabel>
        );
      })}

      {/* An address is too long to survive the rail, and truncating it to two
          characters would identify nobody. */}
      {!collapsed && user?.email && (
        <p className="truncate px-3.5 pt-2 text-xs font-medium text-foreground/50">{user.email}</p>
      )}

      <RailLabel collapsed={collapsed} label="Sign out">
        <button
          type="button"
          onClick={handleSignOut}
          aria-label={collapsed ? "Sign out" : undefined}
          className={cn(base, row, sizes.item, brandNav.link)}
        >
          <LogOut className={cn(sizes.icon, "shrink-0")} />
          {!collapsed && "Sign out"}
        </button>
      </RailLabel>
    </div>
  );
}

/**
 * The marketing nav bar stood on its end: same gradient, blur and rounding,
 * floated off every edge by the same inset the `.qnav` bar uses as its top
 * offset. The gradient is re-laid along the long axis rather than copied
 * outright, so the colour runs the panel's full height — see
 * `--brand-nav-vertical` in index.css.
 */
export function Sidebar() {
  const { isMobile, open, setOpen, openMobile, setOpenMobile } = useSidebar();
  const { data: entitlements } = useEntitlements();
  const setupLocked = entitlements ? !entitlements.entitled : false;

  // `open` is the SidebarProvider's own state, which already persists itself to
  // the `sidebar_state` cookie and is otherwise unused on desktop — TopNav's
  // `SidebarTrigger` is `md:hidden` and only ever drives `openMobile`.
  const collapsed = !open;

  return (
    <>
      <aside
        className={cn(
          // `dark` regardless of the chosen theme. The panel's gradient is
          // fixed — see the note on `--brand-nav-*` in index.css — so its
          // contents have to resolve against near-black whatever the page
          // behind it is doing. Everything inside uses `foreground` tokens,
          // which this scope turns light without any of them knowing about it.
          "dark fixed inset-y-3 left-3 z-50 hidden flex-col transition-[width] duration-200 md:flex",
          brandNav.surface,
          // Trimmed from w-64/w-16. The panel is furniture, not content: at
        // 16rem the pills were carrying more empty track than label, and the
        // rail was wider than the icons needed. AppLayout's CONTENT_OFFSET is
        // derived from these two and has to move with them.
        collapsed ? "w-14" : "w-60",
        )}
        style={{ background: NAV_SURFACE_VERTICAL, boxShadow: NAV_SHADOW }}
      >
        <SidebarBrand collapsed={collapsed} />
        <SidebarNav collapsed={collapsed} setupLocked={setupLocked} />
        <SidebarFooter collapsed={collapsed} setupLocked={setupLocked} />

        {/*
          Pinned to the edge rather than placed in the header: it then sits in
          the same spot in both states, so folding and unfolding do not move the
          control that does it out from under the pointer.

          Painted from `--page-chrome-*`, which follow the PAGE theme rather than
          the panel's pinned dark. This is the one part of the sidebar that is
          not on the sidebar — it hangs off the edge onto the page — and
          inheriting the panel's scope made it a near-black disc with a white
          arrow floating on a light page, which reads as a hole rather than a
          button.
        */}
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => setOpen(!open)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={open}
          className="absolute -right-3 top-1/2 h-6 w-6 -translate-y-1/2 rounded-full border-[var(--page-chrome-border)] bg-[var(--page-chrome-bg)] text-[var(--page-chrome-ink)] shadow-md hover:bg-[var(--page-chrome-hover)] hover:text-[var(--page-chrome-ink)]"
        >
          {collapsed ? (
            <ChevronRight className="h-3.5 w-3.5" />
          ) : (
            <ChevronLeft className="h-3.5 w-3.5" />
          )}
        </Button>
      </aside>

      {isMobile && (
        <Sheet open={openMobile} onOpenChange={setOpenMobile}>
          <SheetContent
            side="left"
            // Renamed upstream from `hideClose` when the library was reset to
            // the current generation. The drawer supplies its own dismissal
            // (tapping a nav item closes it), so the stock X would be a second
            // control for the same thing in a 288px-wide panel.
            showCloseButton={false}
            aria-label="Sidebar"
            aria-describedby="sidebar-desc"
            // Same panel, same gradient — a drawer that shared none of the
            // sidebar's treatment was the clearest tell that the phone was
            // looking at a different product. It keeps the sheet's own square
            // left edge, which is flush against the viewport.
            className="dark flex w-72 flex-col border-0 p-0 text-foreground"
            style={{ background: NAV_SURFACE_VERTICAL }}
          >
            <SheetHeader className="shrink-0 border-b border-foreground/12 p-0">
              <SheetTitle className="sr-only">Sidebar</SheetTitle>
              <SheetDescription id="sidebar-desc" className="sr-only">
                Main navigation and settings
              </SheetDescription>
              <SidebarBrand />
            </SheetHeader>

            <SidebarNav
              size="mobile"
              setupLocked={setupLocked}
              onNavigate={() => setOpenMobile(false)}
            />
            <SidebarFooter
              size="mobile"
              setupLocked={setupLocked}
              onNavigate={() => setOpenMobile(false)}
              onSignedOut={() => setOpenMobile(false)}
            />
          </SheetContent>
        </Sheet>
      )}
    </>
  );
}
