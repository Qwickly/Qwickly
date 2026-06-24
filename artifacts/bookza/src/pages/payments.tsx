import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { catalogKeys, fetchPayments, fetchPaymentsSummary } from "@/lib/catalog";
import { useSettings } from "@/hooks/use-settings";
import type { PaymentMethod } from "@/types/catalog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";
import { Loader2, ArrowUpRight, ArrowDownRight, Wallet, CreditCard, Banknote, Download, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

export default function PaymentsPage() {
  const [, setLocation] = useLocation();
  const [method, setMethod] = useState<string>("all");
  const {
    settings,
    loading: loadingSettings,
    error: settingsError,
    reload: reloadSettings,
  } = useSettings();
  const hasEnabledPaymentProvider = Boolean(
    settings?.paymentProviders.some((provider) => provider.provider_key === "payfast" && provider.enabled),
  );

  const { data: summary, isLoading: loadingSummary } = useQuery({
    queryKey: catalogKeys.paymentsSummary,
    queryFn: fetchPaymentsSummary,
    enabled: hasEnabledPaymentProvider,
  });

  const { data: payments, isLoading: loadingPayments } = useQuery({
    queryKey: catalogKeys.payments(method),
    queryFn: () =>
      fetchPayments(method !== "all" ? { method: method as PaymentMethod } : undefined),
    enabled: hasEnabledPaymentProvider,
  });

  const formatCurrency = (val: number) => `R ${val.toLocaleString()}`;

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed":
        return "bg-emerald-100 text-emerald-800 border-emerald-200";
      case "pending":
        return "bg-amber-100 text-amber-800 border-amber-200";
      case "refunded":
        return "bg-gray-100 text-gray-800 border-gray-200";
      case "failed":
        return "bg-red-100 text-red-800 border-red-200";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const getTypeBadge = (type: string) => {
    switch (type) {
      case "deposit":
        return (
          <Badge variant="outline" className="text-blue-600 bg-blue-50 border-blue-200">
            Deposit
          </Badge>
        );
      case "full_payment":
        return (
          <Badge variant="outline" className="text-emerald-600 bg-emerald-50 border-emerald-200">
            Full
          </Badge>
        );
      case "refund":
        return (
          <Badge variant="outline" className="text-red-600 bg-red-50 border-red-200">
            Refund
          </Badge>
        );
      default:
        return null;
    }
  };

  const getMethodIcon = (method: string) => {
    switch (method) {
      case "cash":
        return <Banknote className="w-4 h-4 text-emerald-600" />;
      case "eft":
        return <Wallet className="w-4 h-4 text-blue-600" />;
      default:
        return <CreditCard className="w-4 h-4 text-purple-600" />;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Payments</h1>
          <p className="text-muted-foreground text-sm">Track transactions, deposits, and refunds.</p>
        </div>
        <Button variant="outline" className="shrink-0 bg-card" disabled>
          <Download className="w-4 h-4 mr-2" />
          Export CSV
        </Button>
      </div>

      {loadingSettings ? (
        <Card className="shadow-sm border-border/50">
          <CardContent className="flex h-64 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </CardContent>
        </Card>
      ) : settingsError ? (
        <Card className="shadow-sm border-border/50">
          <CardContent className="flex min-h-64 flex-col items-center justify-center gap-4 text-center">
            <div className="rounded-full bg-destructive/10 p-3 text-destructive">
              <CreditCard className="h-6 w-6" />
            </div>
            <div className="space-y-1">
              <h2 className="text-lg font-semibold">Could not check payment setup</h2>
              <p className="max-w-md text-sm text-muted-foreground">{settingsError}</p>
            </div>
            <Button variant="outline" onClick={() => reloadSettings()}>Retry</Button>
          </CardContent>
        </Card>
      ) : !hasEnabledPaymentProvider ? (
        <Card className="shadow-sm border-border/50">
          <CardHeader className="text-center">
            <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <CreditCard className="h-6 w-6" />
            </div>
            <CardTitle>Set up a payment provider</CardTitle>
            <CardDescription className="mx-auto max-w-md">
              Enable PayFast in Settings before you can track online deposits and payment transactions here.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center">
            <Button onClick={() => setLocation("/settings?tab=payments")}>
              <Settings className="mr-2 h-4 w-4" />
              Open Payment Settings
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <PaymentMetricCard title="Total Revenue" value={summary?.totalRevenue} change={summary?.revenueChange} loading={loadingSummary} />
        <PaymentMetricCard title="Deposits Collected" value={summary?.depositsCollected} change={summary?.depositsChange} loading={loadingSummary} />
        <PaymentMetricCard title="Outstanding" value={summary?.outstandingPayments} change={summary?.outstandingChange} loading={loadingSummary} inverse />
        <PaymentMetricCard title="Refunds" value={summary?.refunds} change={summary?.refundsChange} loading={loadingSummary} inverse />
      </div>

      <div className="flex flex-col sm:flex-row justify-between items-center gap-4 py-2">
        <h2 className="text-xl font-semibold tracking-tight">Recent Transactions</h2>
        <div className="flex gap-2 w-full sm:w-auto">
          <Select value={method} onValueChange={setMethod}>
            <SelectTrigger className="w-[160px] bg-card">
              <SelectValue placeholder="Method" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Methods</SelectItem>
              <SelectItem value="payfast">PayFast</SelectItem>
              <SelectItem value="yoco">Yoco</SelectItem>
              <SelectItem value="eft">EFT</SelectItem>
              <SelectItem value="cash">Cash</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card className="shadow-sm border-border/50">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Date</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadingPayments ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-64 text-center">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground mx-auto" />
                  </TableCell>
                </TableRow>
              ) : payments?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-64 text-center text-muted-foreground">
                    No transactions found.
                  </TableCell>
                </TableRow>
              ) : (
                payments?.map((payment) => (
                  <TableRow key={payment.id} className="hover:bg-muted/50 transition-colors">
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium text-foreground">{format(new Date(payment.date), "MMM d, yyyy")}</span>
                        <span className="text-xs text-muted-foreground">{format(new Date(payment.date), "h:mm a")}</span>
                      </div>
                    </TableCell>
                    <TableCell className="font-medium">{payment.clientName}</TableCell>
                    <TableCell>{getTypeBadge(payment.type)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 text-muted-foreground capitalize">
                        {getMethodIcon(payment.method)}
                        <span>{payment.method}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn("capitalize rounded-sm", getStatusColor(payment.status))}>
                        {payment.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-bold text-foreground">
                      {payment.type === "refund" ? "-" : ""}
                      {formatCurrency(payment.amount)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
        </>
      )}
    </div>
  );
}

function PaymentMetricCard({
  title,
  value,
  change,
  loading,
  inverse = false,
}: {
  title: string;
  value?: number;
  change?: number;
  loading: boolean;
  inverse?: boolean;
}) {
  const formatCurrency = (val: number) => `R ${val.toLocaleString()}`;
  const isPositive = (change ?? 0) > 0;
  const isGood = inverse ? !isPositive : isPositive;

  return (
    <Card className="shadow-sm border-border/50">
      <CardContent className="p-5 flex flex-col gap-3">
        <p className="text-sm font-medium text-muted-foreground">{title}</p>

        {loading ? (
          <div className="h-8 w-24 bg-muted animate-pulse rounded" />
        ) : (
          <div className="flex items-end justify-between">
            <p className="text-2xl font-bold tracking-tight text-foreground">{formatCurrency(value ?? 0)}</p>
            {change !== undefined && (
              <span
                className={cn(
                  "flex items-center text-xs font-medium px-1.5 py-0.5 rounded-sm",
                  isGood
                    ? "text-emerald-700 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-950/50"
                    : "text-destructive bg-destructive/10",
                )}
              >
                {isPositive ? <ArrowUpRight className="w-3 h-3 mr-0.5" /> : <ArrowDownRight className="w-3 h-3 mr-0.5" />}
                {Math.abs(change)}%
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
