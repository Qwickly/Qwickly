import { useEffect, useMemo, useState, type ReactNode } from "react";
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
import { AlertTriangle, Loader2, Wallet, CreditCard, Banknote, Clock, RotateCcw, Download, Settings, ExternalLink } from "lucide-react";
import { downloadCsv, rowsToCsv } from "@/lib/csv";
import { MetricCard } from "@/components/dashboard/metric-card";
import { PaymentCardListSkeleton } from "@/components/skeletons/payment-skeleton";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchPayFastConfig, type PayFastProviderConfig } from "@/lib/payment-providers";
import { PaymentStatusBadge, PaymentTypeBadge } from "@/components/ui/status-badge";
import {
  DataViewToolbar,
  PageEmptyState,
  PageHeader,
  type DataViewMode,
} from "@/components/layout/page-ui";
import { EntityListPagination } from "@/components/layout/entity-list-pagination";
import { TableRowsSkeleton } from "@/components/skeletons/table-skeleton";

type PayFastSandboxResponse = {
  action: string;
  paymentId: string;
  fields: Record<string, string>;
};

const PAGE_SIZE = 10;

const HEAD_CLASS = "h-10 text-[11px] font-semibold uppercase tracking-[0.02em] text-muted-foreground";

function PaymentsTable({ children }: { children: ReactNode }) {
  return (
    <Card className="gap-0 overflow-hidden rounded-xl border-border/70 bg-card py-0 shadow-none">
      <div className="overflow-x-auto">
        <Table className="min-w-[520px] table-fixed [&_td]:px-3 [&_th]:px-3 md:min-w-[880px] md:[&_td]:px-4 md:[&_th]:px-4">
          <colgroup>
            <col className="w-[26%] md:w-[16%]" />
            <col className="w-[30%] md:w-[20%]" />
            <col className="hidden md:table-column md:w-[12%]" />
            <col className="hidden md:table-column md:w-[13%]" />
            <col className="hidden xl:table-column xl:w-[17%]" />
            <col className="w-[24%] md:w-[12%]" />
            <col className="w-[20%] md:w-[10%]" />
          </colgroup>
          <TableHeader className="bg-muted/15">
            <TableRow className="hover:bg-transparent">
              <TableHead className={HEAD_CLASS}>Date</TableHead>
              <TableHead className={HEAD_CLASS}>Client</TableHead>
              <TableHead className={`hidden md:table-cell ${HEAD_CLASS}`}>Type</TableHead>
              <TableHead className={`hidden md:table-cell ${HEAD_CLASS}`}>Method</TableHead>
              <TableHead className={`hidden xl:table-cell ${HEAD_CLASS}`}>Reference</TableHead>
              <TableHead className={HEAD_CLASS}>Status</TableHead>
              <TableHead className={`text-right ${HEAD_CLASS}`}>Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>{children}</TableBody>
        </Table>
      </div>
    </Card>
  );
}

export default function PaymentsPage() {
  const queryClient = useQueryClient();
  const [location, setLocation] = useLocation();
  const [method, setMethod] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [dataView, setDataView] = useState<DataViewMode>(() =>
    typeof window !== "undefined" && window.innerWidth < 768 ? "cards" : "table",
  );
  const [creatingTestPayment, setCreatingTestPayment] = useState(false);
  const [testPaymentError, setTestPaymentError] = useState<string | null>(null);
  const {
    settings,
    loading: loadingSettings,
    error: settingsError,
    reload: reloadSettings,
  } = useSettings();
  // Whether an account is actually connected, which is a separate thing from
  // the Settings toggle being on — and the difference decides whether a client's
  // deposit reaches a real merchant account or PayFast's sandbox.
  const { data: payFastConfig, isLoading: loadingPayFast } = useQuery<PayFastProviderConfig | null>({
    queryKey: ["payfast-config"],
    queryFn: fetchPayFastConfig,
    retry: false,
  });

  // Connected credentials are the real signal, and the only one a business can
  // still produce: Settings' PayFast row drives `payment_provider_credentials`
  // and deliberately never touches the older `payment_provider_settings` toggle
  // this used to read on its own. Nothing has flipped that toggle since the
  // credentials flow landed, so a business that connected PayFast properly was
  // still told to go and set up a payment provider — forever.
  //
  // The legacy toggle stays in the condition for accounts that flipped it
  // before the change, whose payments are real and whose page should not
  // suddenly empty out.
  const legacyPayFastToggle = Boolean(
    settings?.paymentProviders.some((provider) => provider.provider_key === "payfast" && provider.enabled),
  );
  const hasEnabledPaymentProvider = Boolean(payFastConfig?.connected) || legacyPayFastToggle;

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

  const getMethodIcon = (method: string) => {
    switch (method) {
      case "cash":
        return <Banknote className="w-4 h-4 text-muted-foreground" />;
      case "eft":
        return <Wallet className="w-4 h-4 text-muted-foreground" />;
      default:
        return <CreditCard className="w-4 h-4 text-muted-foreground" />;
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
      <PageHeader
        title="Payments"
        description="Track transactions, deposits, and refunds."
        actions={
          <Button
            variant="outline"
            className="w-full sm:w-auto shrink-0 bg-card"
            disabled={filteredPayments.length === 0}
            onClick={handleExportCsv}
          >
            <Download className="w-4 h-4 mr-2" />
            Export CSV
          </Button>
        }
      />

      {loadingSettings || loadingPayFast ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-28 w-full rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-9 w-full rounded-md" />
          <Skeleton className="h-72 w-full rounded-xl" />
        </div>
      ) : settingsError ? (
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
      ) : !hasEnabledPaymentProvider ? (
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
          {/*
            Enabled but not connected means every deposit is signed with the
            shared sandbox merchant account and sent to PayFast's sandbox
            checkout — see resolvePayFastCredentials's fallback. The booking
            completes and the payment records, and no money ever moves. Worth
            saying loudly, because the page below it will happily show the
            revenue as though it were real.
          */}
          {payFastConfig?.connected && payFastConfig.mode === "sandbox" ? (
            <div className="flex flex-col gap-3 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    PayFast is in test mode
                  </p>
                  <p className="mt-0.5 text-sm leading-6 text-muted-foreground">
                    Deposits below completed against PayFast&apos;s sandbox, so none of this money
                    was actually collected. Switch to Live in Settings before sharing your booking
                    link.
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                className="shrink-0"
                onClick={() => setLocation("/settings?tab=payments")}
              >
                Switch to Live
              </Button>
            </div>
          ) : null}

          {!payFastConfig?.connected ? (
            <div className="flex flex-col gap-3 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    PayFast is switched on, but no account is connected
                  </p>
                  <p className="mt-0.5 text-sm leading-6 text-muted-foreground">
                    Deposits are going to PayFast&apos;s test checkout, so nothing your clients pay
                    reaches you. Connect your merchant account to start taking real payments.
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                className="shrink-0"
                onClick={() => setLocation("/settings?tab=payments")}
              >
                Connect PayFast
              </Button>
            </div>
          ) : null}

          {/* Dev-only: fires a signed R10 payment at the shared PayFast
              sandbox so the whole pipeline — row, redirect, ITN, status flip —
              can be exercised without a real card. Stripped from production
              builds by the import.meta.env.DEV guard. */}
          {import.meta.env.DEV ? (
            <div className="flex flex-col gap-3 rounded-xl border border-dashed border-border/70 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-foreground">PayFast sandbox test</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Development only. Saves a pending R10 payment, then updates it when the sandbox
                  ITN lands.
                </p>
                {testPaymentError ? (
                  <p className="mt-1 text-sm font-medium text-destructive">{testPaymentError}</p>
                ) : null}
              </div>
              <Button
                variant="outline"
                className="shrink-0"
                onClick={launchPayFastSandboxPayment}
                disabled={creatingTestPayment}
              >
                {creatingTestPayment ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ExternalLink className="h-4 w-4" />
                )}
                Make test payment
              </Button>
            </div>
          ) : null}

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

          <DataViewToolbar viewMode={dataView} onViewModeChange={setDataView}>
            <div className="min-w-0 flex-1">
              <Input
                placeholder="Search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger className="w-[150px]">
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
          </DataViewToolbar>

          {loadingPayments ? (
            dataView === "table" ? (
              <PaymentsTable>
                <TableRowsSkeleton rows={PAGE_SIZE} columns={7} />
              </PaymentsTable>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <PaymentCardListSkeleton count={4} />
              </div>
            )
          ) : filteredPayments.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex min-h-64 items-center justify-center">
                <PageEmptyState
                  icon={CreditCard}
                  title={
                    (payments?.length ?? 0) === 0
                      ? "No transactions yet"
                      : "No payments match your filters"
                  }
                  description={
                    (payments?.length ?? 0) === 0
                      ? "Deposits and payments will appear here as clients pay them."
                      : undefined
                  }
                />
              </CardContent>
            </Card>
          ) : dataView === "table" ? (
            <PaymentsTable>
              {paginatedPayments.map((payment) => (
                <TableRow
                  key={payment.id}
                  className="group h-16 border-border/50 transition-colors hover:bg-muted/20 [&_td]:align-middle [&_td]:py-3.5"
                >
                  <TableCell>
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-medium text-foreground">
                        {format(new Date(payment.date), "MMM d, yyyy")}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(payment.date), "h:mm a")}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="truncate text-sm font-medium text-foreground">
                    {payment.clientName}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <PaymentTypeBadge type={payment.type} />
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <div className="flex items-center gap-2 text-sm capitalize text-muted-foreground">
                      {getMethodIcon(payment.method)}
                      <span>{payment.method}</span>
                    </div>
                  </TableCell>
                  <TableCell className="hidden xl:table-cell">
                    <span className="truncate font-mono text-xs text-muted-foreground">
                      {payment.providerReference ?? "—"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <PaymentStatusBadge status={payment.status} />
                  </TableCell>
                  <TableCell className="text-right text-sm font-semibold tabular-nums text-foreground">
                    {payment.type === "refund" ? "−" : ""}
                    {formatCurrency(payment.amount)}
                  </TableCell>
                </TableRow>
              ))}
            </PaymentsTable>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {paginatedPayments.map((payment) => (
                <Card key={payment.id}>
                  <CardContent className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <p className="truncate text-sm font-semibold text-foreground">
                          {payment.clientName}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {format(new Date(payment.date), "MMM d, yyyy • h:mm a")}
                        </p>
                      </div>
                      <PaymentStatusBadge status={payment.status} className="shrink-0" />
                    </div>

                    <div className="flex items-end justify-between gap-3 rounded-lg border border-border/45 bg-muted/20 p-3">
                      <div className="min-w-0 space-y-1.5">
                        <PaymentTypeBadge type={payment.type} />
                        <div className="flex items-center gap-2 text-xs capitalize text-muted-foreground">
                          {getMethodIcon(payment.method)}
                          <span>{payment.method}</span>
                        </div>
                      </div>
                      <p className="shrink-0 text-lg font-semibold tabular-nums text-foreground">
                        {payment.type === "refund" ? "−" : ""}
                        {formatCurrency(payment.amount)}
                      </p>
                    </div>

                    <p className="truncate font-mono text-xs text-muted-foreground">
                      {payment.providerReference ?? "—"}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          <EntityListPagination
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
            totalCount={filteredPayments.length}
            pageSize={PAGE_SIZE}
            itemLabel="payments"
          />

        </>
      )}
    </div>
  );
}

