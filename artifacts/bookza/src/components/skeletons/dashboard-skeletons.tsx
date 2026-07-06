import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const barHeights = [40, 65, 50, 80, 55, 70, 45, 90, 60, 75, 50, 85];

export function ChartSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("flex h-64 w-full items-end gap-2", className)}>
      {barHeights.map((height, i) => (
        <Skeleton key={i} className="flex-1 rounded-t-md" style={{ height: `${height}%` }} />
      ))}
    </div>
  );
}

export function ListRowsSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="divide-y divide-slate-100">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
          <div className="flex min-w-0 items-center gap-3">
            <Skeleton className="h-11 w-11 shrink-0 rounded-lg" />
            <div className="flex flex-col gap-1.5">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-40" />
            </div>
          </div>
          <Skeleton className="h-5 w-14 shrink-0 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export function HeatmapSkeleton({ hourRows = 7 }: { hourRows?: number }) {
  return (
    <div className="mt-6 grid grid-cols-[32px_1fr] gap-3">
      <div className="grid gap-1.5">
        {Array.from({ length: hourRows }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-8" />
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {Array.from({ length: hourRows * 7 }).map((_, i) => (
          <Skeleton key={i} className="h-8 rounded-md" />
        ))}
      </div>
    </div>
  );
}

export function SplitStatSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-2.5 w-full rounded-full" />
      <div className="grid grid-cols-2 gap-3">
        <Skeleton className="h-20 rounded-lg" />
        <Skeleton className="h-20 rounded-lg" />
      </div>
    </div>
  );
}
