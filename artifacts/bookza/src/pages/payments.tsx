import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { catalogKeys, fetchPayments, fetchPaymentsSummary } from "@/lib/catalog";
import { useSettings } from "@/hooks/use-settings";
import { supabase } from "@/lib/supabase";
import type { PaymentMethod } from "@/types/catalog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";
import { Loader2, Wallet, CreditCard, Banknote, Clock, RotateCcw, Download, Settings, ExternalLink, Search, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { downloadCsv, rowsToCsv } from "@/lib/csv";
import { MetricCard } from "@/components/dashboard/metric-card";
import { PaymentsTableSkeleton, PaymentCardListSkeleton } from "@/components/skeletons/payment-skeleton";

type PayFastSandboxResponse = {
  action: string;
  paymentId: string;
  fields: Record<string, string>;
};

const PAGE_SIZE = 10;

export default function PaymentsPage() {
  const queryClient = useQueryClient();
  const [location, setLocation] = useLocation();
  const [method, setMethod] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
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

  const filteredPayments = useMemo(() => {
    const query = search.trim().toLowerCase();
    const list = payments ?? [];
    if (!query) return list;

    return list.filter((payment) =>
      [
        payment.clientName,
        payment.method,
        payment.type,
        payment.status,
        payment.providerReference ?? "",
        `R ${payment.amount.toLocaleString()}`,
        format(new Date(payment.date), "MMM d, yyyy"),
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query)),
    );
  }, [payments, search]);

  const totalPages = Math.max(1, Math.ceil(filteredPayments.length / PAGE_SIZE));
  const paginatedPayments = filteredPayments.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [method, search]);

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

  // Exports exactly what the current search + method filter shows — same csv
  // helpers the Bookings export uses.
  const handleExportCsv = () => {
    if (filteredPayments.length === 0) return;
    const csv = rowsToCsv(
      ["Date", "Client", "Type", "Method", "Status", "Amount (R)", "Reference"],
      filteredPayments.map((p) => [
        format(new Date(p.date), "yyyy-MM-dd HH:mm"),
        p.clientName,
        p.type.replace(/_/g, " "),
        p.method,
        p.status,
        p.amount,
        p.providerReference ?? "",
      ]),
    );
    downloadCsv(`payments-${format(new Date(), "yyyy-MM-dd")}.csv`, csv);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Payments</h1>
          <p className="text-muted-foreground text-sm">Track transactions, deposits, and refunds.</p>
        </div>
        <Button
          variant="outline"
          className="w-full sm:w-auto shrink-0 bg-card"
          disabled={filteredPayments.length === 0}
          onClick={handleExportCsv}
        >
          <Download className="w-4 h-4 mr-2" />
          Export CSV
        </Button>
      </div>

      {settingsError ? (
        <Card>
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
      ) : !loadingSettings && !hasEnabledPaymentProvider ? (
        <Card>
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
          <Card>
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

          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            <MetricCard
              title="Total Revenue"
              numericValue={summary?.totalRevenue}
              formatValue={formatCurrency}
              change={summary?.revenueChange}
              icon={CreditCard}
              detail="All-time revenue"
              loading={loadingSettings || loadingSummary}
            />
            <MetricCard
              title="Deposits Collected"
              numericValue={summary?.depositsCollected}
              formatValue={formatCurrency}
              change={summary?.depositsChange}
              icon={Wallet}
              detail="Collected to date"
              loading={loadingSettings || loadingSummary}
            />
            <MetricCard
              title="Outstanding"
              numericValue={summary?.outstandingPayments}
              formatValue={formatCurrency}
              change={summary?.outstandingChange}
              icon={Clock}
              detail="Awaiting payment"
              loading={loadingSettings || loadingSummary}
              inverse
            />
            <MetricCard
              title="Refunds"
              numericValue={summary?.refunds}
              formatValue={formatCurrency}
              change={summary?.refundsChange}
              icon={RotateCcw}
              detail="Refunded to clients"
              loading={loadingSettings || loadingSummary}
              inverse
            />
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search payments..."
                className="w-full pl-9"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger className="w-full sm:w-[170px]">
                <SelectValue placeholder="Method" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All methods</SelectItem>
                <SelectItem value="payfast">PayFast</SelectItem>
                <SelectItem value="yoco">Yoco</SelectItem>
                <SelectItem value="eft">EFT</SelectItem>
                <SelectItem value="cash">Cash</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Card className="hidden overflow-hidden md:block">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
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
                  {loadingSettings || loadingPayments ? (
                    <PaymentsTableSkeleton rows={6} />
                  ) : filteredPayments.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="h-64 text-center text-muted-foreground">
                        {(payments?.length ?? 0) === 0
                          ? "No transactions found."
                          : "No payments match your filters."}
                      </TableCell>
                    </TableRow>
                  ) : (
                    paginatedPayments.map((payment) => (
                      <TableRow
                        key={payment.id}
                        className="[&_td]:py-4"
                      >
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
            {filteredPayments.length > 0 && !(loadingSettings || loadingPayments) && (
              <div className="flex items-center justify-between border-t px-4 py-3">
                <p className="text-sm text-muted-foreground">
                  Showing {Math.min((currentPage - 1) * PAGE_SIZE + 1, filteredPayments.length)}-
                  {Math.min(currentPage * PAGE_SIZE, filteredPayments.length)} of {filteredPayments.length} payments
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage((p) => p - 1)}
                    disabled={currentPage === 1}
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Previous
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
                          onClick={() => setCurrentPage(pageNum)}
                        >
                          {pageNum}
                        </Button>
                      );
                    })}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage((p) => p + 1)}
                    disabled={currentPage === totalPages}
                  >
                    Next
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </Card>

          <div className="flex flex-col gap-4 md:hidden">
            {loadingSettings || loadingPayments ? (
              <PaymentCardListSkeleton count={4} />
            ) : filteredPayments.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                {(payments?.length ?? 0) === 0 ? "No transactions found." : "No payments match your filters."}
                </CardContent>
              </Card>
            ) : (
              paginatedPayments.map((payment) => (
                <Card key={payment.id}>
                  <CardContent className="space-y-4 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-base font-semibold text-foreground">{payment.clientName}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {format(new Date(payment.date), "MMM d, yyyy • h:mm a")}
                        </p>
                      </div>
                      <Badge variant="outline" className={cn("shrink-0 rounded-full px-2 py-1 text-[11px] capitalize", getStatusColor(payment.status))}>
                        {payment.status}
                      </Badge>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div className="rounded-lg border border-border/45 bg-muted/20 p-3">
                        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Payment</p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">{getTypeBadge(payment.type)}</div>
                      </div>
                      <div className="rounded-lg border border-border/45 bg-muted/20 p-3">
                        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Method</p>
                        <div className="mt-2 flex items-center gap-2 capitalize text-foreground">
                          {getMethodIcon(payment.method)}
                          <span>{payment.method}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-end justify-between gap-3 pt-1">
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Reference</p>
                        <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                          {payment.providerReference ?? "-"}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Amount</p>
                        <p className="mt-1 text-lg font-semibold text-primary">
                          {payment.type === "refund" ? "-" : ""}{formatCurrency(payment.amount)}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}

            {filteredPayments.length > 0 && !(loadingSettings || loadingPayments) && (
              <div className="flex flex-col items-center gap-3 pb-4 pt-2">
                <p className="text-xs text-muted-foreground">
                  Showing {Math.min((currentPage - 1) * PAGE_SIZE + 1, filteredPayments.length)}-
                  {Math.min(currentPage * PAGE_SIZE, filteredPayments.length)} of {filteredPayments.length}
                </p>
                <div className="flex w-full items-center justify-between gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => setCurrentPage((p) => p - 1)}
                    disabled={currentPage === 1}
                  >
                    <ChevronLeft className="mr-1 h-4 w-4" />
                    Prev
                  </Button>
                  <div className="px-4 text-sm font-medium">
                    {currentPage} / {totalPages}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => setCurrentPage((p) => p + 1)}
                    disabled={currentPage === totalPages}
                  >
                    Next
                    <ChevronRight className="ml-1 h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

