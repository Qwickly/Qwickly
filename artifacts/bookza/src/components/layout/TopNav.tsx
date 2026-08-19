import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { useTheme } from "next-themes";
import { Link, useLocation } from "wouter";
import { Search, Bell, Bot, Calendar, CreditCard, MessageSquare, Circle, Crown, Sparkles, X, ArrowLeft, ArrowRight, ChevronRight, Menu, ChevronDown, Settings, LogOut, Sun, Moon, Monitor } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useSidebar } from "@/components/ui/sidebar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useWhatsappConnection } from "@/hooks/use-whatsapp-connection";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { ensureBusiness } from "@/lib/settings";
import {
  fetchActivityEvents,
  markActivityEventsRead,
  type ActivityEvent,
} from "@/lib/activity";
import { fetchSubscription } from "@/lib/catalog-subscriptions";
import { searchPlatform, type SearchResult } from "@/lib/search";
import { SearchResults } from "@/components/search/SearchResults";
import { InternalPageNav } from "@/components/layout/internal-page-nav";
import { usePageChromeContext, type PageChromeBreadcrumb } from "@/components/layout/page-chrome";
import { cn } from "@/lib/utils";

const activityIcons = {
  ai: Bot,
  booking: Calendar,
  payment: CreditCard,
  whatsapp: MessageSquare,
} as const;

function getActivityIcon(activity: ActivityEvent) {
  if (activity.actorType === "ai") return activityIcons.ai;
  return activityIcons[activity.entityType as keyof typeof activityIcons] ?? Circle;
}

const ROUTE_BREADCRUMBS: Array<{
  match: (pathname: string) => boolean;
  breadcrumbs: PageChromeBreadcrumb[] | ((pathname: string) => PageChromeBreadcrumb[]);
  /** Used on the back button when the last crumb alone ("New", "Edit") says too little. */
  backLabel?: string;
}> = [
  { match: (pathname) => pathname === "/dashboard", breadcrumbs: [{ label: "Dashboard" }] },
  { match: (pathname) => pathname === "/calendar", breadcrumbs: [{ label: "Calendar" }] },
  { match: (pathname) => pathname === "/bookings/new", breadcrumbs: [{ label: "Bookings", href: "/bookings" }, { label: "New" }], backLabel: "New booking" },
  {
    match: (pathname) => pathname.startsWith("/bookings/") && pathname.endsWith("/edit"),
    backLabel: "Edit booking",
    // The middle crumb has to point at the booking being edited, not back at the list.
    breadcrumbs: (pathname) => [
      { label: "Bookings", href: "/bookings" },
      { label: "Booking", href: pathname.replace(/\/edit$/, "") },
      { label: "Edit" },
    ],
  },
  { match: (pathname) => pathname.startsWith("/bookings/"), breadcrumbs: [{ label: "Bookings", href: "/bookings" }, { label: "Booking" }] },
  { match: (pathname) => pathname === "/bookings", breadcrumbs: [{ label: "Bookings" }] },
  { match: (pathname) => pathname === "/clients", breadcrumbs: [{ label: "Clients" }] },
  { match: (pathname) => pathname === "/clients/new", breadcrumbs: [{ label: "Clients", href: "/clients" }, { label: "New" }], backLabel: "New client" },
  {
    match: (pathname) => pathname.startsWith("/clients/") && pathname.endsWith("/edit"),
    backLabel: "Edit client",
    breadcrumbs: (pathname) => [
      { label: "Clients", href: "/clients" },
      { label: "Client", href: pathname.replace(/\/edit$/, "") },
      { label: "Edit" },
    ],
  },
  { match: (pathname) => pathname.startsWith("/clients/"), breadcrumbs: [{ label: "Clients", href: "/clients" }, { label: "Client" }] },
  { match: (pathname) => pathname === "/services", breadcrumbs: [{ label: "Services" }] },
  { match: (pathname) => pathname.startsWith("/services/"), breadcrumbs: [{ label: "Services", href: "/services" }, { label: "Service" }] },
  { match: (pathname) => pathname === "/staff", breadcrumbs: [{ label: "Staff" }] },
  { match: (pathname) => pathname.startsWith("/staff/"), breadcrumbs: [{ label: "Staff", href: "/staff" }, { label: "Staff member" }] },
  { match: (pathname) => pathname === "/payments", breadcrumbs: [{ label: "Payments" }] },
  { match: (pathname) => pathname === "/analytics", breadcrumbs: [{ label: "Analytics" }] },
  { match: (pathname) => pathname === "/whatsapp/bot", breadcrumbs: [{ label: "WhatsApp", href: "/whatsapp" }, { label: "Bot Setup" }] },
  { match: (pathname) => pathname === "/whatsapp", breadcrumbs: [{ label: "WhatsApp" }] },
  { match: (pathname) => pathname === "/marketing", breadcrumbs: [{ label: "Marketing" }] },
  { match: (pathname) => pathname === "/booking-page", breadcrumbs: [{ label: "Booking Page" }] },
  { match: (pathname) => pathname === "/ai-assistant", breadcrumbs: [{ label: "AI Assistant" }] },
  { match: (pathname) => pathname === "/settings", breadcrumbs: [{ label: "Settings" }] },
  { match: (pathname) => pathname === "/get-started", breadcrumbs: [{ label: "Getting Started" }] },
  { match: (pathname) => pathname === "/billing", breadcrumbs: [{ label: "Billing" }] },
];

function routeEntry(pathname: string) {
  return ROUTE_BREADCRUMBS.find((item) => item.match(pathname));
}

function defaultBreadcrumbs(pathname: string): PageChromeBreadcrumb[] {
  const entry = routeEntry(pathname);
  if (!entry) return [{ label: "Qwickly" }];
  return typeof entry.breadcrumbs === "function" ? entry.breadcrumbs(pathname) : entry.breadcrumbs;
}

/** What to call a page when you are coming back to it from somewhere else. */
function pageLabel(pathname: string): string {
  const entry = routeEntry(pathname);
  if (!entry) return "Back";
  if (entry.backLabel) return entry.backLabel;
  const crumbs = defaultBreadcrumbs(pathname);
  return crumbs[crumbs.length - 1]?.label ?? "Back";
}

/**
 * Breadcrumbs only climb the route hierarchy, so they are no help once you follow
 * a link sideways — booking -> client, booking -> service — and want to get back
 * to the page (and the half-finished edit) you came from. This tracks how deep
 * into in-app history we are so the chrome bar can offer a real back step, and
 * hides it at depth 0 so back never walks out of the app.
 */
type TrailEntry = { path: string; label: string };

/**
 * Browser-style back/forward for in-app navigation.
 *
 * The first cut only tracked "pages you stepped away from" and pushed onto that
 * stack on every navigation, so walking back via a breadcrumb or an in-page link
 * looked like a step forward — the arrow then pointed at the page you had just
 * left, and back/forward felt like a loop.
 *
 * This classifies each location change by where it landed instead of trusting
 * popstate: landing on the top of the back stack IS a back step whether it came
 * from the arrow, the browser chrome, or a link. A genuinely new destination
 * clears the forward stack, exactly like a browser.
 */
function useHistoryTrail(pathname: string): { back: TrailEntry | null; forward: TrailEntry | null } {
  const backRef = useRef<TrailEntry[]>([]);
  const forwardRef = useRef<TrailEntry[]>([]);
  const previousRef = useRef<TrailEntry>({ path: pathname, label: pageLabel(pathname) });
  const [trail, setTrail] = useState<{ back: TrailEntry | null; forward: TrailEntry | null }>({
    back: null,
    forward: null,
  });

  useEffect(() => {
    const previous = previousRef.current;
    if (pathname === previous.path) return;
    previousRef.current = { path: pathname, label: pageLabel(pathname) };

    const backTop = backRef.current[backRef.current.length - 1];
    const forwardTop = forwardRef.current[forwardRef.current.length - 1];

    if (backTop?.path === pathname) {
      backRef.current.pop();
      forwardRef.current.push(previous);
    } else if (forwardTop?.path === pathname) {
      forwardRef.current.pop();
      backRef.current.push(previous);
    } else {
      backRef.current.push(previous);
      forwardRef.current = [];
    }

    setTrail({
      back: backRef.current[backRef.current.length - 1] ?? null,
      forward: forwardRef.current[forwardRef.current.length - 1] ?? null,
    });
  }, [pathname]);

  return trail;
}

function PageBreadcrumbs({ items }: { items: PageChromeBreadcrumb[] }) {
  if (!items.length) return null;

  return (
    <nav className="min-w-0 overflow-hidden" aria-label="Breadcrumb">
      <ol className="flex min-w-0 items-center gap-1 text-xs font-medium text-muted-foreground">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`} className="flex min-w-0 items-center gap-1">
              {item.href && !isLast ? (
                <Link
                  href={item.href}
                  className="truncate transition-colors hover:text-foreground"
                >
                  {item.label}
                </Link>
              ) : (
                <span className={cn("truncate", isLast && "text-foreground")}>
                  {item.label}
                </span>
              )}
              {!isLast ? <ChevronRight className="h-3.5 w-3.5 shrink-0" /> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function getInitials(nameOrEmail?: string | null) {
  const value = nameOrEmail?.trim();
  if (!value) return "U";

  const nameParts = value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  if (nameParts.length > 1) {
    return nameParts.map((part) => part[0]?.toUpperCase()).join("");
  }

  return value.slice(0, 2).toUpperCase();
}

export function TopNav() {
  const queryClient = useQueryClient();
  const { toggleSidebar } = useSidebar();
  const { setTheme } = useTheme();
  const { user, signOut } = useAuth();
  const { chrome } = usePageChromeContext();
  const [pathname, navigate] = useLocation();
  const trail = useHistoryTrail(pathname);
  const [activityOpen, setActivityOpen] = useState(false);
  const [metaWhatsappConnected, setMetaWhatsappConnected] = useState(false);
  const { connected: whatsappConnected } = useWhatsappConnection();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  
  const { data: subscription } = useQuery({
    queryKey: ["subscription"],
    queryFn: fetchSubscription,
    refetchInterval: 60_000,
  });
  
  const { data: activityData, isLoading: loadingActivity } = useQuery({
    queryKey: ["activity", "events", 25],
    queryFn: () => fetchActivityEvents(25),
    refetchInterval: activityOpen ? 15_000 : 60_000,
  });

  const unreadCount = activityData?.unreadCount ?? 0;
  const activities = activityData?.events ?? [];
  
  // A trial is a live plan — it was excluded here, so trialing businesses saw
  // "Free Plan" despite being on Starter.
  const isTrialing = subscription?.status === "trialing";
  const hasActivePlan = Boolean(
    subscription && (subscription.status === "active" || isTrialing),
  );
  const planName = subscription?.planName
    ? `${subscription.planName}${isTrialing ? " · Trial" : ""}`
    : "Free Plan";
  const userName =
    (user?.user_metadata?.full_name as string | undefined) ||
    (user?.user_metadata?.first_name as string | undefined) ||
    user?.email ||
    "Account";
  const userAvatar = user?.user_metadata?.avatar_url as string | undefined;
  const userInitials = getInitials(userName);

  const handleSignOut = async () => {
    await signOut();
    navigate("/login");
  };

  // Debounced search handler
  useEffect(() => {
    const timeout = setTimeout(async () => {
      if (searchQuery.trim().length >= 2) {
        setSearchLoading(true);
        try {
          const results = await searchPlatform(searchQuery);
          setSearchResults(results);
        } catch (error) {
          console.error("Search error:", error);
          setSearchResults([]);
        } finally {
          setSearchLoading(false);
        }
      } else {
        setSearchResults([]);
      }
    }, 300);

    return () => clearTimeout(timeout);
  }, [searchQuery]);

  // Check for Meta WhatsApp API connection
  useEffect(() => {
    let mounted = true;

    async function checkMetaConnection() {
      try {
        const businessId = await ensureBusiness();
        const { data } = await supabase.rpc("has_meta_whatsapp_connection", {
          p_business_id: businessId,
        });

        if (mounted) {
          setMetaWhatsappConnected(!!data);
        }
      } catch (error) {
        if (mounted) {
          setMetaWhatsappConnected(false);
        }
      }
    }

    checkMetaConnection();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!activityOpen || unreadCount === 0) return;

    const timeout = window.setTimeout(() => {
      void markActivityEventsRead()
        .then(() =>
          queryClient.invalidateQueries({
            queryKey: ["activity", "events", 25],
          }),
        )
        .catch(() => undefined);
    }, 800);

    return () => window.clearTimeout(timeout);
  }, [activityOpen, queryClient, unreadCount]);

  const breadcrumbs = chrome.breadcrumbs ?? defaultBreadcrumbs(pathname);
  const hasPageChrome = Boolean(chrome.internalNav || breadcrumbs.length);

  return (
    // Transparent, so the shell's gradient runs unbroken from the top of the
    // page. A translucent `bg-background` here laid a flat band across the
    // ground and the header read as a separate surface pasted on top of it.
    //
    // The blur went with it, and was never doing anything: `main`
    // is a sibling with its own `overflow-y-auto`, so page content scrolls
    // *beside* this header rather than under it — there has never been anything
    // behind it to blur except the gradient, which blurs to itself.
    <header className="sticky top-0 z-40 min-w-0 border-b border-border/40">
      <div className="flex h-16 items-center justify-between px-4 sm:px-6">
        <div className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden">
          <div className="md:hidden">
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-foreground"
              onClick={toggleSidebar}
            >
              <Menu className="h-5 w-5" />
              <span className="sr-only">Toggle sidebar</span>
            </Button>
          </div>

        {/*
          Fluid: takes whatever the row has left after the controls on the
          right, rather than sitting at a fixed 42rem (`max-w-2xl`) and leaving
          the remainder as dead space. That gap moved every time the sidebar
          folded — 11.5rem of it — while the field stayed exactly the same size,
          which is what made the header look like it was not part of the layout.

          `min-w-0` is required for the shrink half to work: a flex item's floor
          is its content's min-content width by default, and the field's
          placeholder is long enough to hold the row open and push the buttons
          off the edge on a narrow desktop window.
        */}
          <div className="hidden min-w-0 flex-1 items-center mr-4 md:flex">
          <div className="relative w-full">
            <Search className="absolute left-3 top-3 h-5 w-5 text-muted-foreground" />
            <Input
              placeholder="Search bookings, clients, staff, or pages..."
              className="w-full pl-10 h-11 bg-muted/50 border-none focus-visible:ring-1 focus-visible:bg-background text-base"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => setSearchOpen(true)}
            />
            {searchQuery && (
              <button
                onClick={() => {
                  setSearchQuery("");
                  setSearchResults([]);
                }}
                className="absolute right-3 top-3 text-muted-foreground hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            )}
            {searchOpen && (searchQuery || searchResults.length > 0) && (
              <div className="absolute top-full left-0 right-0 mt-2 bg-background border rounded-lg shadow-lg z-50 max-h-[500px] overflow-hidden">
                <div className="p-3 border-b flex items-center justify-between">
                  <span className="text-sm font-medium text-muted-foreground">Search Results</span>
                  <button
                    onClick={() => {
                      setSearchOpen(false);
                      setSearchQuery("");
                      setSearchResults([]);
                    }}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <ScrollArea className="max-h-[420px]">
                  <SearchResults
                    results={searchResults}
                    loading={searchLoading}
                    query={searchQuery}
                    onSelect={() => {
                      setSearchOpen(false);
                      setSearchQuery("");
                      setSearchResults([]);
                    }}
                  />
                </ScrollArea>
              </div>
            )}
          </div>
        </div>

        {/* Mobile search — a full-width sheet from the top, not the old
            absolutely-positioned dropdown. That dropdown was anchored
            `right-0` to an icon button sitting near the header's left edge
            (next to the sidebar trigger), so its fixed w-80 panel routinely
            overflowed off narrow screens (fixes.md item 8). */}
          <div className="md:hidden">
          <Sheet open={searchOpen} onOpenChange={setSearchOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="text-muted-foreground">
                <Search className="w-5 h-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="top" className="flex max-h-[85vh] flex-col gap-0 p-0">
              <div className="flex items-center gap-3 border-b p-4 pr-14">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search bookings, clients, staff, or pages..."
                    className="w-full pl-9 pr-9"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    autoFocus
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => {
                        setSearchQuery("");
                        setSearchResults([]);
                      }}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
              <ScrollArea className="flex-1">
                <SearchResults
                  results={searchResults}
                  loading={searchLoading}
                  query={searchQuery}
                  onSelect={() => {
                    setSearchOpen(false);
                    setSearchQuery("");
                    setSearchResults([]);
                  }}
                />
              </ScrollArea>
            </SheetContent>
          </Sheet>
          </div>
        </div>
      
        {/* `shrink-0`, now that the search beside it is the thing that gives. The
          two were both flexible, so a narrow window squashed the icon buttons
          instead of the field — the one element in the row with nothing to
          spare. */}
        <div className="flex shrink-0 items-center gap-2">
        <Sheet open={activityOpen} onOpenChange={setActivityOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="relative text-muted-foreground hover:text-foreground">
              <Bell className="w-5 h-5" />
              {unreadCount > 0 && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-destructive rounded-full border-2 border-background" />
              )}
            </Button>
          </SheetTrigger>
          <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
            <SheetHeader className="border-b px-6 py-5">
              <div className="flex items-start justify-between gap-4 pr-8">
                <div>
                  <SheetTitle>Activity</SheetTitle>
                  <SheetDescription>
                    Recent automation and business events.
                  </SheetDescription>
                </div>
                {unreadCount > 0 && (
                  <Badge variant="secondary" className="shrink-0">
                    {unreadCount} new
                  </Badge>
                )}
              </div>
            </SheetHeader>
            <ScrollArea className="flex-1">
              <div className="space-y-1 p-4">
                {loadingActivity ? (
                  Array.from({ length: 5 }).map((_, index) => (
                    <div key={index} className="flex gap-3 rounded-lg p-3">
                      <div className="h-9 w-9 rounded-full bg-muted animate-pulse" />
                      <div className="flex-1 space-y-2">
                        <div className="h-4 w-3/4 rounded bg-muted animate-pulse" />
                        <div className="h-3 w-1/2 rounded bg-muted animate-pulse" />
                      </div>
                    </div>
                  ))
                ) : activities.length === 0 ? (
                  <div className="flex h-48 items-center justify-center text-center text-sm text-muted-foreground">
                    No recent activity yet.
                  </div>
                ) : (
                  activities.map((activity) => {
                    const Icon = getActivityIcon(activity);
                    return (
                      <div
                        key={activity.id}
                        className={cn(
                          "flex gap-3 rounded-lg p-3 transition-colors hover:bg-muted/60",
                          !activity.readAt && "bg-muted/30",
                        )}
                      >
                        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-3">
                            <p className="text-sm font-medium leading-snug text-foreground">
                              {activity.title}
                            </p>
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {formatDistanceToNow(new Date(activity.createdAt), {
                                addSuffix: true,
                              })}
                            </span>
                          </div>
                          {activity.description && (
                            <p className="mt-1 line-clamp-3 text-sm leading-relaxed text-muted-foreground">
                              {activity.description}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </ScrollArea>
          </SheetContent>
        </Sheet>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="h-10 gap-2 px-1.5 text-muted-foreground hover:text-foreground sm:px-2"
            >
              <Avatar className="h-8 w-8 border">
                <AvatarImage src={userAvatar} alt={userName} />
                <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                  {userInitials}
                </AvatarFallback>
              </Avatar>
              <span className="hidden max-w-28 truncate text-sm font-medium text-foreground lg:inline">
                {userName}
              </span>
              <ChevronDown className="h-4 w-4 shrink-0" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            <DropdownMenuLabel className="p-3">
              <div className="flex min-w-0 items-center gap-3">
                <Avatar className="h-10 w-10 border">
                  <AvatarImage src={userAvatar} alt={userName} />
                  <AvatarFallback className="bg-primary/10 text-sm font-semibold text-primary">
                    {userInitials}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">{userName}</p>
                  {user?.email ? (
                    <p className="truncate text-xs font-normal text-muted-foreground">{user.email}</p>
                  ) : null}
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <div className="space-y-2 p-2">
              <div className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-muted/30 px-3 py-2">
                <span className="flex min-w-0 items-center gap-2 text-sm">
                  {hasActivePlan ? (
                    <Crown className="h-4 w-4 shrink-0 text-primary" />
                  ) : (
                    <Sparkles className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="truncate font-medium">{planName}</span>
                </span>
                <Badge variant={hasActivePlan ? "default" : "secondary"} className="shrink-0">
                  {hasActivePlan ? "Active" : "Free"}
                </Badge>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-muted/30 px-3 py-2">
                <span className="flex min-w-0 items-center gap-2 text-sm">
                  <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate font-medium">WhatsApp</span>
                </span>
                <Badge variant={whatsappConnected ? "outline" : "secondary"} className="shrink-0 gap-1.5">
                  {whatsappConnected ? (
                    <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                  ) : null}
                  {whatsappConnected ? "Connected" : "Offline"}
                </Badge>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-muted/30 px-3 py-2">
                <span className="flex min-w-0 items-center gap-2 text-sm">
                  <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate font-medium">Meta API</span>
                </span>
                <Badge variant={metaWhatsappConnected ? "outline" : "secondary"} className="shrink-0 gap-1.5">
                  {metaWhatsappConnected ? (
                    <span className="h-1.5 w-1.5 rounded-full bg-[#0866ff]" />
                  ) : null}
                  {metaWhatsappConnected ? "Connected" : "Offline"}
                </Badge>
              </div>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/settings">
                <Settings className="h-4 w-4" />
                Settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/billing">
                <CreditCard className="h-4 w-4" />
                Billing
              </Link>
            </DropdownMenuItem>
            {whatsappConnected && !metaWhatsappConnected ? (
              <DropdownMenuItem asChild>
                <Link href="/marketing">
                  <MessageSquare className="h-4 w-4" />
                  Connect Meta WhatsApp API
                </Link>
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="px-2 py-1 text-xs font-semibold uppercase text-muted-foreground">
              Appearance
            </DropdownMenuLabel>
            <DropdownMenuItem onClick={() => setTheme("light")}>
              <Sun className="h-4 w-4" />
              Light
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTheme("dark")}>
              <Moon className="h-4 w-4" />
              Dark
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTheme("system")}>
              <Monitor className="h-4 w-4" />
              System
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void handleSignOut()}>
              <LogOut className="h-4 w-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        </div>
      </div>

      {hasPageChrome ? (
        <div className="min-w-0 max-w-full overflow-hidden border-t border-border/30 px-4 py-2 sm:px-6">
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex min-w-0 items-center gap-2">
              {trail.back || trail.forward ? (
                <>
                  <div className="flex shrink-0 items-center">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-foreground"
                      disabled={!trail.back}
                      onClick={() => trail.back && navigate(trail.back.path)}
                      aria-label={trail.back ? `Back to ${trail.back.label}` : "Back"}
                      title={trail.back ? `Back to ${trail.back.label}` : "Back"}
                    >
                      <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-foreground"
                      disabled={!trail.forward}
                      onClick={() => trail.forward && navigate(trail.forward.path)}
                      aria-label={trail.forward ? `Forward to ${trail.forward.label}` : "Forward"}
                      title={trail.forward ? `Forward to ${trail.forward.label}` : "Forward"}
                    >
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </div>
                  <span className="h-4 w-px shrink-0 bg-border" aria-hidden="true" />
                </>
              ) : null}
              <PageBreadcrumbs items={breadcrumbs} />
            </div>
            {chrome.internalNav ? (
              <div className="flex min-w-0 max-w-full items-center gap-3 overflow-hidden">
                <InternalPageNav
                  items={chrome.internalNav.items}
                  active={chrome.internalNav.active}
                  onChange={chrome.internalNav.onChange}
                  ariaLabel={chrome.internalNav.ariaLabel}
                  variant="chrome"
                  className="min-w-0 flex-1"
                />
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </header>
  );
}
