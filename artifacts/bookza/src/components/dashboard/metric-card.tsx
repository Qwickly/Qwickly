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
    <Card className="rounded-2xl border border-transparent bg-emerald-50/70 text-slate-950 shadow-[0_18px_45px_rgba(15,118,110,0.12),0_2px_10px_rgba(15,23,42,0.06)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-emerald-50/85 hover:shadow-[0_22px_52px_rgba(15,118,110,0.15),0_4px_14px_rgba(15,23,42,0.07)]">
      <CardContent className="flex h-[150px] flex-col justify-between p-3 sm:h-[172px] sm:p-5">
        <div className="flex items-center justify-between gap-2 sm:gap-3">
          <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-emerald-200 bg-white/85 text-primary sm:h-8 sm:w-8">
              <Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </div>
            <p className="truncate text-[11px] font-semibold sm:text-xs">{title}</p>
          </div>
          {href ? (
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-white sm:h-9 sm:w-9">
              <ArrowUpRight className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </div>
          ) : null}
        </div>

        <div className="space-y-1.5 sm:space-y-2">
          {loading ? (
            <div className="h-8 w-20 animate-pulse rounded-md bg-emerald-100 sm:h-10 sm:w-28" />
          ) : (
            <p className="truncate text-2xl font-semibold tabular-nums tracking-tight sm:text-4xl lg:text-[2.55rem]">{displayValue}</p>
          )}
          <div className="flex items-end justify-between gap-3">
            <p className="line-clamp-2 min-w-0 text-[11px] font-medium text-slate-500">{detail}</p>
            {!loading && hasUsefulChange ? (
              <span
                className={cn(
                  "shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold",
                  isGood ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700",
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
