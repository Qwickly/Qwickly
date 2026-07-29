import type { ComponentType } from "react";
import { Link } from "wouter";
import { ArrowUpRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useCountUp } from "@/hooks/use-count-up";
import { cn } from "@/lib/utils";

type MetricCardProps = {
  title: string;
  numericValue?: number;
  textValue?: string;
  formatValue: (value: number) => string;
  change?: number;
  icon: ComponentType<{ className?: string }>;
  detail?: string;
  loading: boolean;
  inverse?: boolean;
  href?: string;
};

export function MetricCard({
  title,
  numericValue,
  textValue,
  formatValue,
  change,
  icon: Icon,
  detail,
  loading,
  inverse = false,
  href,
}: MetricCardProps) {
  const isPositive = (change ?? 0) > 0;
  const isGood = inverse ? !isPositive : isPositive;
  const hasUsefulChange = typeof change === "number" && Math.abs(change) > 0;
  const hasNumericValue = typeof numericValue === "number" && Number.isFinite(numericValue);
  const animatedValue = useCountUp(hasNumericValue ? numericValue! : 0, { enabled: !loading && hasNumericValue });
  const displayValue = textValue ?? (hasNumericValue ? formatValue(Math.round(animatedValue)) : "-");

  const card = (
    <Card className={cn("overflow-hidden transition-colors", href && "hover:border-primary/25 hover:bg-primary/5")}>
      <CardContent className="flex h-[138px] flex-col justify-between p-4 sm:h-[156px] sm:p-5">
        <div className="flex items-center justify-between gap-2 sm:gap-3">
          <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-primary/15 bg-primary/10 text-primary">
              <Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </div>
            <p className="truncate text-xs font-semibold text-muted-foreground">{title}</p>
          </div>
          {href ? (
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-background text-muted-foreground">
              <ArrowUpRight className="h-4 w-4" />
            </div>
          ) : null}
        </div>

        <div className="space-y-1.5 sm:space-y-2">
          {loading ? (
            <div className="h-8 w-20 animate-pulse rounded-md bg-muted sm:h-9 sm:w-28" />
          ) : (
            <p className="truncate text-2xl font-semibold tabular-nums tracking-tight text-foreground sm:text-3xl lg:text-[2.15rem]">{displayValue}</p>
          )}
          <div className="flex items-end justify-between gap-3">
            <p className="line-clamp-2 min-w-0 text-xs font-medium text-muted-foreground">{detail}</p>
            {!loading && hasUsefulChange ? (
              <span
                className={cn(
                  "shrink-0 rounded-md border px-2 py-1 text-[11px] font-semibold",
                  isGood
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-red-200 bg-red-50 text-red-700",
                )}
              >
                {isPositive ? "+" : "-"}
                {Math.abs(change ?? 0)}%
              </span>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );

  if (href) {
    return (
      <Link href={href} className="block">
        {card}
      </Link>
    );
  }

  return card;
}
