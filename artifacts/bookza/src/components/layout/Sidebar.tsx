import { Link, useLocation } from "wouter";
import { 
  LayoutDashboard, Calendar as CalendarIcon, Users, UserSquare2, Scissors,
  Settings, LineChart, MessageCircle, Wallet, Megaphone, MonitorSmartphone, Bot, LogOut
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import logo from "@/assets/inCheck-logomark.svg";

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

  return (
    <div className="hidden md:flex w-64 flex-col fixed inset-y-0 left-0 bg-sidebar border-r z-50">
      <div className="p-6 flex items-center">
        <img src={logo} alt="inCheck" className="h-10 w-auto" />
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
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
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
        <button
          type="button"
          onClick={handleSignOut}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Sign out
        </button>
      </div>
    </div>
  );
}
