import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const HOUR_HEIGHT = 96;

type SkeletonSlot = { topHour: number; durationHours: number };

const SLOT_TEMPLATES: SkeletonSlot[][] = [
  [
    { topHour: 0.5, durationHours: 1 },
    { topHour: 3, durationHours: 1.5 },
    { topHour: 7, durationHours: 1 },
  ],
  [
    { topHour: 1.5, durationHours: 1 },
    { topHour: 4.5, durationHours: 1 },
    { topHour: 8, durationHours: 1.5 },
  ],
  [
    { topHour: 0.75, durationHours: 1.5 },
    { topHour: 5, durationHours: 1 },
  ],
  [
    { topHour: 2, durationHours: 1 },
    { topHour: 6, durationHours: 1 },
    { topHour: 9, durationHours: 1 },
  ],
];

export function CalendarColumnSkeleton({
  columnIndex = 0,
  hours,
  className,
}: {
  columnIndex?: number;
  hours?: number[];
  className?: string;
}) {
  const slots = SLOT_TEMPLATES[columnIndex % SLOT_TEMPLATES.length];
  return (
    <div className={cn("relative", className)}>
      {hours?.map((hour) => <div key={hour} className="h-24 border-b border-border/40" />)}
      {slots.map((slot, i) => (
        <Skeleton
          key={i}
          className="absolute left-1 right-1 rounded-md"
          style={{
            top: `${slot.topHour * HOUR_HEIGHT}px`,
            height: `${slot.durationHours * HOUR_HEIGHT - 8}px`,
          }}
        />
      ))}
    </div>
  );
}

export function AgendaCardSkeleton() {
  return (
    <div className="w-full rounded-lg border border-border/40 p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-40" />
        </div>
        <Skeleton className="h-5 w-16 shrink-0 rounded-full" />
      </div>
    </div>
  );
}

export function AgendaListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <AgendaCardSkeleton key={i} />
      ))}
    </div>
  );
}

export function MonthDayCellSkeleton({ chips }: { chips: number }) {
  if (chips === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      {Array.from({ length: chips }).map((_, i) => (
        <Skeleton key={i} className="h-4 w-full rounded" />
      ))}
    </div>
  );
}
