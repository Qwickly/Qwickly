import { Calendar, User, Sparkles, Users, Loader2, ExternalLink, Layout } from "lucide-react";
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
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!query || query.trim().length < 2) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        Type at least 2 characters to search
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
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
    <div className="py-2">
      {Object.entries(groupedResults).map(([type, typeResults]) => (
        <div key={type} className="mb-4 last:mb-0">
          <div className="px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            {typeLabels[type as SearchResultType]}
          </div>
          <div className="mt-1 space-y-1">
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
                    "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors hover:bg-muted",
                    "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  )}
                >
                  <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center shrink-0", typeColors[result.type])}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-foreground truncate">{result.title}</div>
                    {result.subtitle && (
                      <div className="text-xs text-muted-foreground truncate">{result.subtitle}</div>
                    )}
                  </div>
                  <ExternalLink className="w-4 h-4 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
