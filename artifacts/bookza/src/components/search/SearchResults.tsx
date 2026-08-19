import { Calendar, User, Sparkles, Users, Loader2, Layout } from "lucide-react";
import { SearchResult, SearchResultType } from "@/lib/search";
import { cn } from "@/lib/utils";
import { useLocation } from "wouter";

const typeIcons: Record<SearchResultType, React.ComponentType<{ className?: string }>> = {
  booking: Calendar,
  client: User,
  service: Sparkles,
  staff: Users,
  page: Layout,
};

const typeLabels: Record<SearchResultType, string> = {
  booking: "Booking",
  client: "Client",
  service: "Service",
  staff: "Staff Member",
  page: "Page",
};

const typeColors: Record<SearchResultType, string> = {
  booking: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  client: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
  service: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300",
  staff: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  page: "bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-300",
};

interface SearchResultsProps {
  results: SearchResult[];
  loading?: boolean;
  query: string;
  onSelect?: () => void;
}

export function SearchResults({ results, loading, query, onSelect }: SearchResultsProps) {
  const [, setLocation] = useLocation();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-5">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!query || query.trim().length < 2) {
    return (
      <div className="px-3 py-4 text-center text-xs text-muted-foreground">
        Type at least 2 characters to search
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="px-3 py-4 text-center text-xs text-muted-foreground">
        No results found for "{query}"
      </div>
    );
  }

  const groupedResults = results.reduce((acc, result) => {
    if (!acc[result.type]) {
      acc[result.type] = [];
    }
    acc[result.type].push(result);
    return acc;
  }, {} as Record<SearchResultType, SearchResult[]>);

  return (
    <div className="p-1.5">
      {Object.entries(groupedResults).map(([type, typeResults]) => (
        <div key={type} className="mb-1.5 last:mb-0">
          <div className="px-2 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {typeLabels[type as SearchResultType]}
          </div>
          <div className="space-y-0.5">
            {typeResults.map((result) => {
              const Icon = typeIcons[result.type];
              return (
                <button
                  key={result.id}
                  onClick={() => {
                    setLocation(result.url);
                    onSelect?.();
                  }}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted",
                    "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  )}
                >
                  <div className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-md", typeColors[result.type])}>
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <div className="flex min-w-0 flex-1 items-baseline gap-2">
                    <span className="truncate text-sm text-foreground">{result.title}</span>
                    {result.subtitle && (
                      <span className="truncate text-xs text-muted-foreground">{result.subtitle}</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
