import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The one pager for every list page. services.tsx and staff.tsx shared this
 * already; bookings.tsx and clients.tsx kept their own copy with a better
 * mobile layout (full-width row, Prev/Next flexed to fill, shortened labels),
 * so that layout was folded in here and the copies deleted.
 *
 * The count line shows whenever there is anything to count; the page numbers
 * appear only once there is more than one page, so a single-page list does not
 * get a "Previous 1 Next" strip that does nothing.
 */
export function EntityListPagination({
  currentPage,
  totalPages,
  onPageChange,
  totalCount,
  pageSize,
  itemLabel,
}: {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  totalCount: number;
  pageSize: number;
  itemLabel: string;
}) {
  if (totalCount === 0) return null;

  const rangeStart = Math.min((currentPage - 1) * pageSize + 1, totalCount);
  const rangeEnd = Math.min(currentPage * pageSize, totalCount);

  return (
    <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
      <p className="text-sm text-muted-foreground">
        Showing {rangeStart}-{rangeEnd} of {totalCount} {itemLabel}
      </p>
      {totalPages > 1 ? (
        <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-end">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 sm:flex-none"
            onClick={() => onPageChange(currentPage - 1)}
            disabled={currentPage === 1}
          >
            <ChevronLeft className="h-4 w-4" />
            <span className="ml-1 hidden sm:inline">Previous</span>
            <span className="ml-1 sm:hidden">Prev</span>
          </Button>
          <div className="flex items-center gap-1">
            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
              let pageNum;
              if (totalPages <= 5) {
                pageNum = i + 1;
              } else if (currentPage <= 3) {
                pageNum = i + 1;
              } else if (currentPage >= totalPages - 2) {
                pageNum = totalPages - 4 + i;
              } else {
                pageNum = currentPage - 2 + i;
              }
              return (
                <Button
                  key={pageNum}
                  variant={currentPage === pageNum ? "default" : "outline"}
                  size="sm"
                  className="h-8 w-8"
                  onClick={() => onPageChange(pageNum)}
                >
                  {pageNum}
                </Button>
              );
            })}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="flex-1 sm:flex-none"
            onClick={() => onPageChange(currentPage + 1)}
            disabled={currentPage === totalPages}
          >
            <span className="mr-1">Next</span>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
