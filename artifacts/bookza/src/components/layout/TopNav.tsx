import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Search, Bell, Bot, Calendar, CreditCard, MessageSquare, Circle, Crown, Sparkles, Info, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useWhatsappConnection } from "@/hooks/use-whatsapp-connection";
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

export function TopNav() {
  const queryClient = useQueryClient();
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
        const { data } = await supabase
          .from("meta_whatsapp_connections")
          .select("id")
          .eq("business_id", businessId)
          .single();

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

  return (
    <header className="h-16 border-b border-border/60 bg-background/80 backdrop-blur-xl flex items-center justify-between px-4 sm:px-6 sticky top-0 z-40">
      <div className="flex flex-1 items-center gap-3 min-w-0">
        <div className="md:hidden">
          <SidebarTrigger />
        </div>

        <div className="hidden md:flex items-center w-full max-w-2xl mr-4">
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
      
      <div className="flex items-center gap-2">
        {metaWhatsappConnected && (
          <div className="hidden sm:flex items-center gap-2 rounded-full border border-[#0866ff]/20 bg-[#0866ff]/10 px-3 py-1.5 text-xs font-semibold text-[#0866ff] shadow-sm">
            <div className="flex h-2.5 w-2.5 items-center justify-center rounded-full bg-[#0866ff] shadow-sm">
              <span className="block h-1.5 w-1.5 rounded-full bg-white" />
            </div>
            Meta WhatsApp API connected
          </div>
        )}
        
        {whatsappConnected && (
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-50 text-green-700 text-xs font-medium dark:bg-green-950 dark:text-green-400">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            WhatsApp Connected
          </div>
        )}

        {whatsappConnected && !metaWhatsappConnected && (
          <a
            href="/marketing"
            className="hidden sm:inline-flex items-center gap-2 rounded-full border border-border bg-muted/60 px-3 py-1.5 text-xs font-semibold text-muted-foreground shadow-sm transition hover:border-[#0866ff]/25 hover:bg-[#0866ff]/5 hover:text-[#0866ff]"
          >
            Connect Meta WhatsApp API
          </a>
        )}
        
        <Badge
          variant="outline"
          className={cn(
            "hidden sm:inline-flex font-medium border-2",
            hasActivePlan
              ? "bg-gradient-to-r from-primary/10 to-primary/5 border-primary/30 text-primary"
              : "bg-muted/50 border-border text-muted-foreground"
          )}
        >
          {hasActivePlan ? (
            <span className="flex items-center gap-1.5">
              <Crown className="w-3.5 h-3.5" />
              {planName}
            </span>
          ) : (
            <span className="flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" />
              Free Plan
            </span>
          )}
        </Badge>
        
        <div className="sm:hidden">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="relative text-muted-foreground hover:text-foreground">
                <Info className="w-5 h-5" />
                {(hasActivePlan || whatsappConnected || metaWhatsappConnected) && (
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-primary rounded-full border-2 border-background" />
                )}
              </Button>
            </SheetTrigger>
            <SheetContent side="bottom" className="rounded-t-2xl px-6 py-8 h-auto max-h-[90vh]">
              <SheetHeader className="mb-6 text-left">
                <SheetTitle className="text-xl">Business Status</SheetTitle>
                <SheetDescription>
                  Your current plan and integration status.
                </SheetDescription>
              </SheetHeader>
              
              <div className="space-y-4">
                {/* Plan Card */}
                <div className={cn("p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3", hasActivePlan ? "bg-primary/5 border-primary/20" : "bg-muted/50 border-border")}>
                  <div className="flex items-center gap-3">
                    <div className={cn("p-2 rounded-lg shrink-0", hasActivePlan ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
                      {hasActivePlan ? <Crown className="w-5 h-5" /> : <Sparkles className="w-5 h-5" />}
                    </div>
                    <div>
                      <p className="text-sm font-semibold">{planName}</p>
                      <p className="text-xs text-muted-foreground">{hasActivePlan ? "Active subscription" : "Free features only"}</p>
                    </div>
                  </div>
                  <Badge variant={hasActivePlan ? "default" : "secondary"} className="w-fit">
                    {hasActivePlan ? "Active" : "Free"}
                  </Badge>
                </div>

                {/* WhatsApp Card */}
                <div className={cn("p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3", whatsappConnected ? "bg-green-50/50 border-green-200 dark:bg-green-950/20 dark:border-green-900" : "bg-muted/50 border-border")}>
                  <div className="flex items-center gap-3">
                    <div className={cn("p-2 rounded-lg shrink-0", whatsappConnected ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-400" : "bg-muted text-muted-foreground")}>
                      <MessageSquare className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold">WhatsApp Alerts</p>
                      <p className="text-xs text-muted-foreground">{whatsappConnected ? "Connected & sending" : "Not connected"}</p>
                    </div>
                  </div>
                  {whatsappConnected ? (
                    <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 gap-1.5 px-2 py-0.5 w-fit dark:bg-green-950 dark:text-green-400 dark:border-green-900">
                      <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                      Active
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="w-fit">Offline</Badge>
                  )}
                </div>

                {/* Meta WhatsApp API Card */}
                <div className={cn("p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3", metaWhatsappConnected ? "bg-blue-50/50 border-blue-200 dark:bg-blue-950/20 dark:border-blue-900" : "bg-muted/50 border-border")}>
                  <div className="flex items-center gap-3">
                    <div className={cn("p-2 rounded-lg shrink-0", metaWhatsappConnected ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-400" : "bg-muted text-muted-foreground")}>
                      <MessageSquare className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold">Meta WhatsApp API</p>
                      <p className="text-xs text-muted-foreground">{metaWhatsappConnected ? "Connected for campaigns" : "Not connected"}</p>
                    </div>
                  </div>
                  {metaWhatsappConnected ? (
                    <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 gap-1.5 px-2 py-0.5 w-fit dark:bg-blue-950 dark:text-blue-400 dark:border-blue-900">
                      <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                      Active
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="w-fit">Offline</Badge>
                  )}
                </div>
                {whatsappConnected && !metaWhatsappConnected && (
                  <a
                    href="/marketing"
                    className="inline-flex w-full items-center justify-center rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700"
                  >
                    Connect Meta WhatsApp API
                  </a>
                )}
              </div>
            </SheetContent>
          </Sheet>
        </div>

        <ThemeToggle />

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
      </div>
    </header>
  );
}
