import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ChartSkeleton, ListRowsSkeleton } from "@/components/skeletons/dashboard-skeletons";
import { cn } from "@/lib/utils";

export function PageHeaderSkeleton({ actions = 1 }: { actions?: number }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-2">
        <Skeleton className="h-8 w-52" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      {actions > 0 ? (
        <div className="flex gap-2">
          {Array.from({ length: actions }).map((_, index) => (
            <Skeleton key={index} className="h-10 w-28 rounded-md" />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function MetricPanelSkeleton({ count = 4 }: { count?: number }) {
  return (
    <section className="overflow-hidden rounded-xl border border-border/60">
      <div className={cn("grid gap-px bg-border/60", count === 3 ? "sm:grid-cols-3" : "grid-cols-2 sm:grid-cols-4")}>
        {Array.from({ length: count }).map((_, index) => (
          <div key={index} className="flex flex-col gap-2 bg-card p-4 sm:p-5">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-7 w-24" />
            <Skeleton className="h-3 w-32" />
          </div>
        ))}
      </div>
    </section>
  );
}

export function DetailPageSkeleton() {
  return (
    <div className="space-y-6 pb-12">
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <Skeleton className="h-8 w-24" />
          <div className="flex gap-2">
            <Skeleton className="h-10 w-28 rounded-md" />
            <Skeleton className="h-10 w-10 rounded-md" />
          </div>
        </div>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <Skeleton className="h-16 w-16 rounded-full" />
          <div className="min-w-0 flex-1 space-y-3">
            <div className="flex items-center gap-3">
              <Skeleton className="h-8 w-56" />
              <Skeleton className="h-6 w-20 rounded-full" />
            </div>
            <div className="flex flex-wrap gap-3">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-4 w-44" />
              <Skeleton className="h-4 w-32" />
            </div>
          </div>
        </div>
      </div>

      <MetricPanelSkeleton count={4} />

      <div className="grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
        <Card className="border-border/60 shadow-none">
          <CardHeader className="border-b border-border/60 pb-4">
            <Skeleton className="h-5 w-40" />
          </CardHeader>
          <CardContent className="p-4">
            <ListRowsSkeleton rows={5} />
          </CardContent>
        </Card>
        <Card className="border-border/60 shadow-none">
          <CardHeader className="border-b border-border/60 pb-4">
            <Skeleton className="h-5 w-36" />
          </CardHeader>
          <CardContent className="space-y-4 p-4">
            <Skeleton className="h-24 rounded-lg" />
            <Skeleton className="h-24 rounded-lg" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export function FormPageSkeleton() {
  return (
    <div className="space-y-6 pb-12">
      <PageHeaderSkeleton actions={1} />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card className="border-border/60 shadow-none">
          <CardHeader className="border-b border-border/60 pb-4">
            <Skeleton className="h-5 w-44" />
            <Skeleton className="h-4 w-64" />
          </CardHeader>
          <CardContent className="space-y-5 p-5">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="space-y-2">
                <Skeleton className="h-4 w-28" />
                <Skeleton className={cn("h-11 rounded-md", index === 4 && "h-28")} />
              </div>
            ))}
          </CardContent>
        </Card>
        <Card className="border-border/60 shadow-none">
          <CardContent className="space-y-4 p-5">
            <Skeleton className="h-32 rounded-xl" />
            <ListRowsSkeleton rows={4} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export function PublicBookingSkeleton() {
  return (
    <div className="min-h-screen bg-muted/30 px-4 py-8">
      <div className="mx-auto max-w-3xl space-y-6">
        <Card className="border-border/60 shadow-sm">
          <CardContent className="space-y-5 p-6 text-center">
            <Skeleton className="mx-auto h-16 w-16 rounded-full" />
            <div className="space-y-2">
              <Skeleton className="mx-auto h-7 w-56" />
              <Skeleton className="mx-auto h-4 w-72 max-w-full" />
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/60 shadow-sm">
          <CardContent className="space-y-4 p-5">
            <Skeleton className="h-5 w-36" />
            <div className="grid gap-3 sm:grid-cols-2">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-16 rounded-lg" />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export function ChatPageSkeleton() {
  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col space-y-6">
      <PageHeaderSkeleton actions={0} />
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden border-border/60 shadow-none">
        <div className="flex-1 space-y-4 overflow-hidden bg-muted/20 p-4 sm:p-6">
          {Array.from({ length: 6 }).map((_, index) => {
            const inbound = index % 2 === 0;
            return (
              <div key={index} className={cn("flex items-end gap-3", inbound ? "justify-start" : "justify-end")}>
                {inbound ? <Skeleton className="h-9 w-9 rounded-full" /> : null}
                <div className={cn("space-y-2 rounded-2xl p-3", inbound ? "w-2/3 bg-card" : "w-3/5 bg-primary/10")}>
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-4/5" />
                </div>
              </div>
            );
          })}
        </div>
        <div className="border-t border-border/60 p-4">
          <Skeleton className="mx-auto h-12 max-w-3xl rounded-full" />
        </div>
      </Card>
    </div>
  );
}

export function BotSetupSkeleton({ showHeader = true }: { showHeader?: boolean }) {
  return (
    <div className="space-y-6 pb-12">
      {showHeader ? <PageHeaderSkeleton actions={1} /> : null}
      <Card className="border-border/60 shadow-none">
        <CardContent className="space-y-5 p-5">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-2">
              <Skeleton className="h-5 w-44" />
              <Skeleton className="h-4 w-72 max-w-full" />
            </div>
            <Skeleton className="h-8 w-14 rounded-full" />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Skeleton className="h-24 rounded-lg" />
            <Skeleton className="h-24 rounded-lg" />
            <Skeleton className="h-24 rounded-lg" />
          </div>
        </CardContent>
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <Card key={index} className="border-border/60 shadow-none">
            <CardHeader className="border-b border-border/60 pb-4">
              <Skeleton className="h-5 w-44" />
              <Skeleton className="h-4 w-60" />
            </CardHeader>
            <CardContent className="space-y-4 p-5">
              <ListRowsSkeleton rows={3} />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

export function BillingPageSkeleton() {
  return (
    <div className="space-y-8 pb-12">
      <PageHeaderSkeleton actions={1} />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card className="border-border/60 shadow-none">
          <CardContent className="space-y-5 p-6">
            <Skeleton className="h-6 w-44" />
            <Skeleton className="h-10 w-32" />
            <div className="grid gap-3 sm:grid-cols-3">
              <Skeleton className="h-20 rounded-lg" />
              <Skeleton className="h-20 rounded-lg" />
              <Skeleton className="h-20 rounded-lg" />
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/60 shadow-none">
          <CardContent className="space-y-4 p-5">
            <ChartSkeleton className="h-40" />
          </CardContent>
        </Card>
      </div>
      <MetricPanelSkeleton count={4} />
      <Card className="border-border/60 shadow-none">
        <CardContent className="p-5">
          <ListRowsSkeleton rows={5} />
        </CardContent>
      </Card>
    </div>
  );
}
