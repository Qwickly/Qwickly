import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { fetchGettingStartedStatus } from "@/lib/getting-started";

export function GettingStartedBanner() {
  const { data: status } = useQuery({
    queryKey: ["getting-started"],
    queryFn: fetchGettingStartedStatus,
  });

  if (!status || status.completedCount >= status.total) return null;

  const percent = Math.round((status.completedCount / status.total) * 100);

  return (
    <Link href="/get-started" className="block">
      <Card className="tint-primary border-primary/25 transition-colors hover:bg-primary/5">
        <CardContent className="flex items-center gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Sparkles className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">
              Finish setting up your account — {status.completedCount} of {status.total} done
            </p>
            <div className="mt-2 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
          <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </CardContent>
      </Card>
    </Link>
  );
}
