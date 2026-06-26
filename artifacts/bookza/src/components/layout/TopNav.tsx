import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Search, Bell, Bot, Calendar, CreditCard, MessageSquare, Circle } from "lucide-react";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { useWhatsappConnection } from "@/hooks/use-whatsapp-connection";
import {
  fetchActivityEvents,
  markActivityEventsRead,
  type ActivityEvent,
} from "@/lib/activity";
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
  const { connected: whatsappConnected } = useWhatsappConnection();
  const { data: activityData, isLoading: loadingActivity } = useQuery({
    queryKey: ["activity", "events", 25],
    queryFn: () => fetchActivityEvents(25),
    refetchInterval: activityOpen ? 15_000 : 60_000,
  });

  const unreadCount = activityData?.unreadCount ?? 0;
  const activities = activityData?.events ?? [];

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
    <header className="h-16 border-b bg-background flex items-center justify-between px-6 sticky top-0 z-40">
      <div className="flex items-center flex-1 max-w-md">
        <div className="relative w-full">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Search bookings, clients, or staff..." 
            className="w-full pl-9 bg-muted/50 border-none focus-visible:ring-1 focus-visible:bg-background"
          />
        </div>
      </div>
      
      <div className="flex items-center gap-4">
        {whatsappConnected && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-50 text-green-700 text-xs font-medium">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            WhatsApp Connected
          </div>
        )}
        
        <Badge variant="outline" className="hidden sm:inline-flex bg-background font-medium">
          Pro Plan
        </Badge>
        
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
        
        <div className="h-8 w-px bg-border mx-1" />
        
        <div className="flex items-center gap-3">
          <div className="text-right hidden sm:block">
            <p className="text-sm font-medium leading-none text-foreground">Aiden T.</p>
            <p className="text-xs text-muted-foreground mt-0.5">Admin</p>
          </div>
          <Avatar className="w-9 h-9 border border-border cursor-pointer hover:opacity-80 transition-opacity">
            <AvatarImage src="https://i.pravatar.cc/150?u=aiden" />
            <AvatarFallback className="bg-primary/10 text-primary">AT</AvatarFallback>
          </Avatar>
        </div>
      </div>
    </header>
  );
}
