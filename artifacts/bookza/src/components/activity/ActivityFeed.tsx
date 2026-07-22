import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Bot, Calendar, Circle, CreditCard, MessageSquare } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { fetchActivityEvents, type ActivityEvent } from "@/lib/activity";
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

export function ActivityFeed({
  limit = 12,
  compact = false,
}: {
  limit?: number;
  compact?: boolean;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["activity", "events", limit],
    queryFn: () => fetchActivityEvents(limit),
    refetchInterval: 60_000,
  });

  const activities = data?.events ?? [];

  if (isLoading) {
    return (
      <div className="space-y-1 p-1">
        {Array.from({ length: compact ? 4 : 6 }).map((_, index) => (
          <div key={index} className="flex gap-3 rounded-lg p-3">
            <div className="h-9 w-9 animate-pulse rounded-full bg-muted" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (activities.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-border/70 text-center text-sm text-muted-foreground">
        No recent activity yet.
      </div>
    );
  }

  const list = (
    <div className="space-y-1 p-1">
      {activities.map((activity) => {
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
      })}
    </div>
  );

  if (compact) return list;
  return <ScrollArea className="max-h-[420px] pr-2">{list}</ScrollArea>;
}
