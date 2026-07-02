import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { catalogKeys, fetchPayments, fetchPaymentsSummary } from "@/lib/catalog";
import { useSettings } from "@/hooks/use-settings";
import { supabase } from "@/lib/supabase";
import type { PaymentMethod } from "@/types/catalog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";
import { Loader2, ArrowUpRight, ArrowDownRight, Wallet, CreditCard, Banknote, Download, Settings, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

type PayFastSandboxResponse = {
  action: string;
  paymentId: string;
  fields: Record<string, string>;
};

export default function PaymentsPage() {
  const queryClient = useQueryClient();
  const [location, setLocation] = useLocation();
  const [method, setMethod] = useState<string>("all");
  const [creatingTestPayment, setCreatingTestPayment] = useState(false);
  const [testPaymentError, setTestPaymentError] = useState<string | null>(null);
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

  const refreshPayments = () => {
    void queryClient.invalidateQueries({ queryKey: ["catalog", "payments"] });
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const payfastStatus = params.get("payfast");
    const paymentId = params.get("payment_id");

    if (!payfastStatus || !paymentId) return;

    const endpoint =
      payfastStatus === "test-success"
        ? `/api/payments/payfast-sandbox/${encodeURIComponent(paymentId)}/complete`
        : payfastStatus === "test-cancelled"
          ? `/api/payments/payfast-sandbox/${encodeURIComponent(paymentId)}/cancel`
          : null;

    if (endpoint) {
      void (async () => {
        const { data } = await supabase.auth.getSession();
        const accessToken = data.session?.access_token;

        await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
        }).catch(() => undefined);

        refreshPayments();
      })();
    } else {
      refreshPayments();
    }

    window.history.replaceState(null, "", window.location.pathname);
  }, [location, queryClient]);

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

  const launchPayFastSandboxPayment = async () => {
    setCreatingTestPayment(true);
    setTestPaymentError(null);

    try {
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;

      const response = await fetch("/api/payments/payfast-sandbox", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ origin: window.location.origin }),
      });

      if (!response.ok) {
        throw new Error("Could not create the PayFast sandbox payment.");
      }

      const { action, fields } = (await response.json()) as PayFastSandboxResponse;
      const form = document.createElement("form");
      form.method = "POST";
      form.action = action;
      form.style.display = "none";

      Object.entries(fields).forEach(([name, value]) => {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = name;
        input.value = value;
        form.appendChild(input);
      });

      document.body.appendChild(form);
      form.submit();
    } catch (err) {
      setTestPaymentError(err instanceof Error ? err.message : "Could not start the test payment.");
      setCreatingTestPayment(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Payments</h1>
          <p className="text-muted-foreground text-sm">Track transactions, deposits, and refunds.</p>
        </div>
        <Button variant="outline" className="w-full sm:w-auto shrink-0 bg-card" disabled>
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
          <Card className="shadow-sm border-border/50">
            <CardContent className="flex flex-col gap-5 p-5 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex gap-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <CreditCard className="h-5 w-5" />
                </div>
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold tracking-tight">PayFast sandbox test</h2>
                    <Badge variant="secondary">Sandbox</Badge>
                  </div>
                  <p className="max-w-2xl text-sm text-muted-foreground">
                    Launch a signed R10.00 test payment in PayFast sandbox. Bookza saves it as pending first, then updates it when PayFast sends a sandbox notification.
                  </p>
                  {testPaymentError && (
                    <p className="text-sm font-medium text-destructive">{testPaymentError}</p>
                  )}
                </div>
              </div>
              <Button onClick={launchPayFastSandboxPayment} disabled={creatingTestPayment} className="w-full sm:w-auto">
                {creatingTestPayment ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <ExternalLink className="mr-2 h-4 w-4" />
                )}
                Make Test Payment
              </Button>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <PaymentMetricCard title="Total Revenue" value={summary?.totalRevenue} change={summary?.revenueChange} loading={loadingSummary} />
            <PaymentMetricCard title="Deposits Collected" value={summary?.depositsCollected} change={summary?.depositsChange} loading={loadingSummary} />
            <PaymentMetricCard title="Outstanding" value={summary?.outstandingPayments} change={summary?.outstandingChange} loading={loadingSummary} inverse />
            <PaymentMetricCard title="Refunds" value={summary?.refunds} change={summary?.refundsChange} loading={loadingSummary} inverse />
          </div>

          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 py-2">
            <h2 className="text-xl font-semibold tracking-tight">All Payments</h2>
            <div className="flex gap-2 w-full sm:w-[220px]">
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger className="w-full bg-card">
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
            <div className="hidden md:block overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Date</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingPayments ? (
                    <TableRow>
                      <TableCell colSpan={7} className="h-64 text-center">
                        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground mx-auto" />
                      </TableCell>
                    </TableRow>
                  ) : payments?.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="h-64 text-center text-muted-foreground">
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
                          <span className="font-mono text-xs text-muted-foreground">
                            {payment.providerReference ?? "-"}
                          </span>
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
            <div className="md:hidden space-y-4 p-0">
              {loadingPayments ? (
                <div className="p-6 text-center">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground mx-auto" />
                </div>
              ) : payments?.length === 0 ? (
                <div className="p-6 text-center text-muted-foreground">
                  No transactions found.
                </div>
              ) : (
                payments.map((payment) => (
                  <Card key={payment.id} className="shadow-sm border-border/50">
                    <CardContent className="p-4 space-y-4">
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-foreground truncate">{payment.clientName}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {format(new Date(payment.date), "MMM d, yyyy • h:mm a")}
                          </p>
                        </div>
                        <Badge variant="outline" className={cn("capitalize rounded-full text-[11px] px-2 py-1", getStatusColor(payment.status))}>
                          {payment.status}
                        </Badge>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-2xl bg-muted/70 p-3">
                          <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Payment</p>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            {getTypeBadge(payment.type)}
                          </div>
                        </div>
                        <div className="rounded-2xl bg-muted/70 p-3">
                          <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Method</p>
                          <div className="mt-2 flex items-center gap-2 text-sm text-foreground capitalize">
                            {getMethodIcon(payment.method)}
                            <span>{payment.method}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
                        <div className="rounded-2xl bg-muted/70 p-3 flex-1">
                          <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Reference</p>
                          <p className="mt-2 text-xs text-foreground break-all">{payment.providerReference ?? "-"}</p>
                        </div>
                        <div className="rounded-2xl bg-primary/10 p-3 text-right sm:text-left min-w-[120px]">
                          <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Amount</p>
                          <p className="mt-2 text-lg font-semibold text-foreground">
                            {payment.type === "refund" ? "-" : ""}{formatCurrency(payment.amount)}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
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
