import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CampaignStatusBadge } from "@/components/ui/status-badge";
import {
  DataViewToolbar,
  PageEmptyState,
  PageHeader,
  RoadmapLink,
  type DataViewMode,
} from "@/components/layout/page-ui";
import { EntityListPagination } from "@/components/layout/entity-list-pagination";
import { TableRowsSkeleton } from "@/components/skeletons/table-skeleton";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { ensureBusiness } from "@/lib/settings";
import { uploadCampaignImage } from "@/lib/booking-page-upload";
import { fetchSubscription } from "@/lib/catalog-subscriptions";
import { fetchEmailDomain } from "@/lib/email-domains";
import { buildApiUrl } from "@workspace/api-client-react";
import { sendWhatsappMessage, sendWhatsappMessageMeta } from "@/lib/whatsapp-notify";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  ArrowRight,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  FileText,
  Gauge,
  Loader2,
  Mail,
  Megaphone,
  MessageSquare,
  Plus,
  Search,
  Send,
  Trash2,
  UploadCloud,
  Users,
  X,
} from "lucide-react";

type CampaignChannel = "WhatsApp" | "Email" | "SMS";
type CampaignStatus = "draft" | "active" | "completed";

type Campaign = {
  id: string;
  name: string;
  type: CampaignChannel;
  status: CampaignStatus;
  sent: number;
  opened: number;
  conversions: number;
  createdAt: string;
  message: string;
  imageUrl?: string;
  recipientCount: number;
};

type MarketingClient = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
};

const CLIENT_FETCH_BATCH_SIZE = 100;
const CLIENT_LIST_PAGE_SIZE = 80;
const CAMPAIGN_PAGE_SIZE = 10;
const EMAIL_DAILY_BATCH_SIZE = 100;
const WHATSAPP_SEND_CONCURRENCY = 1;
const WHATSAPP_SEND_PAUSE_MS = 30_000;
const WHATSAPP_STOP_ERROR_PATTERNS = [
  /spam/i,
  /restricted/i,
  /temporary restriction/i,
  /rate.?limit/i,
  /too many/i,
  /blocked/i,
];

const FACEBOOK_OAUTH_SCOPE = "whatsapp_business_management,whatsapp_business_messaging";

function extractWhatsappConnectionData(metaResponse: any): {
  whatsappBusinessAccountId: string | null;
  phoneNumberId: string | null;
} {
  const businesses = metaResponse?.businesses?.data;
  if (!Array.isArray(businesses)) {
    return { whatsappBusinessAccountId: null, phoneNumberId: null };
  }

  for (const business of businesses) {
    const accounts =
      business?.owned_whatsapp_business_accounts?.data ??
      business?.whatsapp_business_accounts?.data;

    if (!Array.isArray(accounts) || accounts.length === 0) {
      continue;
    }

    const firstAccount = accounts[0];
    const phoneNumbers = firstAccount?.phone_numbers?.data;
    const phoneNumberId = Array.isArray(phoneNumbers) && phoneNumbers.length > 0
      ? phoneNumbers[0]?.id ?? null
      : null;

    return {
      whatsappBusinessAccountId: firstAccount?.id ?? null,
      phoneNumberId,
    };
  }

  return { whatsappBusinessAccountId: null, phoneNumberId: null };
}

type CampaignSendProgress = {
  total: number;
  sent: number;
  failed: number;
  processed: number;
  currentClientName: string | null;
};

type CampaignSendResult = {
  ok: boolean;
  client: MarketingClient;
  error?: string;
};

const wait = (ms: number) =>
  new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });

const shouldStopCampaignForError = (message: string) =>
  WHATSAPP_STOP_ERROR_PATTERNS.some((pattern) => pattern.test(message));

async function fetchAllMarketingClients(): Promise<MarketingClient[]> {
  const businessId = await ensureBusiness();
  const clients: MarketingClient[] = [];
  let from = 0;

  while (true) {
    const to = from + CLIENT_FETCH_BATCH_SIZE - 1;
    const { data, error } = await supabase
      .from("clients")
      .select("id, name, phone, email")
      .eq("business_id", businessId)
      // Only clients with an active WhatsApp conversation can receive a campaign
      // (they're messaged from the business's own number). Cold/new contacts would
      // need the Meta route, which is disabled — so they'd be silently skipped at
      // send time. Filter them out here so the selected count matches what's sent.
      .eq("status", "active")
      .order("name", { ascending: true })
      .range(from, to);

    if (error) throw new Error(error.message);

    const rows = data ?? [];
    clients.push(
      ...rows.map((row) => ({
        id: row.id as string,
        name: (row.name as string) ?? "Unnamed client",
        phone: (row.phone as string) ?? "",
        email: (row.email as string | null) ?? null,
      })),
    );

    if (rows.length < CLIENT_FETCH_BATCH_SIZE) break;
    from += CLIENT_FETCH_BATCH_SIZE;
  }

  return clients;
}

function makeId(): string {
  const cryptoObj = globalThis.crypto as
    | undefined
    | { randomUUID?: () => string };
  return cryptoObj?.randomUUID?.() ?? String(Date.now());
}

function detectEmailDelimiter(line: string): string {
  if (line.includes("\t")) return "\t";
  const candidates = [",", ";", "|"] as const;
  const counts = candidates.map((delimiter) => ({ delimiter, count: line.split(delimiter).length }));
  counts.sort((a, b) => b.count - a.count);
  return counts[0]?.delimiter ?? ",";
}

function parseEmailCells(line: string): string[] {
  const delimiter = detectEmailDelimiter(line);
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === delimiter && !inQuotes) {
      cells.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function extractEmailAddresses(text: string): string[] {
  const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
  const seen = new Set<string>();

  const addCandidate = (value: string) => {
    const normalized = value.trim().toLowerCase();
    if (emailRegex.test(normalized)) {
      seen.add(normalized);
    }
  };

  for (const line of text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    for (const cell of parseEmailCells(trimmed)) {
      addCandidate(cell);
    }

    addCandidate(trimmed);
  }

  return Array.from(seen);
}

const HEAD_CLASS = "h-10 text-[11px] font-semibold uppercase tracking-[0.02em] text-muted-foreground";

function CampaignsTable({ children }: { children: ReactNode }) {
  return (
    <Card className="gap-0 overflow-hidden rounded-xl border-border/70 bg-card py-0 shadow-none">
      <div className="overflow-x-auto">
        <Table className="min-w-[600px] table-fixed [&_td]:px-3 [&_th]:px-3 md:min-w-[820px] md:[&_td]:px-4 md:[&_th]:px-4">
          <colgroup>
            <col className="w-[40%] md:w-[30%]" />
            <col className="hidden md:table-column md:w-[12%]" />
            <col className="w-[24%] md:w-[14%]" />
            <col className="hidden md:table-column md:w-[12%]" />
            <col className="w-[18%] md:w-[12%]" />
            <col className="hidden md:table-column md:w-[20%]" />
          </colgroup>
          <TableHeader className="bg-muted/15">
            <TableRow className="hover:bg-transparent">
              <TableHead className={HEAD_CLASS}>Campaign</TableHead>
              <TableHead className={`hidden md:table-cell ${HEAD_CLASS}`}>Channel</TableHead>
              <TableHead className={HEAD_CLASS}>Status</TableHead>
              <TableHead className={`hidden md:table-cell ${HEAD_CLASS}`}>Recipients</TableHead>
              <TableHead className={`text-right ${HEAD_CLASS}`}>Sent</TableHead>
              <TableHead className={`hidden md:table-cell ${HEAD_CLASS}`}>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>{children}</TableBody>
        </Table>
      </div>
    </Card>
  );
}

export default function MarketingPage() {
  const [, navigate] = useLocation();

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(true);
  const [dataView, setDataView] = useState<DataViewMode>(() =>
    typeof window !== "undefined" && window.innerWidth < 768 ? "cards" : "table",
  );
  const [campaignSearch, setCampaignSearch] = useState("");
  const [campaignStatusFilter, setCampaignStatusFilter] = useState<"all" | CampaignStatus>("all");
  const [campaignPage, setCampaignPage] = useState(1);
  const [dailyUsage, setDailyUsage] = useState({ used: 0, limit: 50 });
  const [emailDomainVerified, setEmailDomainVerified] = useState(false);


  const [enableNewContactsDialogOpen, setEnableNewContactsDialogOpen] = useState(false);
  const [metaConnectLoading, setMetaConnectLoading] = useState(false);
  const [metaConnectError, setMetaConnectError] = useState<string | null>(null);
  const [metaWhatsappConnected, setMetaWhatsappConnected] = useState(false);
  const [testPhone, setTestPhone] = useState("");
  const [testMessage, setTestMessage] = useState(
    "Hello from Bookza! This is a quick WhatsApp test message.",
  );
  const [testMessageSending, setTestMessageSending] = useState(false);

  const testMessageMutation = useMutation({
    mutationFn: async (vars: { phone: string; message: string }) =>
      sendWhatsappMessageMeta(vars.phone, vars.message),
    onMutate: () => {
      setTestMessageSending(true);
    },
    onSettled: () => {
      setTestMessageSending(false);
    },
    onSuccess: () => {
      toast("Test message sent", { description: "Your WhatsApp Cloud API test message was sent successfully." });
      setTestPhone("");
      setTestMessage("Hello from Bookza! This is a quick WhatsApp test message.");
    },
    onError: (error) => {
      toast.error("Could not send test message", { description: getErrorMessage(error, "Please try again.") });
    },
  });
  function getErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error) return error.message;
    if (error && typeof error === "object") {
      if (
        typeof (error as any).message === "string" &&
        (error as any).message.trim()
      ) {
        return (error as any).message;
      }
      if (
        typeof (error as any).error === "string" &&
        (error as any).error.trim()
      ) {
        return (error as any).error;
      }
    }
    return fallback;
  }

  const filteredCampaigns = useMemo(() => {
    const query = campaignSearch.trim().toLowerCase();

    return campaigns.filter((campaign) => {
      const matchesStatus =
        campaignStatusFilter === "all" || campaign.status === campaignStatusFilter;
      const matchesSearch =
        !query ||
        campaign.name.toLowerCase().includes(query) ||
        campaign.message.toLowerCase().includes(query) ||
        campaign.type.toLowerCase().includes(query);

      return matchesStatus && matchesSearch;
    });
  }, [campaignSearch, campaignStatusFilter, campaigns]);
  const campaignTotalPages = Math.max(
    1,
    Math.ceil(filteredCampaigns.length / CAMPAIGN_PAGE_SIZE),
  );
  const paginatedCampaigns = filteredCampaigns.slice(
    (campaignPage - 1) * CAMPAIGN_PAGE_SIZE,
    campaignPage * CAMPAIGN_PAGE_SIZE,
  );


  const quotaRemaining = Math.max(dailyUsage.limit - dailyUsage.used, 0);
  const quotaExhausted = quotaRemaining === 0;
  const quotaLow = !quotaExhausted && quotaRemaining <= Math.max(Math.round(dailyUsage.limit * 0.2), 1);
  const quotaNotice = quotaExhausted
    ? `You've used all ${dailyUsage.limit} marketing messages on your plan today. Campaigns can send again tomorrow.`
    : quotaLow
      ? `${quotaRemaining} of ${dailyUsage.limit} marketing messages left today. Campaign sends draw from this daily allowance.`
      : null;

  const formatCampaignDate = (date: string) =>
    new Date(date).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });

  const handleCampaignSearchChange = (value: string) => {
    setCampaignSearch(value);
    setCampaignPage(1);
  };

  const handleCampaignStatusChange = (value: string) => {
    setCampaignStatusFilter(value as "all" | CampaignStatus);
    setCampaignPage(1);
  };

  const handleMetaConnectClick = async () => {
    if (metaConnectLoading) return;
    setMetaConnectLoading(true);
    setMetaConnectError(null);

    try {
      const session = await supabase.auth.getSession();
      const userAccessToken = session.data.session?.access_token;

      const width = 620;
      const height = 700;
      const left = window.screenX + Math.max(0, window.innerWidth - width) / 2;
      const top = window.screenY + Math.max(0, window.innerHeight - height) / 2;

      const popup = window.open(
        "",
        "MetaWhatsAppOAuth",
        `width=${width},height=${height},left=${left},top=${top},resizable,scrollbars`,
      );

      if (!popup) {
        throw new Error("Popup blocked. Please allow popups for this site.");
      }

      popup.document.title = "Connecting to Meta...";
      popup.document.body.style.margin = "1rem";
      popup.document.body.textContent = "Connecting to Facebook. Please wait...";

      const result = await new Promise<{ success: boolean; error?: string }>((resolve, reject) => {
        const timeoutId = window.setTimeout(() => {
          window.removeEventListener("message", messageListener);
          if (popup && !popup.closed) popup.close();
          reject(new Error("Facebook OAuth timed out. Please try again."));
        }, 5 * 60 * 1000);

        function messageListener(event: MessageEvent) {
          const payload = event.data;
          if (!payload || payload.type !== "MetaWhatsAppOAuthResponse") {
            return;
          }

          window.clearTimeout(timeoutId);
          window.removeEventListener("message", messageListener);
          if (popup && !popup.closed) popup.close();

          resolve({
            success: Boolean(payload.success),
            error: payload.error ? String(payload.error) : undefined,
          });
        }

        window.addEventListener("message", messageListener);

        void (async () => {
          try {
            const configResponse = await fetch(buildApiUrl("/api/facebook/config"), {
              headers: {
                "Content-Type": "application/json",
                ...(userAccessToken ? { Authorization: `Bearer ${userAccessToken}` } : {}),
              },
            });

            if (!configResponse.ok) {
              const errorPayload = await configResponse.json().catch(() => null);
              throw new Error(
                errorPayload?.error || `Failed to get Facebook OAuth config (${configResponse.status})`,
              );
            }

            const configData = await configResponse.json();
            const authUrl = String(configData.authUrl || "");
            if (!authUrl) {
              throw new Error("Facebook OAuth authUrl is missing.");
            }

            popup.location.href = authUrl;
          } catch (error) {
            window.clearTimeout(timeoutId);
            window.removeEventListener("message", messageListener);
            if (popup && !popup.closed) popup.close();
            reject(error instanceof Error ? error : new Error("Failed to start Facebook OAuth."));
          }
        })();
      });

      if (!result.success) {
        throw new Error(result.error || "Facebook OAuth connection failed.");
      }

      toast("Meta connection successful", { description: "Your Facebook/WhatsApp Business Account is connected and ready for WhatsApp messaging." });
      setEnableNewContactsDialogOpen(false);
    } catch (error) {
      console.error("❌ Connection flow failed:", error);
      const message = getErrorMessage(error, "Unable to connect Meta account.");
      setMetaConnectError(message);
      toast.error("Connect failed", { description: message });
    } finally {
      setMetaConnectLoading(false);
    }
  };

  useEffect(() => {
    let mounted = true;

    async function checkEmailDomain() {
      try {
        const domain = await fetchEmailDomain();
        if (mounted) setEmailDomainVerified(domain?.status === "verified");
      } catch {
        if (mounted) setEmailDomainVerified(false);
      }
    }

    void checkEmailDomain();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    async function checkMetaConnection() {
      try {
        const businessId = await ensureBusiness();
        const { data } = await supabase.rpc("has_meta_whatsapp_connection", {
          p_business_id: businessId,
        });

        if (mounted) {
          setMetaWhatsappConnected(!!data);
        }
      } catch {
        if (mounted) {
          setMetaWhatsappConnected(false);
        }
      }
    }

    void checkMetaConnection();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    async function loadCampaigns() {
      try {
        setLoadingCampaigns(true);
        const businessId = await ensureBusiness();
        const { data, error } = await supabase
          .from("marketing_campaigns")
          .select("*")
          .eq("business_id", businessId)
          .order("created_at", { ascending: false });

        if (error) {
          console.error("Failed to load campaigns", error.message);
          return;
        }

        if (!mounted || !data) return;
        setCampaigns(
          data.map((row) => ({
            id: row.id,
            name: row.name,
            type: row.channel as CampaignChannel,
            status: row.status as CampaignStatus,
            sent: row.sent ?? 0,
            opened: row.opened ?? 0,
            conversions: row.conversions ?? 0,
            createdAt: row.created_at ?? new Date().toISOString(),
            message: row.message ?? "",
            imageUrl: row.image_url ?? undefined,
            recipientCount: row.recipient_count ?? 0,
          })),
        );
      } finally {
        if (mounted) setLoadingCampaigns(false);
      }
    }

    void loadCampaigns();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    async function loadDailyUsage() {
      try {
        const businessId = await ensureBusiness();
        const today = new Date().toISOString().split("T")[0];
        const [{ data: todayUsage }, subscription] = await Promise.all([
          supabase
            .from("usage_tracking")
            .select("marketing_messages_sent")
            .eq("business_id", businessId)
            .eq("tracking_date", today)
            .single(),
          fetchSubscription(),
        ]);

        let dailyLimit = 50;
        if (subscription?.plans?.metadata) {
          const metadata = subscription.plans.metadata as any;
          dailyLimit = metadata.marketingMessages ?? metadata.marketingMessagesPerDay ?? 50;
        }

        if (mounted) {
          setDailyUsage({
            used: todayUsage?.marketing_messages_sent ?? 0,
            limit: dailyLimit,
          });
        }
      } catch {
        if (mounted) {
          setDailyUsage({ used: 0, limit: 50 });
        }
      }
    }

    void loadDailyUsage();

    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div className="space-y-6 pb-8">
      <PageHeader
        title="Campaigns"
        description="Reach your clients on WhatsApp and email."
        primaryAction={
          <Button onClick={() => navigate("/marketing/campaigns/new")}>
            <Plus className="h-4 w-4 sm:mr-2" />
            <span className="sr-only sm:hidden">Create campaign</span>
            <span className="hidden sm:inline">Create campaign</span>
          </Button>
        }
      />

      {/*
        The four stat cards are gone. Messages sent, total campaigns and
        conversions were numbers you look at once and never act on, and a
        permanent "0/50" quota card answered a question nobody asked while
        never saying what it counted. The quota only matters when it is about
        to stop you, so it speaks up then and stays quiet otherwise.
      */}
      {quotaNotice ? (
        <div
          className={cn(
            "flex flex-col gap-2 rounded-xl border px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between",
            quotaExhausted
              ? "border-destructive/30 bg-destructive/5 text-destructive"
              : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300",
          )}
        >
          <div className="flex items-start gap-2">
            <Gauge className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="leading-6">{quotaNotice}</p>
          </div>
          <Link
            href="/billing"
            className="shrink-0 text-sm font-medium underline underline-offset-4"
          >
            View plan
          </Link>
        </div>
      ) : null}

      <DataViewToolbar viewMode={dataView} onViewModeChange={setDataView}>
        <div className="min-w-0 flex-1">
          <Input
            placeholder="Search"
            value={campaignSearch}
            onChange={(event) => handleCampaignSearchChange(event.target.value)}
          />
        </div>
        <Select value={campaignStatusFilter} onValueChange={handleCampaignStatusChange}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
          </SelectContent>
        </Select>
      </DataViewToolbar>

      {loadingCampaigns ? (
        dataView === "table" ? (
          <CampaignsTable>
            <TableRowsSkeleton rows={CAMPAIGN_PAGE_SIZE} columns={6} />
          </CampaignsTable>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 4 }).map((_, index) => (
              <Card key={index}>
                <CardContent className="space-y-3">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-8 w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        )
      ) : filteredCampaigns.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex h-64 items-center justify-center">
            <PageEmptyState
              icon={Megaphone}
              title={campaigns.length === 0 ? "No campaigns yet" : "No campaigns match your filters"}
              description={
                campaigns.length === 0
                  ? "Create your first campaign to start reaching clients."
                  : undefined
              }
            />
          </CardContent>
        </Card>
      ) : dataView === "table" ? (
        <CampaignsTable>
          {paginatedCampaigns.map((campaign) => (
            <TableRow
              key={campaign.id}
              className="group h-16 border-border/50 transition-colors hover:bg-muted/20 [&_td]:align-middle [&_td]:py-3.5"
            >
              <TableCell>
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-semibold text-foreground">{campaign.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {campaign.message || "No message"}
                  </span>
                </div>
              </TableCell>
              <TableCell className="hidden md:table-cell">
                <Badge variant="outline" className="rounded-full border-primary/20 bg-primary/10 text-primary">
                  {campaign.type}
                </Badge>
              </TableCell>
              <TableCell>
                <CampaignStatusBadge status={campaign.status} />
              </TableCell>
              <TableCell className="hidden text-sm text-foreground/75 md:table-cell">
                {campaign.recipientCount}
              </TableCell>
              <TableCell className="text-right text-sm font-semibold text-foreground">{campaign.sent}</TableCell>
              <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                {formatCampaignDate(campaign.createdAt)}
              </TableCell>
            </TableRow>
          ))}
        </CampaignsTable>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {paginatedCampaigns.map((campaign) => (
            <Card key={campaign.id}>
              <CardContent className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <p className="truncate text-sm font-semibold text-foreground">{campaign.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {campaign.message || "No message"}
                    </p>
                  </div>
                  <CampaignStatusBadge status={campaign.status} className="shrink-0" />
                </div>

                <div className="grid grid-cols-3 gap-2 rounded-lg border border-border/45 bg-muted/20 p-3 text-center">
                  <div>
                    <p className="text-xs text-muted-foreground">Recipients</p>
                    <p className="text-sm font-semibold text-foreground">{campaign.recipientCount}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Sent</p>
                    <p className="text-sm font-semibold text-foreground">{campaign.sent}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Channel</p>
                    <p className="text-sm font-semibold text-foreground">{campaign.type}</p>
                  </div>
                </div>

                <p className="text-xs text-muted-foreground">{formatCampaignDate(campaign.createdAt)}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <EntityListPagination
        currentPage={campaignPage}
        totalPages={campaignTotalPages}
        onPageChange={setCampaignPage}
        totalCount={filteredCampaigns.length}
        pageSize={CAMPAIGN_PAGE_SIZE}
        itemLabel="campaigns"
      />


      <p className="text-xs leading-6 text-muted-foreground">
        Campaigns reach clients you already have a WhatsApp conversation with. New-number outreach,
        SMS and loyalty campaigns are on the way — <RoadmapLink section="marketing-loyalty" />.
      </p>


      <Dialog open={enableNewContactsDialogOpen} onOpenChange={setEnableNewContactsDialogOpen}>
        <DialogContent className="max-w-3xl rounded-3xl border border-border bg-card p-0 shadow-2xl">
          <DialogHeader className="border-b border-border px-6 py-6 sm:px-8">
            <DialogTitle className="text-2xl font-semibold tracking-tight text-foreground">Choose your WhatsApp setup</DialogTitle>
            <DialogDescription className="mt-2 text-sm leading-6 text-muted-foreground">
              Pick the option that best fits how you want customers to reach you.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 px-6 py-6 sm:px-8">
            <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <MessageSquare className="h-5 w-5" />
                </div>
                <div className="space-y-2">
                  <h3 className="font-semibold text-foreground">Use Qwickly</h3>
                  <p className="text-sm leading-6 text-muted-foreground">
                    If you do not already have another WhatsApp number, use the Qwickly number.
                    The WhatsApp page in Qwickly uses the WhatsApp web/JS experience and cannot use a Meta WhatsApp API number directly.
                  </p>
                  <p className="text-sm leading-6 text-muted-foreground">
                    With this option, Qwickly can send a link that directs customers to your WhatsApp chat, or you can use a separate WhatsApp number.
                  </p>
                </div>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-border bg-muted/30 p-5 shadow-sm transition hover:shadow-md">
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-card text-foreground shadow-sm">
                  <MessageSquare className="h-5 w-5" />
                </div>
                <div className="space-y-2">
                  <h4 className="font-semibold text-foreground">Use Qwickly</h4>
                  <p className="text-sm leading-6 text-muted-foreground">
                    Best if you do not already have your own WhatsApp number and want a simple setup.
                  </p>
                </div>
                <Button variant="outline" className="mt-5 w-full justify-center" onClick={() => setEnableNewContactsDialogOpen(false)}>
                  Use Qwickly
                </Button>
              </div>

              <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5 shadow-sm transition hover:shadow-md">
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary shadow-sm">
                  <ArrowRight className="h-5 w-5" />
                </div>
                <div className="space-y-2">
                  <h4 className="font-semibold text-foreground">Use your own</h4>
                  <p className="text-sm leading-6 text-muted-foreground">
                    Connect your own Meta WhatsApp Business account and number for full API control.
                  </p>
                </div>
                <Button
                  className="mt-5 w-full justify-center"
                  onClick={handleMetaConnectClick}
                  disabled={metaConnectLoading}
                >
                  {metaConnectLoading ? "Connecting…" : "Use Own"}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm dark:border-amber-900/50 dark:bg-amber-950/40">
              <div className="flex gap-2">
                <svg className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-500" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                <div className="text-sm leading-6 text-amber-900 dark:text-amber-400">
                  <p className="font-semibold">Important</p>
                  <p className="mt-1">
                    If you are using the WhatsApp page in Qwickly, it uses WhatsApp web/JS and cannot use a Meta WhatsApp API number directly. In that case, use the Qwickly number or connect a separate WhatsApp number.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter variant="bordered">
            <Button variant="outline" onClick={() => setEnableNewContactsDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
          {metaConnectError ? (
            <div className="px-6 pb-6 sm:px-8">
              <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm">
                <p className="mb-2 font-semibold text-destructive">❌ Connection Error:</p>
                <p className="whitespace-pre-wrap break-words text-destructive">{metaConnectError}</p>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

