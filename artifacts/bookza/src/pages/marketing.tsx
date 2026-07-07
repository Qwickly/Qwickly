import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MetricCard } from "@/components/dashboard/metric-card";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { ensureBusiness } from "@/lib/settings";
import { uploadCampaignImage } from "@/lib/booking-page-upload";
import { fetchSubscription } from "@/lib/catalog-subscriptions";
import { buildApiUrl } from "@workspace/api-client-react";
import { sendWhatsappMessage, sendWhatsappMessageMeta } from "@/lib/whatsapp-notify";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Gauge,
  Loader2,
  Megaphone,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Search,
  Send,
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

export default function MarketingPage() {
  const { toast } = useToast();

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(true);
  const [campaignSearch, setCampaignSearch] = useState("");
  const [campaignStatusFilter, setCampaignStatusFilter] = useState<"all" | CampaignStatus>("all");
  const [campaignPage, setCampaignPage] = useState(1);
  const [dailyUsage, setDailyUsage] = useState({ used: 0, limit: 50 });

  const [campaignDialogOpen, setCampaignDialogOpen] = useState(false);

  const [campaignForm, setCampaignForm] = useState({
    name: "",
    type: "WhatsApp" as CampaignChannel,
    message: "",
    imageUrl: "",
  });
  const [campaignImageUploading, setCampaignImageUploading] = useState(false);
  const [fastMode, setFastMode] = useState(false);
  const [campaignSending, setCampaignSending] = useState(false);
  const [campaignStep, setCampaignStep] = useState(1);
  const [campaignSendProgress, setCampaignSendProgress] =
    useState<CampaignSendProgress | null>(null);
  const [enableNewContactsDialogOpen, setEnableNewContactsDialogOpen] = useState(false);
  const [metaConnectLoading, setMetaConnectLoading] = useState(false);
  const [metaConnectError, setMetaConnectError] = useState<string | null>(null);
  const [metaWhatsappConnected, setMetaWhatsappConnected] = useState(false);
  const [testPhone, setTestPhone] = useState("");
  const [testMessage, setTestMessage] = useState(
    "Hello from Bookza! This is a quick WhatsApp test message.",
  );
  const [testMessageSending, setTestMessageSending] = useState(false);
  const [selectedClientIds, setSelectedClientIds] = useState<string[]>([]);
  const [sendToAllClients, setSendToAllClients] = useState(false);
  const [clientSearch, setClientSearch] = useState("");
  const [visibleClientCount, setVisibleClientCount] = useState(
    CLIENT_LIST_PAGE_SIZE,
  );

  const {
    data: allClients = [],
    isLoading: loadingClients,
    isFetching: refreshingClients,
  } = useQuery({
    queryKey: ["marketing-clients", "all"],
    queryFn: fetchAllMarketingClients,
    enabled: campaignDialogOpen,
    staleTime: 60_000,
  });

  const filteredClients = useMemo(
    () =>
      allClients.filter((client) =>
        `${client.name} ${client.email ?? ""} ${client.phone}`
          .toLowerCase()
          .includes(clientSearch.trim().toLowerCase()),
      ),
    [allClients, clientSearch],
  );
  const visibleClients = useMemo(
    () => filteredClients.slice(0, visibleClientCount),
    [filteredClients, visibleClientCount],
  );
  const selectedClients = allClients.filter((client) =>
    selectedClientIds.includes(client.id),
  );
  const campaignRecipients = sendToAllClients ? allClients : selectedClients;

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
      toast({
        title: "Test message sent",
        description: "Your WhatsApp Cloud API test message was sent successfully.",
      });
      setTestPhone("");
      setTestMessage("Hello from Bookza! This is a quick WhatsApp test message.");
    },
    onError: (error) => {
      toast({
        title: "Could not send test message",
        description: getErrorMessage(error, "Please try again."),
        variant: "destructive",
      });
    },
  });
  const filteredClientIds = useMemo(
    () => filteredClients.map((client) => client.id),
    [filteredClients],
  );
  const selectedFilteredClientCount = filteredClientIds.filter((id) =>
    selectedClientIds.includes(id),
  ).length;
  const hasMoreVisibleClients = visibleClientCount < filteredClients.length;

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

  const metrics = useMemo(() => {
    const totalSent = campaigns.reduce((a, c) => a + c.sent, 0);
    const totalConversions = campaigns.reduce((a, c) => a + c.conversions, 0);

    return { totalSent, totalConversions };
  }, [campaigns]);

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

  const dailyQuotaPercent = Math.min(
    Math.round((dailyUsage.used / Math.max(dailyUsage.limit, 1)) * 100),
    100,
  );

  const canSendCampaign =
    !campaignSending &&
    campaignForm.name.trim().length > 0 &&
    (campaignForm.type !== "WhatsApp" || sendToAllClients || selectedClientIds.length > 0);

  const getCampaignStatusClass = (status: CampaignStatus) => {
    switch (status) {
      case "active":
        return "border-emerald-200 bg-emerald-50 text-emerald-700";
      case "completed":
        return "border-blue-200 bg-blue-50 text-blue-700";
      default:
        return "border-slate-200 bg-slate-100 text-slate-600";
    }
  };

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

  const toggleClientSelection = (clientId: string) => {
    setSelectedClientIds((prev) =>
      prev.includes(clientId)
        ? prev.filter((id) => id !== clientId)
        : [...prev, clientId],
    );
  };

  const selectAllFilteredClients = () => {
    setSelectedClientIds((prev) =>
      Array.from(new Set([...prev, ...filteredClientIds])),
    );
  };

  const clearSelectedClients = () => {
    setSelectedClientIds([]);
    setSendToAllClients(false);
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

      toast({
        title: "Meta connection successful",
        description:
          "Your Facebook/WhatsApp Business Account is connected and ready for WhatsApp messaging.",
      });
      setEnableNewContactsDialogOpen(false);
    } catch (error) {
      console.error("❌ Connection flow failed:", error);
      const message = getErrorMessage(error, "Unable to connect Meta account.");
      setMetaConnectError(message);
      toast({
        title: "Connect failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setMetaConnectLoading(false);
    }
  };

  useEffect(() => {
    setVisibleClientCount(CLIENT_LIST_PAGE_SIZE);
  }, [clientSearch, campaignDialogOpen]);

  useEffect(() => {
    let mounted = true;

    async function checkMetaConnection() {
      try {
        const businessId = await ensureBusiness();
        const { data } = await supabase
          .from("meta_whatsapp_connections")
          .select("id")
          .eq("business_id", businessId)
          .single();

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

  const handleCreateCampaign = async () => {
    if (campaignSending) return;

    if (!campaignForm.name.trim()) {
      toast({ title: "Campaign name is required", variant: "destructive" });
      return;
    }

    const isWhatsapp = campaignForm.type === "WhatsApp";
    if (isWhatsapp && campaignRecipients.length === 0) {
      toast({
        title: "Select at least one client",
        description: "Choose clients to send this WhatsApp campaign to.",
        variant: "destructive",
      });
      return;
    }

    const recipientIds = sendToAllClients
      ? allClients.map((client) => client.id)
      : selectedClientIds;
    const recipientCount = campaignRecipients.length;

    // Check daily marketing message limit for all campaigns
    const businessId = await ensureBusiness();
    const today = new Date().toISOString().split('T')[0];

    // Get today's usage
    const { data: todayUsage } = await supabase
      .from("usage_tracking")
      .select("*")
      .eq("business_id", businessId)
      .eq("tracking_date", today)
      .single();

    const messagesSentToday = todayUsage?.marketing_messages_sent || 0;

    // Get subscription to find daily limit using the same function as billing page
    const subscription = await fetchSubscription();

    let dailyLimit = 50; // Default limit
    if (subscription?.plans?.metadata) {
      const metadata = subscription.plans.metadata as any;
      dailyLimit = metadata.marketingMessages ?? metadata.marketingMessagesPerDay ?? 50;
    }

    const remainingMessages = dailyLimit - messagesSentToday;

    if (remainingMessages <= 0) {
      toast({
        title: "Daily limit reached",
        description: `You've sent ${messagesSentToday} marketing messages today. Your daily limit is ${dailyLimit}. Try again tomorrow.`,
        variant: "destructive",
      });
      return;
    }

    if (recipientCount > remainingMessages) {
      toast({
        title: "Not enough messages remaining",
        description: `You have ${remainingMessages} messages remaining today (limit: ${dailyLimit}). Select ${remainingMessages} or fewer clients.`,
        variant: "destructive",
      });
      return;
    }

    const next: Campaign = {
      id: makeId(),
      name: campaignForm.name.trim(),
      type: campaignForm.type,
      status: isWhatsapp ? "completed" : "draft",
      sent: isWhatsapp ? recipientCount : 0,
      opened: 0,
      conversions: 0,
      createdAt: new Date().toISOString(),
      message: campaignForm.message.trim(),
      imageUrl: campaignForm.imageUrl.trim() || undefined,
      recipientCount,
    };

    let insertedCampaign: Campaign | null = null;

    if (isWhatsapp) {
      setCampaignSending(true);
      setCampaignSendProgress({
        total: recipientCount,
        sent: 0,
        failed: 0,
        processed: 0,
        currentClientName: null,
      });

      try {
        const session = await supabase.auth.getSession();
        const accessToken = session.data.session?.access_token;
        const content = campaignForm.message.trim();
        const imageUrl = campaignForm.imageUrl.trim() || undefined;

        // First, save the campaign to get its ID
        const businessId = await ensureBusiness();
        const { data: insertedCampaign, error: insertError } = await supabase
          .from("marketing_campaigns")
          .insert([
            {
              business_id: businessId,
              name: next.name,
              channel: next.type,
              status: "active",
              message: next.message,
              image_url: next.imageUrl,
              recipient_ids: recipientIds,
              recipient_count: recipientCount,
              sent: 0,
              opened: next.opened,
              conversions: next.conversions,
            },
          ])
          .select("*")
          .single();

        if (insertError || !insertedCampaign) {
          throw new Error(insertError?.message || "Failed to create campaign");
        }

        const response = await fetch(buildApiUrl("/api/whatsapp/campaigns/send"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(accessToken
              ? { Authorization: `Bearer ${accessToken}` }
              : {}),
          },
          body: JSON.stringify({
            campaignId: insertedCampaign.id,
            recipientIds,
            message: content,
            imageUrl,
            enableAntiFingerprinting: !fastMode,
            fastMode,
          }),
        });

        const payload = await response.json().catch(() => null);
        
        if (!response.ok) {
          throw new Error(payload?.error || "Failed to send campaign");
        }

        // Track usage in usage_tracking table
        try {
          const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format

          // Check if usage_tracking record exists for today
          const { data: existingUsage } = await supabase
            .from("usage_tracking")
            .select("*")
            .eq("business_id", businessId)
            .eq("tracking_date", today)
            .single();

          if (existingUsage) {
            // Update existing record
            await supabase
              .from("usage_tracking")
              .update({
                marketing_messages_sent: existingUsage.marketing_messages_sent + recipientCount,
                whatsapp_campaigns_sent: existingUsage.whatsapp_campaigns_sent + 1,
                whatsapp_messages_sent: existingUsage.whatsapp_messages_sent + recipientCount,
              })
              .eq("id", existingUsage.id);
          } else {
            // Create new record for today
            await supabase
              .from("usage_tracking")
              .insert({
                business_id: businessId,
                subscription_id: null,
                tracking_date: today,
                marketing_messages_sent: recipientCount,
                whatsapp_campaigns_sent: 1,
                whatsapp_messages_sent: recipientCount,
              });
          }
        } catch (usageError) {
          console.error("Failed to track usage:", usageError);
          // Don't fail the campaign if usage tracking fails
        }

        // Campaign is now running in background
        toast({
          title: "Campaign started",
          description: `Sending to ${payload.totalRecipients} recipients in background with anti-fingerprinting protection.`,
        });
      } catch (error) {
        toast({
          title: "Could not send campaign",
          description:
            error instanceof Error
              ? error.message
              : "Please check the WhatsApp connection.",
          variant: "destructive",
        });
        return;
      } finally {
        setCampaignSending(false);
      }
    }

    // For non-WhatsApp campaigns (Email, SMS), save to database
    if (!isWhatsapp) {
      try {
        const businessId = await ensureBusiness();
        const { data, error } = await supabase
          .from("marketing_campaigns")
          .insert([
            {
              business_id: businessId,
              name: next.name,
              channel: next.type,
              status: next.status,
              message: next.message,
              image_url: next.imageUrl,
              recipient_ids: recipientIds,
              recipient_count: recipientCount,
              sent: next.sent,
              opened: next.opened,
              conversions: next.conversions,
            },
          ])
          .select("*")
          .single();

        if (error) {
          throw error;
        }

        if (data) {
          insertedCampaign = {
            ...data,
            recipientCount: data.recipient_count ?? recipientCount,
            imageUrl:
              data.image_url ?? (campaignForm.imageUrl.trim() || undefined),
          } as Campaign;
        }
      } catch (error) {
        const message = getErrorMessage(error, "Please try again.");
        console.error("Failed to save campaign", { error, message });
        toast({
          title: "Could not save campaign",
          description: message,
          variant: "destructive",
        });
        return;
      }
    }

    setCampaigns((prev) => [insertedCampaign ?? next, ...prev]);
    if (isWhatsapp) {
      setDailyUsage((usage) => ({
        ...usage,
        used: Math.min(usage.used + recipientCount, usage.limit),
      }));
    }
    setCampaignDialogOpen(false);
    setCampaignForm({ name: "", type: "WhatsApp", message: "", imageUrl: "" });
    setSelectedClientIds([]);
    setSendToAllClients(false);
    setCampaignStep(1);

    toast({
      title: isWhatsapp ? "Campaign sent" : "Campaign created",
      description: isWhatsapp
        ? `${next.sent} WhatsApp messages were sent to ${campaignRecipients.length} clients.`
        : `${next.name} has been saved as a draft.`,
    });
    setCampaignSendProgress(null);
  };

  const handleCampaignImageUpload = async (file: File | null) => {
    if (!file) return;

    setCampaignImageUploading(true);
    try {
      const url = await uploadCampaignImage(file);
      setCampaignForm((form) => ({ ...form, imageUrl: url }));
      toast({
        title: "Image uploaded",
        description: "Campaign image is ready.",
      });
    } catch (error) {
      const message = getErrorMessage(error, "Please try again.");
      toast({
        title: "Image upload failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setCampaignImageUploading(false);
    }
  };

  const clearCampaignImage = () => {
    setCampaignForm((form) => ({ ...form, imageUrl: "" }));
  };

  const campaignImageInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-6 pb-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Campaigns</h1>
          <p className="text-sm text-muted-foreground">
            Send WhatsApp campaigns, track engagement, and bring clients back.
          </p>
        </div>
        <Button
          className="w-full shrink-0 bg-primary hover:bg-primary/90 shadow-sm sm:w-auto"
          onClick={() => setCampaignDialogOpen(true)}
        >
          <Plus className="mr-2 h-4 w-4" />
          Create campaign
        </Button>
      </div>

      <section className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <MetricCard
          title="Messages sent"
          numericValue={metrics.totalSent}
          formatValue={(value) => value.toLocaleString()}
          icon={MessageSquare}
          detail="All campaigns"
          loading={loadingCampaigns}
        />
        <MetricCard
          title="Total campaigns"
          numericValue={campaigns.length}
          formatValue={(value) => value.toLocaleString()}
          icon={Megaphone}
          detail={`${campaigns.filter((campaign) => campaign.status === "active").length} active`}
          loading={loadingCampaigns}
        />
        <MetricCard
          title="Conversions"
          numericValue={metrics.totalConversions}
          formatValue={(value) => value.toLocaleString()}
          icon={BarChart3}
          detail="Tracked bookings"
          loading={loadingCampaigns}
        />
        <MetricCard
          title="Daily quota"
          textValue={`${dailyUsage.used}/${dailyUsage.limit}`}
          numericValue={dailyUsage.used}
          formatValue={(value) => value.toLocaleString()}
          icon={Gauge}
          detail={`${dailyQuotaPercent}% used today`}
          loading={loadingCampaigns}
        />
      </section>

      <Card className="overflow-hidden border-[#0866ff]/20 bg-gradient-to-br from-[#f7fbff] via-white to-[#eef6ff] shadow-sm">
        <CardContent className="flex flex-col gap-5 p-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[#0866ff] text-white shadow-sm shadow-[#0866ff]/20">
              <MessageSquare className="h-5 w-5" />
            </div>
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold tracking-tight text-slate-950">Meta WhatsApp API</h2>
                <Badge
                  variant="outline"
                  className={cn(
                    "rounded-full px-2.5 py-1 text-xs font-semibold",
                    metaWhatsappConnected
                      ? "border-[#0866ff]/20 bg-[#0866ff]/10 text-[#0866ff]"
                      : "border-slate-200 bg-white/80 text-slate-600",
                  )}
                >
                  {metaWhatsappConnected ? "Connected" : "Setup needed"}
                </Badge>
              </div>
              <p className="max-w-2xl text-sm leading-6 text-slate-600">
                Manage the Meta Cloud API connection used for compliant WhatsApp sends to new contacts.
              </p>
            </div>
          </div>
          <Button
            className="w-full bg-[#0866ff] text-white shadow-sm shadow-[#0866ff]/20 hover:bg-[#075bd8] sm:w-auto"
            onClick={() => setEnableNewContactsDialogOpen(true)}
          >
            Manage connection
          </Button>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search campaigns..."
            className="w-full pl-9"
            value={campaignSearch}
            onChange={(event) => handleCampaignSearchChange(event.target.value)}
          />
        </div>
        <Select value={campaignStatusFilter} onValueChange={handleCampaignStatusChange}>
          <SelectTrigger className="w-full sm:w-[160px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card className="hidden border-border/50 shadow-sm md:block">
        <div className="overflow-x-auto px-2 pb-2">
          <Table className="border-separate border-spacing-y-2">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Campaign</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Recipients</TableHead>
                <TableHead className="text-right">Sent</TableHead>
                <TableHead className="text-right">Conversions</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadingCampaigns ? (
                Array.from({ length: 6 }).map((_, index) => (
                  <TableRow
                    key={index}
                    className="bg-card [&_td]:border-y [&_td]:border-border/50 [&_td]:py-5 [&_td:first-child]:rounded-l-xl [&_td:first-child]:border-l [&_td:last-child]:rounded-r-xl [&_td:last-child]:border-r"
                  >
                    <TableCell>
                      <div className="space-y-2">
                        <Skeleton className="h-4 w-40" />
                        <Skeleton className="h-3 w-64" />
                      </div>
                    </TableCell>
                    <TableCell><Skeleton className="h-6 w-20 rounded-full" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-20 rounded-full" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="ml-auto h-4 w-10" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="ml-auto h-4 w-10" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="ml-auto h-4 w-10" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-8 w-8 rounded-full" /></TableCell>
                  </TableRow>
                ))
              ) : filteredCampaigns.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-64 text-center text-muted-foreground">
                    {campaigns.length === 0
                      ? "No campaigns yet. Create your first campaign to start reaching clients."
                      : "No campaigns match your filters."}
                  </TableCell>
                </TableRow>
              ) : (
                paginatedCampaigns.map((campaign) => (
                  <TableRow
                    key={campaign.id}
                    className="bg-card transition-colors hover:bg-muted/50 [&_td]:border-y [&_td]:border-border/50 [&_td]:py-5 [&_td:first-child]:rounded-l-xl [&_td:first-child]:border-l [&_td:last-child]:rounded-r-xl [&_td:last-child]:border-r"
                  >
                    <TableCell className="min-w-[280px]">
                      <div className="min-w-0">
                        <p className="font-medium text-foreground">{campaign.name}</p>
                        <p className="mt-1 max-w-[380px] truncate text-xs text-muted-foreground">
                          {campaign.message || "No message preview available."}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="rounded-full border-primary/20 bg-primary/10 text-primary">
                        {campaign.type}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn("rounded-full capitalize", getCampaignStatusClass(campaign.status))}
                      >
                        {campaign.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-medium">{campaign.recipientCount}</TableCell>
                    <TableCell className="text-right font-medium">{campaign.sent}</TableCell>
                    <TableCell className="text-right font-medium">{campaign.conversions}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatCampaignDate(campaign.createdAt)}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                            <span className="sr-only">Campaign actions</span>
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem disabled>View details</DropdownMenuItem>
                          <DropdownMenuItem disabled>Duplicate</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        {filteredCampaigns.length > 0 && !loadingCampaigns && (
          <div className="flex items-center justify-between border-t px-4 py-3">
            <p className="text-sm text-muted-foreground">
              Showing {Math.min((campaignPage - 1) * CAMPAIGN_PAGE_SIZE + 1, filteredCampaigns.length)}-
              {Math.min(campaignPage * CAMPAIGN_PAGE_SIZE, filteredCampaigns.length)} of {filteredCampaigns.length} campaigns
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCampaignPage((page) => page - 1)}
                disabled={campaignPage === 1}
              >
                <ChevronLeft className="h-4 w-4" />
                Previous
              </Button>
              <div className="flex items-center gap-1">
                {Array.from({ length: Math.min(campaignTotalPages, 5) }, (_, i) => {
                  let pageNum;
                  if (campaignTotalPages <= 5) {
                    pageNum = i + 1;
                  } else if (campaignPage <= 3) {
                    pageNum = i + 1;
                  } else if (campaignPage >= campaignTotalPages - 2) {
                    pageNum = campaignTotalPages - 4 + i;
                  } else {
                    pageNum = campaignPage - 2 + i;
                  }

                  return (
                    <Button
                      key={pageNum}
                      variant={campaignPage === pageNum ? "default" : "outline"}
                      size="sm"
                      className="h-8 w-8"
                      onClick={() => setCampaignPage(pageNum)}
                    >
                      {pageNum}
                    </Button>
                  );
                })}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCampaignPage((page) => page + 1)}
                disabled={campaignPage === campaignTotalPages}
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </Card>

      <div className="flex flex-col gap-4 md:hidden">
        {loadingCampaigns ? (
          Array.from({ length: 4 }).map((_, index) => (
            <Card key={index} className="border-border/60 bg-card shadow-sm">
              <div className="space-y-4 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-2">
                    <Skeleton className="h-5 w-36" />
                    <Skeleton className="h-4 w-56" />
                  </div>
                  <Skeleton className="h-6 w-20 rounded-full" />
                </div>
                <div className="grid grid-cols-2 gap-3 rounded-lg border border-border/50 bg-muted/30 p-3">
                  <Skeleton className="h-10 rounded-md" />
                  <Skeleton className="h-10 rounded-md" />
                  <Skeleton className="h-10 rounded-md" />
                  <Skeleton className="h-10 rounded-md" />
                </div>
                <Skeleton className="h-4 w-28" />
              </div>
            </Card>
          ))
        ) : filteredCampaigns.length === 0 ? (
          <div className="rounded-xl border border-border/50 bg-card py-12 text-center text-muted-foreground">
            {campaigns.length === 0 ? "No campaigns yet." : "No campaigns found."}
          </div>
        ) : (
          paginatedCampaigns.map((campaign) => (
            <Card key={campaign.id} className="relative overflow-hidden border-border/60 bg-card shadow-sm">
              <div className="space-y-4 p-4 pr-14">
                <div className="absolute right-3 top-3">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full text-muted-foreground hover:bg-emerald-50 hover:text-primary">
                        <MoreHorizontal className="h-4 w-4" />
                        <span className="sr-only">Campaign actions</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem disabled>View details</DropdownMenuItem>
                      <DropdownMenuItem disabled>Duplicate</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate text-lg font-semibold leading-tight">{campaign.name}</h3>
                    <p className="mt-1 truncate text-sm text-muted-foreground">
                      {campaign.message || "No message preview available."}
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className={cn("shrink-0 rounded-full capitalize", getCampaignStatusClass(campaign.status))}
                  >
                    {campaign.status}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-3 rounded-lg border border-border/50 bg-muted/30 p-3 text-sm">
                  <div className="space-y-1">
                    <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Channel</p>
                    <p className="font-medium">{campaign.type}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Recipients</p>
                    <p className="font-medium">{campaign.recipientCount}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Sent</p>
                    <p className="font-medium">{campaign.sent}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Created</p>
                    <p className="font-medium">{formatCampaignDate(campaign.createdAt)}</p>
                  </div>
                </div>

                <div className="font-semibold text-primary">
                  {campaign.conversions} conversions
                </div>
              </div>
            </Card>
          ))
        )}

        {filteredCampaigns.length > 0 && !loadingCampaigns && (
          <div className="flex flex-col items-center gap-3 pb-4 pt-2">
            <p className="text-xs text-muted-foreground">
              Showing {Math.min((campaignPage - 1) * CAMPAIGN_PAGE_SIZE + 1, filteredCampaigns.length)}-
              {Math.min(campaignPage * CAMPAIGN_PAGE_SIZE, filteredCampaigns.length)} of {filteredCampaigns.length}
            </p>
            <div className="flex w-full items-center justify-between gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={() => setCampaignPage((page) => page - 1)}
                disabled={campaignPage === 1}
              >
                <ChevronLeft className="mr-1 h-4 w-4" />
                Prev
              </Button>
              <div className="px-4 text-sm font-medium">
                {campaignPage} / {campaignTotalPages}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={() => setCampaignPage((page) => page + 1)}
                disabled={campaignPage === campaignTotalPages}
              >
                Next
                <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      <Dialog
        open={campaignDialogOpen}
        onOpenChange={(open) => {
          if (campaignSending) return;
          setCampaignDialogOpen(open);
          if (!open) setCampaignStep(1);
        }}
      >
        <DialogContent className="flex max-h-[90vh] w-[95vw] max-w-[1000px] flex-col overflow-hidden rounded-2xl bg-white p-0 shadow-xl">
          <DialogHeader className="border-b border-border/70 bg-white px-5 py-4 pr-14 text-left sm:px-6 sm:pr-16">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-max">
                <DialogTitle className="whitespace-nowrap text-base sm:text-lg">Create campaign</DialogTitle>
                <DialogDescription className="mt-1">Step {campaignStep} of 4</DialogDescription>
              </div>
              <div className="flex shrink-0 items-center justify-end gap-1.5">
                {[1, 2, 3, 4].map((num) => (
                  <div
                    key={num}
                    className={cn(
                      "h-1.5 rounded-full transition-all",
                      campaignStep === num
                        ? "w-8 bg-primary"
                        : campaignStep > num
                          ? "w-4 bg-primary/45"
                          : "w-4 bg-muted",
                    )}
                  />
                ))}
              </div>
            </div>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto bg-white px-5 py-5 sm:px-6">
            <div className="mx-auto max-w-5xl">
              <div className={campaignStep === 3 ? "block" : "grid gap-8 lg:grid-cols-[1.5fr_1fr]"}>
                
                {/* Left Column: Form Content */}
                <div className="space-y-6 min-w-0">
                  
                  {/* STEP 1: BASICS */}
                  {campaignStep === 1 && (
                    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                      <section className="space-y-6">
                        <h3 className="mb-6 text-lg font-semibold text-foreground">Campaign setup</h3>
                        
                        <div className="space-y-6">
                          <div className="space-y-3">
                            <Label className="text-sm font-medium">Campaign Name *</Label>
                            <Input
                              placeholder="e.g. Summer Promo 2026"
                              className="h-11"
                              value={campaignForm.name}
                              onChange={(e) => setCampaignForm((f) => ({ ...f, name: e.target.value }))}
                            />
                          </div>

                          <div className="space-y-3">
                            <Label className="text-sm font-medium">Delivery Channel</Label>
                            <div className="grid gap-3 sm:grid-cols-3">
                              {(
                                [
                                  { id: "WhatsApp", label: "WhatsApp", subtitle: "Rich messages", active: true },
                                  { id: "Email", label: "Email", subtitle: "Coming soon", active: false },
                                  { id: "SMS", label: "SMS", subtitle: "Coming soon", active: false },
                                ] as const
                              ).map((option) => {
                                const isSelected = campaignForm.type === option.id;
                                return (
                                  <button
                                    type="button"
                                    key={option.id}
                                    disabled={!option.active}
                                    onClick={() => option.active && setCampaignForm((f) => ({ ...f, type: option.id }))}
                                    className={`rounded-lg border p-4 text-left transition-all duration-200 ${
                                      option.active
                                        ? isSelected
                                          ? "border-primary bg-primary/5 shadow-md ring-1 ring-primary/20 scale-[1.02]"
                                          : "border-border/70 bg-slate-50 hover:border-primary/80 hover:shadow-sm"
                                        : "cursor-not-allowed border-border/30 bg-slate-100 text-slate-400"
                                    }`}
                                  >
                                    <p className="font-semibold">{option.label}</p>
                                    <p className="text-xs mt-1 opacity-70">{option.subtitle}</p>
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          <section className="border-t border-border/70 pt-5">
                            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(220px,0.85fr)]">
                              <div className="space-y-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <h4 className="text-sm font-semibold text-foreground">Send routing</h4>
                                  <Badge variant="secondary" className="rounded-full text-xs">
                                    Automatic
                                  </Badge>
                                </div>
                                <p className="max-w-xl text-sm leading-6 text-muted-foreground">
                                  Active clients use your connected WhatsApp session. New contacts are routed through Meta Cloud API automatically.
                                </p>
                              </div>

                              <label
                                htmlFor="fast-send"
                                className="flex cursor-pointer items-start gap-3 rounded-lg border border-amber-200 bg-amber-50/70 p-3"
                              >
                                <Checkbox
                                  id="fast-send"
                                  checked={fastMode}
                                  onCheckedChange={(value) => setFastMode(Boolean(value))}
                                  className="mt-0.5"
                                />
                                <span className="min-w-0">
                                  <span className="block text-sm font-semibold text-amber-950">
                                    Fast send debug mode
                                  </span>
                                  <span className="mt-1 block text-xs leading-5 text-amber-800">
                                    Skips verification and delays. This can increase delivery failures or policy risk.
                                  </span>
                                </span>
                              </label>
                            </div>
                          </section>
                        </div>
                      </section>
                    </div>
                  )}

                  {/* STEP 2: CONTENT */}
                  {campaignStep === 2 && (
                    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                      <section className="space-y-6">
                        <h3 className="mb-6 text-lg font-semibold text-foreground">Message content</h3>
                        
                        <div className="space-y-6">
                          <div className="space-y-3">
                            <Label className="text-sm font-medium">Message text</Label>
                            <Textarea
                              rows={6}
                              placeholder="Write a compelling message for your customers..."
                              className="resize-none"
                              value={campaignForm.message}
                              onChange={(e) => setCampaignForm((f) => ({ ...f, message: e.target.value }))}
                            />
                            <p className="text-xs text-muted-foreground text-right">
                              {campaignForm.message.length} characters
                            </p>
                          </div>

                          <div className="space-y-3 pt-4 border-t border-border/50">
                            <Label className="text-sm font-medium">Attach Image (Optional)</Label>
                            <div className="flex flex-col sm:flex-row gap-4 items-start">
                              <Button
                                type="button"
                                variant="outline"
                                className="h-10 px-4"
                                onClick={() => campaignImageInputRef.current?.click()}
                                disabled={campaignImageUploading}
                              >
                                {campaignImageUploading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                                {campaignImageUploading ? "Uploading..." : "Browse files"}
                              </Button>
                              {campaignForm.imageUrl && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  className="h-10 px-4 text-destructive hover:bg-destructive/10"
                                  onClick={clearCampaignImage}
                                >
                                  Remove image
                                </Button>
                              )}
                            </div>
                            
                            <input
                              ref={campaignImageInputRef}
                              type="file"
                              accept="image/jpeg,image/png,image/webp,image/gif"
                              className="hidden"
                              onChange={(e) => {
                                const file = e.target.files?.[0] ?? null;
                                void handleCampaignImageUpload(file);
                                if (e.target) e.target.value = "";
                              }}
                            />
                          </div>
                        </div>
                      </section>
                    </div>
                  )}

                  {/* STEP 3: AUDIENCE */}
                  {campaignStep === 3 && (
                    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                      <section className="space-y-6">
                        <div className="mb-8 flex flex-row items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className="text-lg font-semibold text-foreground">Select audience</h3>
                            <p className="text-sm text-muted-foreground mt-1">Choose who will receive this campaign.</p>
                          </div>
                          <div className="shrink-0 whitespace-nowrap rounded-full border border-border/50 bg-muted/50 px-3 py-1.5 text-sm font-semibold text-primary">
                            {sendToAllClients ? allClients.length : selectedClientIds.length} selected
                          </div>
                        </div>

                        <div className="mt-6 space-y-4">
                          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                            <Button
                              type="button"
                              variant={sendToAllClients ? "default" : "outline"}
                              className="min-w-0 w-full rounded-lg px-2 text-xs sm:w-auto sm:px-4 sm:text-sm"
                              onClick={() => setSendToAllClients((value) => !value)}
                              disabled={loadingClients || allClients.length === 0}
                            >
                              <Users className="mr-1.5 h-4 w-4 shrink-0 sm:mr-2" />
                              <span className="truncate sm:hidden">Everyone</span>
                              <span className="hidden sm:inline">
                                {sendToAllClients ? "Sending to everyone" : "Send to everyone"}
                              </span>
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              className="min-w-0 w-full rounded-lg px-2 text-xs sm:w-auto sm:px-4 sm:text-sm"
                              onClick={clearSelectedClients}
                              disabled={
                                loadingClients ||
                                (!sendToAllClients && selectedClientIds.length === 0)
                              }
                            >
                              <X className="mr-1.5 h-4 w-4 shrink-0 sm:mr-2" />
                              Clear
                            </Button>
                          </div>

                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                            <Input
                              placeholder="Search clients by name, phone, or email"
                              value={clientSearch}
                              onChange={(e) => setClientSearch(e.target.value)}
                              disabled={sendToAllClients || loadingClients}
                              className="sm:flex-1"
                            />
                            {clientSearch.trim() && !sendToAllClients ? (
                              <Button
                                type="button"
                                variant="outline"
                                className="rounded-lg"
                                onClick={selectAllFilteredClients}
                                disabled={
                                  loadingClients ||
                                  filteredClients.length === 0 ||
                                  selectedFilteredClientCount === filteredClients.length
                                }
                              >
                                <CheckSquare className="w-4 h-4 mr-2" />
                                Select all search clients
                              </Button>
                            ) : null}
                          </div>

                          {refreshingClients && !loadingClients ? (
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              Refreshing client list
                            </div>
                          ) : null}

                          {loadingClients ? (
                            <div className="space-y-2 rounded-lg border border-border/50 bg-card p-3">
                              {Array.from({ length: 5 }).map((_, index) => (
                                <div key={index} className="flex items-center gap-3 rounded-md p-2">
                                  <Skeleton className="h-4 w-4 rounded" />
                                  <Skeleton className="h-9 w-9 rounded-full" />
                                  <div className="min-w-0 flex-1 space-y-2">
                                    <Skeleton className="h-4 w-36" />
                                    <Skeleton className="h-3 w-48 max-w-full" />
                                  </div>
                                  <Skeleton className="h-5 w-16 rounded-full" />
                                </div>
                              ))}
                            </div>
                          ) : allClients.length === 0 ? (
                            <div className="rounded-lg border border-dashed border-border/50 bg-card p-5 text-center text-sm text-muted-foreground">
                              No clients found. Add clients before sending a campaign.
                            </div>
                          ) : filteredClients.length === 0 ? (
                            <div className="rounded-lg border border-dashed border-border/50 bg-card p-5 text-center text-sm text-muted-foreground">
                              No clients match your search.
                            </div>
                          ) : sendToAllClients ? (
                            <div className="rounded-lg border border-border/50 bg-card p-5 text-center text-sm text-muted-foreground">
                              All {allClients.length} clients will receive this campaign.
                            </div>
                          ) : (
                            <div className="space-y-4">
                              <p className="text-xs text-muted-foreground">
                                {selectedClientIds.length} clients selected.
                                {clientSearch.trim()
                                  ? ` ${selectedFilteredClientCount} of ${filteredClients.length} search clients selected.`
                                  : " Search to bulk-select matching clients."}
                              </p>

                              <div className="grid grid-cols-1 gap-3 max-h-[360px] overflow-y-auto pr-1">
                              {visibleClients.map((client) => {
                                const checked = selectedClientIds.includes(client.id);
                                return (
                                  <button
                                    type="button"
                                    key={client.id}
                                    onClick={() => toggleClientSelection(client.id)}
                                    className={`w-full rounded-lg border p-4 text-left transition-all duration-200 group ${
                                      checked
                                        ? "border-primary bg-primary/5 shadow-md ring-1 ring-primary/20"
                                        : "border-border/60 bg-card hover:border-primary/70 hover:shadow-sm hover:-translate-y-0.5"
                                    }`}
                                  >
                                    <div className="flex items-start justify-between gap-4">
                                      <div className="min-w-0">
                                        <p className="font-semibold text-sm truncate">
                                          {client.name}
                                        </p>
                                        <p className="text-xs text-muted-foreground truncate">
                                          {client.phone}
                                          {client.email ? ` · ${client.email}` : ""}
                                        </p>
                                      </div>
                                      <div
                                        className={
                                          checked
                                            ? "text-primary text-sm font-semibold"
                                            : "text-muted-foreground text-sm"
                                        }
                                      >
                                        {checked ? "Selected" : "Select"}
                                      </div>
                                    </div>
                                  </button>
                                );
                              })}
                              </div>

                              {hasMoreVisibleClients ? (
                                <Button
                                  type="button"
                                  variant="outline"
                                  className="w-full rounded-lg"
                                  onClick={() =>
                                    setVisibleClientCount((count) =>
                                      Math.min(
                                        count + CLIENT_LIST_PAGE_SIZE,
                                        filteredClients.length,
                                      ),
                                    )
                                  }
                                >
                                  Load {Math.min(CLIENT_LIST_PAGE_SIZE, filteredClients.length - visibleClientCount)} more clients
                                </Button>
                              ) : null}
                            </div>
                          )}
                        </div>
                      </section>
                    </div>
                  )}

                  {/* STEP 4: REVIEW */}
                  {campaignStep === 4 && (
                    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                      <section className="text-center">
                        <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-6">
                          <CheckSquare className="w-8 h-8" />
                        </div>
                        <h3 className="mb-2 text-xl font-semibold text-foreground">Ready to send</h3>
                        <p className="text-muted-foreground max-w-sm mx-auto mb-8">
                          Please review the live preview on the right before launching your campaign.
                        </p>
                        
                        <dl className="mx-auto grid max-w-md grid-cols-2 gap-6 border-t border-border/70 pt-5 text-left">
                          <div>
                            <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Campaign</dt>
                            <dd className="mt-1 truncate font-medium">{campaignForm.name}</dd>
                          </div>
                          <div>
                            <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recipients</dt>
                            <dd className="mt-1 font-medium">{sendToAllClients ? allClients.length : selectedClientIds.length} clients</dd>
                          </div>
                        </dl>
                      </section>

                      {/* Mobile Only: Sending Progress */}
                      {campaignSendProgress && (
                        <div className="mt-6 rounded-lg border border-border/70 bg-white p-6 shadow-sm sm:hidden">
                          <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground text-center">Sending progress</p>
                          <div className="mt-4 space-y-3">
                            <div className="flex items-center justify-between gap-2 text-sm">
                              <span>{campaignSendProgress.processed} / {campaignSendProgress.total}</span>
                              <span className="font-semibold text-foreground">{campaignSendProgress.sent} sent</span>
                            </div>
                            <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                              <div
                                className="h-full rounded-full bg-primary transition-all"
                                style={{ width: `${Math.round((campaignSendProgress.processed / Math.max(campaignSendProgress.total, 1)) * 100)}%` }}
                              />
                            </div>
                            <p className="text-xs text-muted-foreground text-center">
                              {campaignSendProgress.currentClientName ? `Sending to ${campaignSendProgress.currentClientName}` : "Sending in progress..."}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                </div>

                {/* Right Column: Live Preview (Hidden on Step 3) */}
                {campaignStep !== 3 && (
                  <aside className="lg:sticky lg:top-0 lg:self-start hidden sm:block animate-in fade-in duration-700">
                    <Card className="rounded-lg border border-border/70 bg-white shadow-sm">
                      <CardContent className="p-5">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              Campaign preview
                            </p>
                            <h3 className="mt-1 text-lg font-semibold text-foreground">Live preview</h3>
                          </div>
                          <Badge variant="outline" className="rounded-full border-primary/20 bg-primary/10 text-primary">
                            {campaignForm.type}
                          </Badge>
                        </div>

                        <div className="mt-5 space-y-4">
                          <div className="rounded-lg border border-border/70 bg-muted/40 p-4">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                              Campaign
                            </p>
                            <p className="mt-1 truncate text-sm font-semibold text-foreground">
                              {campaignForm.name || "Untitled campaign"}
                            </p>
                          </div>

                          <div className="rounded-lg border border-border/70 bg-white p-4">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                              Message
                            </p>
                            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground">
                              {campaignForm.message || "Your campaign message preview appears here."}
                            </p>
                          </div>

                          {campaignForm.imageUrl ? (
                            <img
                              src={campaignForm.imageUrl}
                              alt="Campaign preview"
                              className="h-44 w-full rounded-lg border border-border/70 object-cover"
                            />
                          ) : (
                            <div className="flex h-32 items-center justify-center rounded-lg border border-dashed border-border/70 bg-muted/40 text-sm text-muted-foreground">
                              Image preview will appear here.
                            </div>
                          )}

                          <div className="grid grid-cols-2 gap-3">
                            <div className="rounded-lg border border-border/70 bg-muted/40 p-4">
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                Recipients
                              </p>
                              <p className="mt-1 text-lg font-semibold text-foreground">
                                {sendToAllClients ? allClients.length : selectedClientIds.length}
                              </p>
                            </div>
                            <div className="rounded-lg border border-border/70 bg-muted/40 p-4">
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                Status
                              </p>
                              <p className="mt-1 text-sm font-semibold text-foreground">
                                Draft
                              </p>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                  {campaignSendProgress ? (
                    <Card className="rounded-lg border border-border/70 bg-white shadow-sm">
                      <CardContent className="p-6">
                        <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Sending progress</p>
                        <div className="mt-4 space-y-3">
                          <div className="flex items-center justify-between gap-2 text-sm">
                            <span>{campaignSendProgress.processed} / {campaignSendProgress.total}</span>
                            <span className="font-semibold text-foreground">{campaignSendProgress.sent} sent</span>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                            <div
                              className="h-full rounded-full bg-primary transition-all"
                              style={{ width: `${Math.round((campaignSendProgress.processed / Math.max(campaignSendProgress.total, 1)) * 100)}%` }}
                            />
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {campaignSendProgress.currentClientName ? `Sending to ${campaignSendProgress.currentClientName}` : "Sending in progress..."}
                          </p>
                        </div>
                      </CardContent>
                    </Card>
                  ) : null}
                  </aside>
                )}
              </div>
            </div>
          </div>
          <DialogFooter className="flex-col gap-2 border-t border-border/70 bg-white px-5 py-4 sm:flex-row sm:px-6">
            <Button
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => setCampaignDialogOpen(false)}
              disabled={campaignSending}
            >
              Cancel
            </Button>
            {campaignStep > 1 ? (
              <Button
                variant="outline"
                className="w-full sm:w-auto"
                onClick={() => setCampaignStep((step) => step - 1)}
                disabled={campaignSending}
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back
              </Button>
            ) : null}
            {campaignStep < 4 ? (
              <Button
                className="w-full bg-primary hover:bg-primary/90 sm:w-auto"
                onClick={() => setCampaignStep((step) => step + 1)}
              >
                Next
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            ) : (
              <Button
                className="w-full bg-primary hover:bg-primary/90 sm:w-auto"
                onClick={handleCreateCampaign}
                disabled={!canSendCampaign}
              >
                {campaignSending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Send className="mr-2 h-4 w-4" />
                )}
                Send campaign
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={enableNewContactsDialogOpen} onOpenChange={setEnableNewContactsDialogOpen}>
        <DialogContent className="max-w-2xl rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-2xl">Enable New Contact Sending</DialogTitle>
            <DialogDescription>
              Connect your Facebook Business Account to send messages to new contacts
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6">
              <div className="flex gap-3">
                <div className="rounded-full bg-emerald-200 p-2 h-fit">
                  <svg className="w-5 h-5 text-emerald-700" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                </div>
                <div>
                  <h3 className="font-semibold text-emerald-900">Official WhatsApp Cloud API</h3>
                  <p className="text-sm text-emerald-800 mt-1">
                    This solution uses Meta's official WhatsApp Business Platform for compliant, reliable messaging to any number.
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="font-semibold text-foreground">How to Connect</h3>
              
              <div className="space-y-3">
                <div className="rounded-xl border border-border p-4 space-y-2">
                  <div className="flex items-start gap-3">
                    <div className="flex items-center justify-center w-6 h-6 rounded-full bg-sky-100 text-sky-600 font-semibold text-sm flex-shrink-0 mt-0.5">1</div>
                    <div>
                      <h4 className="font-semibold text-sm">Go to Meta Business Platform</h4>
                      <p className="text-sm text-muted-foreground mt-1">
                        Visit <a href="https://business.facebook.com" target="_blank" rel="noopener noreferrer" className="text-sky-600 hover:underline">business.facebook.com</a> and sign in
                      </p>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-border p-4 space-y-2">
                  <div className="flex items-start gap-3">
                    <div className="flex items-center justify-center w-6 h-6 rounded-full bg-sky-100 text-sky-600 font-semibold text-sm flex-shrink-0 mt-0.5">2</div>
                    <div>
                      <h4 className="font-semibold text-sm">Create WhatsApp Business Account</h4>
                      <p className="text-sm text-muted-foreground mt-1">
                        Go to <span className="font-mono text-xs bg-slate-100 px-2 py-1 rounded">All Tools → WhatsApp Manager</span> and create a new account
                      </p>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-border p-4 space-y-2">
                  <div className="flex items-start gap-3">
                    <div className="flex items-center justify-center w-6 h-6 rounded-full bg-sky-100 text-sky-600 font-semibold text-sm flex-shrink-0 mt-0.5">3</div>
                    <div>
                      <h4 className="font-semibold text-sm">Get Your Credentials</h4>
                      <p className="text-sm text-muted-foreground mt-1">
                        From Meta Developers App, collect:
                      </p>
                      <ul className="text-sm text-muted-foreground mt-2 space-y-1 ml-0">
                        <li>• <span className="font-mono bg-slate-100 px-1">Phone Number ID</span></li>
                        <li>• <span className="font-mono bg-slate-100 px-1">Business Account ID</span></li>
                        <li>• <span className="font-mono bg-slate-100 px-1">Access Token</span></li>
                      </ul>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-border p-4 space-y-2">
                  <div className="flex items-start gap-3">
                    <div className="flex items-center justify-center w-6 h-6 rounded-full bg-sky-100 text-sky-600 font-semibold text-sm flex-shrink-0 mt-0.5">4</div>
                    <div>
                      <h4 className="font-semibold text-sm">Submit for Approval</h4>
                      <p className="text-sm text-muted-foreground mt-1">
                        Meta will verify your business (1-3 days). Once approved, you can send unlimited messages.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <div className="flex gap-2">
                <svg className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                <div className="text-sm">
                  <p className="font-semibold text-amber-900">Timeline</p>
                  <p className="text-amber-800 mt-1">Setup takes 15-30 minutes. Meta approval typically 1-3 days.</p>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEnableNewContactsDialogOpen(false)}>
              Close
            </Button>
            <Button
              className="bg-sky-600 hover:bg-sky-700 text-white"
              onClick={handleMetaConnectClick}
              disabled={metaConnectLoading}
            >
              {metaConnectLoading ? "Connecting…" : "Connect"}
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </DialogFooter>
          {metaConnectError ? (
            <div className="px-6 pb-6">
              <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm">
                <p className="font-semibold text-red-900 mb-2">❌ Connection Error:</p>
                <p className="text-red-800 whitespace-pre-wrap break-words">{metaConnectError}</p>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

