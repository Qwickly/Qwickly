import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function EntityCardSkeleton() {
  return (
    <Card className="overflow-hidden border-2 border-primary/10 bg-card shadow-sm">
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <Skeleton className="h-12 w-12 rounded-full" />
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3.5 w-2/3" />
          <Skeleton className="h-3.5 w-1/2" />
        </div>
        <div className="mt-auto flex items-end justify-between gap-3 border-t border-border/50 pt-4">
          <div className="flex gap-4">
            <div className="flex flex-col gap-1.5">
              <Skeleton className="h-3 w-10" />
              <Skeleton className="h-4 w-12" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Skeleton className="h-3 w-10" />
              <Skeleton className="h-4 w-12" />
            </div>
          </div>
          <Skeleton className="h-3.5 w-16" />
        </div>
      </CardContent>
    </Card>
  );
}

export function EntityGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <EntityCardSkeleton key={i} />
      ))}
    </div>
  );
}
