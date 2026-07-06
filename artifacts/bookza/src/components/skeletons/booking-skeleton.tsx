import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TableCell, TableRow } from "@/components/ui/table";

export function BookingRowSkeleton() {
  return (
    <TableRow className="bg-card [&_td]:border-y [&_td]:border-border/50 [&_td]:py-5 [&_td:first-child]:rounded-l-xl [&_td:first-child]:border-l [&_td:last-child]:rounded-r-xl [&_td:last-child]:border-r">
      <TableCell>
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-3 w-20" />
        </div>
      </TableCell>
      <TableCell>
        <Skeleton className="h-4 w-24" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-4 w-20" />
      </TableCell>
      <TableCell>
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-3 w-16" />
        </div>
      </TableCell>
      <TableCell>
        <Skeleton className="h-6 w-20 rounded-full" />
      </TableCell>
      <TableCell className="text-right">
        <Skeleton className="ml-auto h-4 w-16" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-8 w-8 rounded-full" />
      </TableCell>
    </TableRow>
  );
}

export function BookingTableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <BookingRowSkeleton key={i} />
      ))}
    </>
  );
}

export function BookingCardSkeleton() {
  return (
    <Card className="border-border/60 bg-card shadow-sm">
      <div className="space-y-4 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-3.5 w-1/2" />
          <Skeleton className="h-3.5 w-2/3" />
        </div>
        <div className="flex items-center justify-between border-t border-border/50 pt-3">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-14" />
        </div>
      </div>
    </Card>
  );
}

export function BookingCardListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <BookingCardSkeleton key={i} />
      ))}
    </>
  );
}
