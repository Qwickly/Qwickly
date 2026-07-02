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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSidebar } from "@/components/ui/sidebar";
import { Sheet, SheetContent, SheetHeader, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useAuth } from "@/contexts/AuthContext";
import logo from "@/assets/Watermark-2.svg";

const navItems = [
  { icon: LayoutDashboard, label: "Dashboard", href: "/dashboard" },
  { icon: CalendarIcon, label: "Calendar", href: "/calendar" },
  { icon: Users, label: "Bookings", href: "/bookings" },
  { icon: UserSquare2, label: "Clients", href: "/clients" },
  { icon: Scissors, label: "Services", href: "/services" },
  { icon: Users, label: "Staff", href: "/staff" },
  { icon: Wallet, label: "Payments", href: "/payments" },
  { icon: LineChart, label: "Analytics", href: "/analytics" },
  { icon: MessageCircle, label: "WhatsApp", href: "/whatsapp" },
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

  const desktop = (
    <div className="hidden md:flex w-64 flex-col fixed inset-y-0 left-0 bg-sidebar border-r z-50">
      <div className="p-6 flex items-center">
        <img src={logo} alt="Qwickly" className="h-10 w-auto" />
      </div>

      <nav className="flex-1 px-3 space-y-1 overflow-y-auto pb-4">
        {navItems.map((item) => {
          const isActive = location === item.href;
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href}>
              <div
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors cursor-pointer",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )}
              >
                <Icon className="w-4 h-4" />
                {item.label}
              </div>
            </Link>
          );
        })}
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
          {navItems.map((item) => {
            const isActive = location === item.href;
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href}>
                <div onClick={() => setOpenMobile(false)} className={cn("flex items-center gap-3 px-3 py-3 rounded-md text-base font-medium transition-colors w-full", isActive ? "bg-primary text-primary-foreground" : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground") }>
                  <Icon className="w-5 h-5" />
                  {item.label}
                </div>
              </Link>
            );
          })}
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
