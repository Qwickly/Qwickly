import { useEffect, useState } from "react";
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
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSidebar } from "@/components/ui/sidebar";
import { Sheet, SheetContent, SheetHeader, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useAuth } from "@/contexts/AuthContext";
import logo from "@/assets/qwickly-icon.svg";

type NavChild = { label: string; href: string };
type NavItem = { icon: LucideIcon; label: string; href: string; children?: NavChild[] };

const navItems: NavItem[] = [
  { icon: LayoutDashboard, label: "Dashboard", href: "/dashboard" },
  { icon: CalendarIcon, label: "Calendar", href: "/calendar" },
  { icon: Users, label: "Bookings", href: "/bookings" },
  { icon: UserSquare2, label: "Clients", href: "/clients" },
  { icon: Scissors, label: "Services", href: "/services" },
  { icon: Users, label: "Staff", href: "/staff" },
  { icon: Wallet, label: "Payments", href: "/payments" },
  { icon: LineChart, label: "Analytics", href: "/analytics" },
  {
    icon: MessageCircle,
    label: "WhatsApp",
    href: "/whatsapp",
    children: [
      { label: "Inbox", href: "/whatsapp" },
      { label: "Bot Setup", href: "/whatsapp/bot" },
    ],
  },
  { icon: Megaphone, label: "Marketing", href: "/marketing" },
  { icon: MonitorSmartphone, label: "Booking Page", href: "/booking-page" },
  { icon: Bot, label: "AI Assistant", href: "/ai-assistant" },
];

export function Sidebar() {
  const [location, setLocation] = useLocation();
  const { signOut, user } = useAuth();
  const handleSignOut = async () => {
    await signOut();
    setLocation("/login");
  };
  const { isMobile, openMobile, setOpenMobile } = (() => {
    try {
      return useSidebar();
    } catch {
      return { isMobile: false, openMobile: false, setOpenMobile: (_: boolean) => {} } as any;
    }
  })();

  const whatsappActive = location === "/whatsapp" || location.startsWith("/whatsapp/");
  const [whatsappOpen, setWhatsappOpen] = useState(whatsappActive);
  // Auto-expand the group when you navigate into the WhatsApp area (never force-closes).
  useEffect(() => {
    if (whatsappActive) setWhatsappOpen(true);
  }, [whatsappActive]);

  const renderNav = (variant: "desktop" | "mobile") => {
    const sizes =
      variant === "desktop"
        ? { item: "px-3 py-2.5 text-sm", icon: "w-4 h-4", child: "pl-10 py-2 text-sm" }
        : { item: "px-3 py-3 text-base", icon: "w-5 h-5", child: "pl-11 py-2.5 text-base" };
    const onNavigate = variant === "mobile" ? () => setOpenMobile(false) : undefined;
    const base = "flex items-center gap-3 rounded-md font-medium transition-colors cursor-pointer w-full";
    const inactive = "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground";
    const activeCls = "bg-primary text-primary-foreground";

    return navItems.map((item) => {
      const Icon = item.icon;

      if (item.children) {
        return (
          <div key={item.href}>
            <div
              role="button"
              tabIndex={0}
              onClick={() => setWhatsappOpen((open) => !open)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setWhatsappOpen((open) => !open);
                }
              }}
              className={cn(base, sizes.item, inactive)}
            >
              <Icon className={sizes.icon} />
              <span className="flex-1 text-left">{item.label}</span>
              <ChevronDown className={cn("w-4 h-4 transition-transform duration-200 ease-out", whatsappOpen && "rotate-180")} />
            </div>
            <div
              className={cn(
                "grid transition-[grid-template-rows,opacity] duration-200 ease-out",
                whatsappOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
              )}
            >
              <div className="min-h-0 overflow-hidden">
                <div className="mt-1 space-y-1">
                {item.children.map((child) => {
                  const active = location === child.href;
                  return (
                    <Link key={child.href} href={child.href}>
                      <div onClick={onNavigate} className={cn(base, sizes.child, active ? activeCls : inactive)}>
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

      const isActive = location === item.href || location.startsWith(item.href + "/");
      return (
        <Link key={item.href} href={item.href}>
          <div onClick={onNavigate} className={cn(base, sizes.item, isActive ? activeCls : inactive)}>
            <Icon className={sizes.icon} />
            {item.label}
          </div>
        </Link>
      );
    });
  };

  const desktop = (
    <div className="hidden md:flex w-64 flex-col fixed inset-y-0 left-0 bg-sidebar border-r z-50">
      <div className="p-6 flex items-center">
        <img src={logo} alt="Qwickly" className="h-10 w-auto" />
      </div>

      <nav className="flex-1 px-3 space-y-1 overflow-y-auto pb-4">
        {renderNav("desktop")}
      </nav>

      <div className="p-4 border-t border-sidebar-border mt-auto space-y-1">
        {user?.email && (
          <p className="px-3 pb-2 text-xs text-muted-foreground truncate">{user.email}</p>
        )}
        <Link href="/settings">
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground cursor-pointer transition-colors">
            <Settings className="w-4 h-4" />
            Settings
          </div>
        </Link>
        <Link href="/billing">
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground cursor-pointer transition-colors">
            <Wallet className="w-4 h-4" />
            Billing
          </div>
        </Link>
        <button type="button" onClick={handleSignOut} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors">
          <LogOut className="w-4 h-4" />
          Sign out
        </button>
      </div>
    </div>
  );

  const mobile = isMobile ? (
    <Sheet open={openMobile} onOpenChange={setOpenMobile}>
      <SheetContent side="left" hideClose aria-label="Sidebar" aria-describedby="sidebar-desc" className="w-72 p-0 bg-sidebar text-sidebar-foreground flex flex-col">
          <SheetHeader className="p-4 border-b shrink-0">
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center gap-3">
                <img src={logo} alt="Qwickly" className="h-8 w-auto" />
              </div>
              <SheetTitle className="sr-only">Sidebar</SheetTitle>
              <SheetDescription id="sidebar-desc" className="sr-only">Main navigation and settings</SheetDescription>
            </div>
          </SheetHeader>

        <nav className="flex-1 px-4 py-3 space-y-2 overflow-y-auto">
          {renderNav("mobile")}
        </nav>

        <div className="p-4 border-t border-sidebar-border mt-auto space-y-2 shrink-0">
          {user?.email && <p className="px-3 pb-1 text-sm text-muted-foreground truncate">{user.email}</p>}
          <Link href="/settings"><div onClick={() => setOpenMobile(false)} className="flex items-center gap-3 px-3 py-3 rounded-md text-base font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground cursor-pointer"><Settings className="w-5 h-5" />Settings</div></Link>
          <Link href="/billing"><div onClick={() => setOpenMobile(false)} className="flex items-center gap-3 px-3 py-3 rounded-md text-base font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground cursor-pointer"><Wallet className="w-5 h-5" />Billing</div></Link>
          <button type="button" onClick={() => { setOpenMobile(false); handleSignOut(); }} className="w-full flex items-center gap-3 px-3 py-3 rounded-md text-base font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"><LogOut className="w-5 h-5" />Sign out</button>
        </div>
      </SheetContent>
    </Sheet>
  ) : null;

  return (<>{desktop}{mobile}</>);
}
