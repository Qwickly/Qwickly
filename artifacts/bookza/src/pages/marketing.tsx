import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
} from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { ensureBusiness } from "@/lib/settings";
import { uploadCampaignImage } from "@/lib/booking-page-upload";
import { fetchSubscription } from "@/lib/catalog-subscriptions";
import { buildApiUrl } from "@workspace/api-client-react";
import {
  ArrowLeft,
  ArrowRight,
  CheckSquare,
  Inbox,
  Loader2,
  Megaphone,
  Plus,
  Send,
  Star,
  Users,
  X,
} from "lucide-react";

/*
Here is the to be migrated Supabase table, the rest of the policies are still living in my Claude.md fikle

CREATE TABLE IF NOT EXISTS public.review_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel TEXT NOT NULL DEFAULT 'WhatsApp'
  CHECK (channel IN ('WhatsApp','Email','SMS')),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  booking_id UUID REFERENCES public.bookings(id) ON DELETE SET NULL,
  client_name TEXT NOT NULL DEFAULT '',
  client_phone TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  review_url TEXT,
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('draft','sent','failed','responded')),
  rating INTEGER CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  feedback TEXT,
  sent_at TIMESTAMPTZ,
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS review_requests_business_id_idx
  ON public.review_requests(business_id);

CREATE INDEX IF NOT EXISTS review_requests_client_id_idx
  ON public.review_requests(client_id);

ALTER TABLE public.review_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "review_requests_select_own" ON public.review_requests;
CREATE POLICY "review_requests_select_own" ON public.review_requests
  FOR SELECT USING (public.user_owns_business(business_id));

DROP POLICY IF EXISTS "review_requests_insert_own" ON public.review_requests;
CREATE POLICY "review_requests_insert_own" ON public.review_requests
  FOR INSERT WITH CHECK (public.user_owns_business(business_id));

DROP POLICY IF EXISTS "review_requests_update_own" ON public.review_requests;
CREATE POLICY "review_requests_update_own" ON public.review_requests
  FOR UPDATE USING (public.user_owns_business(business_id))
  WITH CHECK (public.user_owns_business(business_id));

DROP POLICY IF EXISTS "review_requests_delete_own" ON public.review_requests;
CREATE POLICY "review_requests_delete_own" ON public.review_requests
  FOR DELETE USING (public.user_owns_business(business_id));

DROP TRIGGER IF EXISTS review_requests_updated_at ON public.review_requests;
CREATE TRIGGER review_requests_updated_at
  BEFORE UPDATE ON public.review_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
*/

type CampaignChannel = "WhatsApp" | "Email" | "SMS";
type CampaignStatus = "draft" | "active" | "completed";

// Reviews feature is not live yet — the Reviews tab shows a "coming soon"
// placeholder below. Types/helpers kept commented out for when it ships.
// type ReviewStatus = "draft" | "sent" | "failed" | "responded";
//
// // descrbies a single review sent to a single person
// type ReviewRequest = {
//   id: string;
//   channel: CampaignChannel;
//   clientId: string | null;
//   bookingId: string | null;
//   clientName: string;
//   clientPhone: string;
//   message: string;
//   reviewUrl?: string;
//   status: ReviewStatus;
//   rating: number | null;
//   feedback: string | null;
//   sentAt: string | null;
//   respondedAt: string | null;
//   createdAt: string;
//   updatedAt: string;
// };

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

const META_FLOW_CONFIG = {
  appId: "1519664722812785", // Replace with your real Meta App ID from the developer console.
  embeddedSignupConfigId: "1574317814275454", // Replace with your real Embedded Signup configuration ID.
  backendApiEndpoint: "https://kzfixfcatknkkqttnvvi.supabase.co/functions/v1/meta-whatsapp-connect", // Replace with your backend endpoint for saving the access token.
  authScope: "business_management,whatsapp_business_management,whatsapp_business_messaging",
  apiVersion: "v16.0", // Keep this aligned with the Meta Graph API version you use.
};

let metaSdkLoadPromise: Promise<any> | null = null;
let metaSdkInitialized = false;

function ensureMetaSdkInit(FB: any) {
  if (metaSdkInitialized) return FB;

  FB.init({
    appId: META_FLOW_CONFIG.appId,
    version: META_FLOW_CONFIG.apiVersion,
    xfbml: false,
    autoLogAppEvents: false,
  });

  metaSdkInitialized = true;
  return FB;
}

function initializeMetaSdk(): Promise<any> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Meta SDK can only be initialized in the browser."));
  }

  if ((window as any).FB) {
    return Promise.resolve(ensureMetaSdkInit((window as any).FB));
  }

  if (metaSdkLoadPromise) {
    return metaSdkLoadPromise;
  }

  metaSdkLoadPromise = new Promise((resolve, reject) => {
    (window as any).fbAsyncInit = () => {
      if (!(window as any).FB) {
        reject(new Error("Meta SDK loaded but FB object is unavailable."));
        return;
      }

      resolve(ensureMetaSdkInit((window as any).FB));
    };

    const existingScript = document.querySelector(
      'script[src*="connect.facebook.net/en_US/sdk.js"]',
    );

    if (existingScript) {
      if ((window as any).FB) {
        resolve(ensureMetaSdkInit((window as any).FB));
        return;
      }

      existingScript.addEventListener("load", () => {
        if ((window as any).FB) {
          resolve(ensureMetaSdkInit((window as any).FB));
        } else {
          reject(new Error("Meta SDK loaded but FB object is unavailable."));
        }
      });
      existingScript.addEventListener("error", () =>
        reject(new Error("Failed to load the Meta SDK script.")),
      );
      return;
    }

    const script = document.createElement("script");
    script.src = "https://connect.facebook.net/en_US/sdk.js";
    script.async = true;
    script.defer = true;
    script.onerror = () => reject(new Error("Failed to load the Meta SDK script."));
    document.body.appendChild(script);
  });

  return metaSdkLoadPromise;
}

function extractWhatsappBusinessAccountId(metaResponse: any): string | null {
  const businesses = metaResponse?.businesses?.data;
  if (!Array.isArray(businesses)) {
    return null;
  }

  for (const business of businesses) {
    const accounts = business?.whatsapp_business_accounts?.data;
    if (Array.isArray(accounts) && accounts.length > 0) {
      return accounts[0]?.id ?? null;
    }
  }

  return null;
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

// Reviews feature is not live yet — see mapReviewRequestRow, commented out below.
// function mapReviewRequestRow(row: any): ReviewRequest {
//   return {
//     id: row.id,
//     channel: (row.channel ?? "WhatsApp") as CampaignChannel,
//     clientId: row.client_id ?? null,
//     bookingId: row.booking_id ?? null,
//     clientName: row.client_name ?? "",
//     clientPhone: row.client_phone ?? "",
//     message: row.message ?? "",
//     reviewUrl: row.review_url ?? undefined,
//     status: row.status as ReviewStatus,
//     rating: row.rating ?? null,
//     feedback: row.feedback ?? null,
//     sentAt: row.sent_at ?? null,
//     respondedAt: row.responded_at ?? null,
//     createdAt: row.created_at ?? new Date().toISOString(),
//     updatedAt: row.updated_at ?? new Date().toISOString(),
//   };
// }

export default function MarketingPage() {
  const { toast } = useToast();

  // Reviews feature is not live yet — state/handlers commented out below.
  // const [reviews, setReviews] = useState<ReviewRequest[]>([]); // storing an array of ReviewRequests
  // const [reviewDialogOpen, setReviewDialogOpen] = useState(false);

  // const [reviewForm, setReviewForm] = useState({
  //   clientId: "",
  //   clientName: "",
  //   clientPhone: "",
  //   channel: "WhatsApp" as CampaignChannel,
  //   message: "Thanks for choosing us: Please can you leave a quick review",
  //   reviewUrl: "",
  // });

  const [tab, setTab] = useState("campaigns");
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);

  const [campaignDialogOpen, setCampaignDialogOpen] = useState(false);

  const [campaignForm, setCampaignForm] = useState({
    name: "",
    type: "WhatsApp" as CampaignChannel,
    message: "",
    imageUrl: "",
  });
  const [campaignImageUploading, setCampaignImageUploading] = useState(false);
  const [campaignSending, setCampaignSending] = useState(false);
  const [campaignStep, setCampaignStep] = useState(1);
  const [campaignSendProgress, setCampaignSendProgress] =
    useState<CampaignSendProgress | null>(null);
  const [enableNewContactsDialogOpen, setEnableNewContactsDialogOpen] = useState(false);
  const [metaConnectLoading, setMetaConnectLoading] = useState(false);
  const [metaConnectError, setMetaConnectError] = useState<string | null>(null);
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
  const filteredClientIds = useMemo(
    () => filteredClients.map((client) => client.id),
    [filteredClients],
  );
  const visibleClientIds = useMemo(
    () => visibleClients.map((client) => client.id),
    [visibleClients],
  );
  const selectedFilteredClientCount = filteredClientIds.filter((id) =>
    selectedClientIds.includes(id),
  ).length;
  const selectedVisibleClientCount = visibleClientIds.filter((id) =>
    selectedClientIds.includes(id),
  ).length;
  const allVisibleClientsSelected =
    visibleClientIds.length > 0 &&
    selectedVisibleClientCount === visibleClientIds.length;
  const partiallySelectedVisibleClients =
    selectedVisibleClientCount > 0 && !allVisibleClientsSelected;
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

    // Reviews feature is not live yet, so these stay at 0 for now.
    const reviewRequests = 0;
    const reviewResponses = 0;

    return { totalSent, totalConversions, reviewRequests, reviewResponses };
  }, [campaigns]);

  const toggleClientSelection = (clientId: string) => {
    setSelectedClientIds((prev) =>
      prev.includes(clientId)
        ? prev.filter((id) => id !== clientId)
        : [...prev, clientId],
    );
  };

  const toggleVisibleClientSelection = () => {
    setSelectedClientIds((prev) => {
      if (allVisibleClientsSelected) {
        return prev.filter((id) => !visibleClientIds.includes(id));
      }

      return Array.from(new Set([...prev, ...visibleClientIds]));
    });
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
      const FB = await initializeMetaSdk();

      const authResponse = await new Promise<any>((resolve, reject) => {
        FB.login(
          (response: any) => {
            if (response?.status === "connected" && response.authResponse) {
              resolve(response.authResponse);
              return;
            }

            reject(new Error("Meta login was not completed or permission was denied."));
          },
          {
            scope: META_FLOW_CONFIG.authScope,
            return_scopes: true,
            auth_type: "rerequest",
          },
        );
      });

      const accessToken = authResponse?.accessToken;
      if (!accessToken) {
        throw new Error("Could not obtain an access token from Meta.");
      }

      const metaProfile = await new Promise<any>((resolve, reject) => {
        FB.api(
          "/me?fields=businesses{whatsapp_business_accounts{id,name,display_name}}",
          (response: any) => {
            if (!response || response.error) {
              reject(response?.error || new Error("Could not retrieve Meta business data."));
              return;
            }
            resolve(response);
          },
        );
      });

      const whatsappBusinessAccountId = extractWhatsappBusinessAccountId(metaProfile);
      if (!whatsappBusinessAccountId) {
        throw new Error("No WhatsApp Business Account was found in your Meta account.");
      }

      const session = await supabase.auth.getSession();
      const userAccessToken = session.data.session?.access_token;

      const backendResponse = await fetch(META_FLOW_CONFIG.backendApiEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(userAccessToken ? { Authorization: `Bearer ${userAccessToken}` } : {}),
        },
        body: JSON.stringify({
          accessToken,
          whatsappBusinessAccountId,
        }),
      });

      if (!backendResponse.ok) {
        throw new Error(
          `Backend save failed with status ${backendResponse.status}.`,
        );
      }

      toast({
        title: "Meta connection successful",
        description:
          "Your Facebook/WhatsApp Business Account is connected and ready for WhatsApp messaging.",
      });
      setEnableNewContactsDialogOpen(false);
    } catch (error) {
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

    async function loadCampaigns() {
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
    }

    // Reviews feature is not live yet — see loadReviews, commented out below.
    // async function loadReviews() {
    //   const businessId = await ensureBusiness();

    //   const { data, error } = await supabase
    //     .from("review_requests")
    //     .select("*")
    //     .eq("business_id", businessId)
    //     .order("created_at", { ascending: false });

    //   if (error) {
    //     console.error("Failed to load the review req", error.message);
    //     return;
    //   }

    //   if (!mounted || !data) return;

    //   setReviews(data.map(mapReviewRequestRow));
    // }

    void loadCampaigns();
    //void loadReviews(); I do not have access to Supa to create table - so commenting it out for now - table structure lives ontop
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

        // Use the new anti-fingerprinting endpoint to send the campaign
        const response = await fetch(buildApiUrl(`/api/whatsapp/campaigns/send`), {
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
            enableAntiFingerprinting: true,
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

  // Reviews feature is not live yet — see handleCreateReviewRequest, commented out below.
  // const handleCreateReviewRequest = async () => {
  //   if (!reviewForm.clientName.trim()) {
  //     toast({ title: "Client name is required", variant: "destructive" });
  //     return;
  //   }

  //   if (!reviewForm.clientPhone.trim()) {
  //     toast({ title: "Client phone is required", variant: "destructive" });
  //     return;
  //   }

  //   if (!reviewForm.message.trim()) {
  //     toast({ title: "Message is required", variant: "destructive" });
  //     return;
  //   }

  //   const finalMessage = reviewForm.reviewUrl.trim()
  //     ? `${reviewForm.message.trim()} ${reviewForm.reviewUrl.trim()}`
  //     : reviewForm.message.trim();

  //   let status: ReviewStatus = "sent";
  //   let sentAt: string | null = new Date().toISOString();

  //   try {
  //     const session = await supabase.auth.getSession();
  //     const accessToken = session.data.session?.access_token;

  //     const response = await fetch(`/api/whatsapp/contacts/messages`, {
  //       method: "POST",
  //       headers: {
  //         "Content-Type": "application/json",
  //         ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  //       },
  //       body: JSON.stringify({
  //         phone: reviewForm.clientPhone.trim(),
  //         message: finalMessage,
  //       }),
  //     });

  //     const payload = await response.json().catch(() => null);

  //     if (!response.ok) {
  //       throw new Error(payload?.error || "Unable to send review request.");
  //     }
  //   } catch (error) {
  //     status = "failed";
  //     sentAt = null;

  //     toast({
  //       title: "WhatsApp send failed",
  //       description:
  //         error instanceof Error
  //           ? error.message
  //           : "This review request will be saved as failed.",
  //       variant: "destructive",
  //     });
  //   }

  //   try {
  //     const localReview: ReviewRequest = {
  //       id: makeId(),
  //       channel: reviewForm.channel,
  //       clientId: reviewForm.clientId || null,
  //       bookingId: null,
  //       clientName: reviewForm.clientName.trim(),
  //       clientPhone: reviewForm.clientPhone.trim(),
  //       message: finalMessage,
  //       reviewUrl: reviewForm.reviewUrl.trim() || undefined,
  //       status,
  //       rating: null,
  //       feedback: null,
  //       sentAt,
  //       respondedAt: null,
  //       createdAt: new Date().toISOString(),
  //       updatedAt: new Date().toISOString(),
  //     };

  //     setReviews((prev) => [localReview, ...prev]);

  //     setReviewDialogOpen(false);
  //     setReviewForm({
  //       clientId: "",
  //       clientName: "",
  //       clientPhone: "",
  //       channel: "WhatsApp",
  //       message: "Thanks for choosing us. Please leave us a quick review:",
  //       reviewUrl: "",
  //     });

  //     toast({
  //       title:
  //         status === "sent" ? "Review request sent" : "Review request saved",
  //       description:
  //         status === "sent"
  //           ? "The client has been sent a WhatsApp review request."
  //           : "The request was saved with a failed status.",
  //     });
  //   } catch (error) {
  //     toast({
  //       title: "Could not create review request",
  //       description: getErrorMessage(error, "Please try again."),
  //       variant: "destructive",
  //     });
  //   }
  // };

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
    <div className="space-y-10 pb-12">
      <section className="grid gap-6 lg:grid-cols-[1.6fr_0.9fr]">
        <div className="relative overflow-hidden rounded-[2rem] border border-border/70 bg-slate-950/95 p-8 shadow-2xl text-white">
          <div className="absolute left-0 top-0 h-56 w-56 rounded-full bg-sky-500/10 blur-3xl" />
          <div className="absolute right-0 bottom-0 h-72 w-72 rounded-full bg-emerald-500/10 blur-3xl" />
          <div className="relative space-y-8">
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-600/70 bg-slate-900/80 px-3 py-1 text-xs uppercase tracking-[0.3em] text-sky-200">
              Marketing hub
            </div>
            <div className="space-y-5">
              <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
                Reach customers with campaigns that drive bookings.
              </h1>
              <p className="max-w-2xl text-base leading-8 text-slate-300">
                Design WhatsApp-first messages, track campaign activity, and grow with clear marketing insights built for service businesses.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button
                onClick={() => setCampaignDialogOpen(true)}
                className="bg-sky-500 text-white shadow-lg shadow-sky-500/20 hover:bg-sky-600"
              >
                Create campaign
              </Button>
              <Button variant="outline" className="border-slate-700 text-white hover:bg-slate-900">
                Learn more
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                { label: "Messages sent", value: metrics.totalSent.toString() },
                { label: "Conversions", value: metrics.totalConversions.toString() },
                { label: "Live campaigns", value: campaigns.filter((c) => c.status === "active").length.toString() },
              ].map((item) => (
                <div key={item.label} className="rounded-3xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-400">{item.label}</p>
                  <p className="mt-3 text-3xl font-semibold text-white">{item.value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <aside className="space-y-4">
          <Card className="rounded-[2rem] border border-border/70 bg-white/95 shadow-sm">
            <CardContent className="p-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Latest insight</p>
                  <h2 className="mt-2 text-2xl font-semibold text-foreground">Campaign focus</h2>
                </div>
                <Badge className="rounded-full bg-sky-100 text-sky-700 border border-sky-200">
                  Live
                </Badge>
              </div>
              <div className="mt-6 space-y-4">
                <div className="rounded-3xl bg-slate-50 p-4">
                  <p className="text-sm text-muted-foreground">Top tip</p>
                  <p className="mt-2 text-lg font-semibold text-foreground">Use short messages and clear next steps.</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-3xl bg-slate-50 p-4">
                    <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Daily quota</p>
                    <p className="mt-2 text-xl font-semibold text-foreground">{metrics.totalSent} used</p>
                  </div>
                  <div className="rounded-3xl bg-slate-50 p-4">
                    <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Reviews</p>
                    <p className="mt-2 text-xl font-semibold text-foreground">Coming soon</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-[2rem] border border-border/70 bg-white/95 shadow-sm">
            <CardContent className="p-6">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Action</p>
              <h3 className="mt-3 text-xl font-semibold text-foreground">Launch your next campaign</h3>
              <p className="mt-3 text-sm text-muted-foreground">
                A quick, personal message can help you convert interest into bookings. Start with a discount or appointment reminder.
              </p>
              <Button
                className="mt-6 w-full bg-primary hover:bg-primary/90"
                onClick={() => setCampaignDialogOpen(true)}
              >
                Start a campaign
              </Button>
            </CardContent>
          </Card>

          <Card className="rounded-[2rem] border border-emerald-200/50 bg-gradient-to-br from-emerald-50 to-emerald-100/50 shadow-sm">
            <CardContent className="p-6">
              <p className="text-xs uppercase tracking-[0.24em] text-emerald-700">New Feature</p>
              <h3 className="mt-3 text-xl font-semibold text-emerald-900">Enable New Contact Sending</h3>
              <p className="mt-3 text-sm text-emerald-800">
                Connect your Facebook Business Account to WhatsApp Cloud API for official, unlimited outbound messaging to new contacts.
              </p>
              <Button
                className="mt-6 w-full bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={() => setEnableNewContactsDialogOpen(true)}
              >
                Connect
              </Button>
            </CardContent>
          </Card>
        </aside>
      </section>

      <section className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Campaigns</p>
            <h2 className="text-3xl font-semibold text-foreground">Marketing workspace</h2>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Badge className="rounded-full bg-slate-100 text-slate-800 border border-slate-200">
              {campaigns.length} campaigns
            </Badge>
            <Button onClick={() => setCampaignDialogOpen(true)} className="bg-primary hover:bg-primary/90">
              New campaign
            </Button>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.8fr_1fr]">
          <div className="space-y-4">
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="inline-flex rounded-full bg-slate-100 p-1 border border-border/70 shadow-sm">
                <TabsTrigger value="campaigns" className="rounded-full px-4 py-2 text-sm font-semibold">
                  <Megaphone className="mr-2 inline-block h-4 w-4" /> Campaigns
                </TabsTrigger>
                <TabsTrigger value="reviews" className="rounded-full px-4 py-2 text-sm font-semibold">
                  <Star className="mr-2 inline-block h-4 w-4" /> Reviews
                </TabsTrigger>
              </TabsList>

              <TabsContent value="campaigns" className="mt-4 space-y-4">
                {campaigns.length === 0 ? (
                  <EmptyStateCard
                    icon={Megaphone}
                    title="No campaigns yet"
                    description="Create your first campaign to start reaching clients."
                  />
                ) : (
                  <div className="space-y-4">
                    {campaigns.map((c) => (
                      <Card key={c.id} className="rounded-[1.5rem] border border-border/70 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                        <CardContent className="p-5">
                          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <h3 className="text-lg font-semibold truncate">{c.name}</h3>
                                <Badge variant="outline" className="text-xs">
                                  {c.type}
                                </Badge>
                              </div>
                              <p className="mt-2 text-sm text-muted-foreground truncate">{c.message || "No message preview available."}</p>
                            </div>
                            <div className="space-y-2 text-right">
                              <Badge
                                className={
                                  c.status === "active"
                                    ? "bg-emerald-100 text-emerald-700 border border-emerald-200"
                                    : c.status === "completed"
                                      ? "bg-blue-100 text-blue-700 border border-blue-200"
                                      : "bg-muted text-muted-foreground"
                                }
                              >
                                {c.status}
                              </Badge>
                              <p className="text-xs text-muted-foreground">{new Date(c.createdAt).toLocaleDateString()}</p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="reviews" className="mt-4 space-y-4">
                <Card className="rounded-[1.5rem] border border-border/70 bg-white shadow-sm">
                  <CardContent className="p-6">
                    <div className="flex items-start gap-4">
                      <div className="rounded-3xl bg-slate-100 p-3 text-slate-700">
                        <Star className="h-5 w-5" />
                      </div>
                      <div>
                        <h3 className="text-lg font-semibold">Reviews are coming soon</h3>
                        <p className="mt-2 text-sm text-muted-foreground">
                          We’re building review campaigns to help you collect customer feedback by WhatsApp and email.
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>

          <aside className="space-y-4">
            <Card className="rounded-[2rem] border border-border/70 bg-white/95 shadow-sm">
              <CardContent className="p-6">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Message quota</p>
                <h3 className="mt-3 text-xl font-semibold text-foreground">Daily capacity</h3>
                <p className="mt-3 text-sm text-muted-foreground">
                  Your plan includes a daily marketing message limit. Bookza tracks usage and stops sends if you hit the cap.
                </p>
                <div className="mt-6 space-y-3 rounded-3xl bg-slate-50 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-muted-foreground">Messages used</span>
                    <span className="font-semibold text-foreground">{metrics.totalSent}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min((metrics.totalSent / Math.max(metrics.totalSent || 1, 50)) * 100, 100)}%` }} />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-[2rem] border border-border/70 bg-white/95 shadow-sm">
              <CardContent className="p-6">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Actions</p>
                <h3 className="mt-3 text-xl font-semibold text-foreground">Ready to launch?</h3>
                <p className="mt-3 text-sm text-muted-foreground">
                  A fresh campaign can turn recent interest into bookings. Keep your message short and relevant.
                </p>
                <Button className="mt-6 w-full bg-primary hover:bg-primary/90" onClick={() => setCampaignDialogOpen(true)}>
                  Start a campaign
                </Button>
              </CardContent>
            </Card>
          </aside>
        </div>
      </section>

      <Dialog
        open={campaignDialogOpen}
        onOpenChange={(open) => {
          if (campaignSending) return;
          setCampaignDialogOpen(open);
          if (!open) setCampaignStep(1);
        }}
      >
        <DialogContent className="max-w-[95vw] w-full md:max-w-[1000px] max-h-[90vh] rounded-[2rem] overflow-hidden bg-white shadow-2xl p-0 flex flex-col">
          {/* Header */}
          <div className="border-b border-border/70 bg-slate-950 px-4 py-4 sm:px-6 sticky top-0 z-20 shadow-sm flex flex-col gap-4">
            <div className="flex items-center justify-between">
              {/* Left: Cancel / Back */}
              <div className="flex items-center gap-2">
                {campaignStep > 1 ? (
                  <Button variant="ghost" onClick={() => setCampaignStep(s => s - 1)} className="text-slate-300 hover:text-white hover:bg-slate-800">
                    <ArrowLeft className="w-4 h-4 mr-2" /> <span className="hidden sm:inline">Back</span>
                  </Button>
                ) : (
                  <Button variant="ghost" onClick={() => setCampaignDialogOpen(false)} className="text-slate-300 hover:text-white hover:bg-slate-800">
                    Cancel
                  </Button>
                )}
              </div>
              
              {/* Center: Title & Stepper */}
              <div className="hidden sm:flex flex-col items-center">
                <DialogTitle className="text-lg font-semibold text-white">Create campaign</DialogTitle>
                <DialogDescription className="sr-only">Step {campaignStep} of 4</DialogDescription>
                <div className="flex items-center gap-1.5 mt-1">
                  {[1, 2, 3, 4].map(num => (
                    <div key={num} className={`h-1.5 rounded-full transition-all ${campaignStep === num ? "w-6 bg-primary" : campaignStep > num ? "w-1.5 bg-primary/50" : "w-1.5 bg-slate-700"}`} />
                  ))}
                </div>
              </div>

              {/* Right: Continue / Send */}
              <div>
                {campaignStep < 4 ? (
                  <Button className="bg-primary hover:bg-primary/90 rounded-full px-4 sm:px-6" onClick={() => setCampaignStep(s => s + 1)}>
                    Next <ArrowRight className="w-4 h-4 ml-1 sm:ml-2" />
                  </Button>
                ) : (
                  <Button className="bg-emerald-500 hover:bg-emerald-600 text-white rounded-full px-4 sm:px-6 shadow-[0_0_15px_rgba(16,185,129,0.3)]" onClick={handleCreateCampaign} disabled={campaignSending || (campaignForm.type === "WhatsApp" && !sendToAllClients && selectedClientIds.length === 0)}>
                    {campaignSending ? <Loader2 className="w-4 h-4 mr-1 sm:mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-1 sm:mr-2" />}
                    Send
                  </Button>
                )}
              </div>
            </div>
            
            {/* Mobile Center (shown only on mobile) */}
            <div className="sm:hidden flex flex-col items-center">
                <DialogTitle className="text-lg font-semibold text-white">Create campaign</DialogTitle>
                <div className="flex items-center gap-1.5 mt-2">
                  {[1, 2, 3, 4].map(num => (
                    <div key={num} className={`h-1.5 rounded-full transition-all ${campaignStep === num ? "w-6 bg-primary" : campaignStep > num ? "w-1.5 bg-primary/50" : "w-1.5 bg-slate-700"}`} />
                  ))}
                </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-6 sm:px-8 bg-slate-50/50">
            <div className="mx-auto max-w-5xl">
              <div className={campaignStep === 3 ? "block" : "grid gap-8 lg:grid-cols-[1.5fr_1fr]"}>
                
                {/* Left Column: Form Content */}
                <div className="space-y-6 min-w-0">
                  
                  {/* STEP 1: BASICS */}
                  {campaignStep === 1 && (
                    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                      <section className="rounded-[1.5rem] border border-border/70 bg-white p-6 sm:p-8 shadow-sm">
                        <h3 className="text-xl font-semibold text-foreground mb-6">Campaign Setup</h3>
                        
                        <div className="space-y-6">
                          <div className="space-y-3">
                            <Label className="text-sm font-medium">Campaign Name *</Label>
                            <Input
                              placeholder="e.g. Summer Promo 2026"
                              className="h-12 rounded-2xl bg-slate-50"
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
                                    className={`rounded-2xl border p-4 text-left transition-all duration-300 ${
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
                        </div>
                      </section>
                    </div>
                  )}

                  {/* STEP 2: CONTENT */}
                  {campaignStep === 2 && (
                    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                      <section className="rounded-[1.5rem] border border-border/70 bg-white p-6 sm:p-8 shadow-sm">
                        <h3 className="text-xl font-semibold text-foreground mb-6">Message Content</h3>
                        
                        <div className="space-y-6">
                          <div className="space-y-3">
                            <Label className="text-sm font-medium">Message text</Label>
                            <Textarea
                              rows={6}
                              placeholder="Write a compelling message for your customers..."
                              className="resize-none rounded-2xl bg-slate-50 p-4"
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
                                className="h-12 rounded-2xl px-6"
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
                                  className="h-12 rounded-2xl px-6 text-destructive hover:bg-destructive/10"
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
                      <section className="rounded-[1.5rem] border border-border/70 bg-white p-6 sm:p-8 shadow-sm">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-8">
                          <div>
                            <h3 className="text-xl font-semibold text-foreground">Select Audience</h3>
                            <p className="text-sm text-muted-foreground mt-1">Choose who will receive this campaign.</p>
                          </div>
                          <div className="flex items-center gap-4 bg-slate-50 px-4 py-2 rounded-2xl border border-border/50">
                            <div className="text-center">
                              <p className="text-xl font-bold text-primary">{sendToAllClients ? allClients.length : selectedClientIds.length}</p>
                              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Selected</p>
                            </div>
                          </div>
                        </div>

                        <div className="mt-6 space-y-4">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                            <Input
                              placeholder="Search clients by name, phone, or email"
                              value={clientSearch}
                              onChange={(e) => setClientSearch(e.target.value)}
                              disabled={sendToAllClients || loadingClients}
                              className="sm:flex-1"
                            />
                            <div className="flex flex-wrap gap-2">
                              <Button
                                type="button"
                                variant={sendToAllClients ? "default" : "outline"}
                                className="rounded-full"
                                onClick={() => setSendToAllClients((value) => !value)}
                                disabled={loadingClients || allClients.length === 0}
                              >
                                <Users className="w-4 h-4 mr-2" />
                                All clients
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                className="rounded-full"
                                onClick={clearSelectedClients}
                                disabled={
                                  loadingClients ||
                                  (!sendToAllClients && selectedClientIds.length === 0)
                                }
                              >
                                <X className="w-4 h-4 mr-2" />
                                Clear
                              </Button>
                            </div>
                          </div>

                          {refreshingClients && !loadingClients ? (
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              Refreshing client list
                            </div>
                          ) : null}

                          {loadingClients ? (
                            <div className="rounded-3xl border border-border/50 bg-card p-5 text-center text-sm text-muted-foreground">
                              Loading clients…
                            </div>
                          ) : allClients.length === 0 ? (
                            <div className="rounded-3xl border border-dashed border-border/50 bg-card p-5 text-center text-sm text-muted-foreground">
                              No clients found. Add clients before sending a campaign.
                            </div>
                          ) : filteredClients.length === 0 ? (
                            <div className="rounded-3xl border border-dashed border-border/50 bg-card p-5 text-center text-sm text-muted-foreground">
                              No clients match your search.
                            </div>
                          ) : sendToAllClients ? (
                            <div className="rounded-3xl border border-border/50 bg-card p-5 text-center text-sm text-muted-foreground">
                              All {allClients.length} clients will receive this campaign.
                            </div>
                          ) : (
                            <div className="space-y-4">
                              <div className="rounded-3xl border border-border/50 bg-background p-4">
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                  <div className="flex items-center gap-2">
                                    <Checkbox
                                      id="campaign-select-visible-clients"
                                      checked={
                                        partiallySelectedVisibleClients
                                          ? "indeterminate"
                                          : allVisibleClientsSelected
                                      }
                                      onCheckedChange={toggleVisibleClientSelection}
                                    />
                                    <Label
                                      htmlFor="campaign-select-visible-clients"
                                      className="cursor-pointer"
                                    >
                                      Select visible clients
                                    </Label>
                                  </div>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="rounded-full"
                                    onClick={selectAllFilteredClients}
                                    disabled={
                                      filteredClients.length === 0 ||
                                      selectedFilteredClientCount === filteredClients.length
                                    }
                                  >
                                    <CheckSquare className="w-4 h-4 mr-2" />
                                    Select all matching
                                  </Button>
                                </div>
                                <p className="mt-2 text-xs text-muted-foreground">
                                  {selectedVisibleClientCount} of {visibleClients.length} visible selected. {selectedFilteredClientCount} matching clients selected total.
                                </p>
                              </div>

                              <div className="grid grid-cols-1 gap-3 max-h-[360px] overflow-y-auto pr-1">
                              {visibleClients.map((client) => {
                                const checked = selectedClientIds.includes(client.id);
                                return (
                                  <button
                                    type="button"
                                    key={client.id}
                                    onClick={() => toggleClientSelection(client.id)}
                                    className={`w-full rounded-3xl border p-4 text-left transition-all duration-300 group ${
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
                                  className="w-full rounded-full"
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
                      <section className="rounded-[1.5rem] border border-border/70 bg-white p-6 sm:p-8 shadow-sm text-center">
                        <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-6">
                          <CheckSquare className="w-8 h-8" />
                        </div>
                        <h3 className="text-2xl font-bold text-foreground mb-2">Ready to send!</h3>
                        <p className="text-muted-foreground max-w-sm mx-auto mb-8">
                          Please review the live preview on the right before launching your campaign.
                        </p>
                        
                        <div className="grid grid-cols-2 gap-4 max-w-md mx-auto text-left">
                          <div className="p-4 rounded-2xl bg-slate-50 border border-border/50">
                            <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-1">Campaign</p>
                            <p className="font-medium truncate">{campaignForm.name}</p>
                          </div>
                          <div className="p-4 rounded-2xl bg-slate-50 border border-border/50">
                            <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-1">Recipients</p>
                            <p className="font-medium">{sendToAllClients ? allClients.length : selectedClientIds.length} clients</p>
                          </div>
                        </div>
                      </section>

                      {/* Mobile Only: Sending Progress */}
                      {campaignSendProgress && (
                        <div className="sm:hidden rounded-[1.5rem] border border-border/70 bg-white p-6 shadow-sm mt-6">
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
                  <Card className="rounded-[1.5rem] border border-border/70 bg-white shadow-sm">
                    <CardContent className="p-6">
                      <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Campaign preview</p>
                      <h3 className="mt-2 text-2xl font-semibold text-foreground">Live preview</h3>
                      <div className="mt-5 space-y-4 rounded-[1.5rem] border border-border/70 bg-slate-50 p-4">
                        <div className="flex items-center gap-3">
                          <div className="h-11 w-11 rounded-2xl bg-slate-900" />
                          <div>
                            <p className="text-sm font-semibold text-foreground">{campaignForm.name || "Untitled campaign"}</p>
                            <p className="text-xs text-muted-foreground">{campaignForm.type} message</p>
                          </div>
                        </div>
                        <div className="rounded-3xl bg-white p-4 text-sm leading-6 text-foreground shadow-sm">
                          {campaignForm.message || "Your campaign message preview appears here."}
                        </div>
                        {campaignForm.imageUrl ? (
                          <img
                            src={campaignForm.imageUrl}
                            alt="Campaign preview"
                            className="mt-2 h-44 w-full rounded-[1.25rem] object-cover border border-border/70"
                          />
                        ) : (
                          <div className="mt-2 h-44 rounded-[1.25rem] border border-dashed border-border/70 bg-slate-50 flex items-center justify-center text-sm text-muted-foreground">
                            Image preview will appear here.
                          </div>
                        )}
                      </div>

                      <div className="mt-6 grid gap-3">
                        <div className="rounded-3xl border border-border/70 bg-slate-50 p-4">
                          <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Recipients</p>
                          <p className="mt-2 text-lg font-semibold text-foreground">
                            {sendToAllClients ? allClients.length : selectedClientIds.length}
                          </p>
                        </div>
                        <div className="rounded-3xl border border-border/70 bg-slate-50 p-4">
                          <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Preview notes</p>
                          <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
                            <li className="flex items-start gap-2">
                              <span className="mt-1 h-2.5 w-2.5 rounded-full bg-primary" />
                              Short, action-oriented copy works best.
                            </li>
                            <li className="flex items-start gap-2">
                              <span className="mt-1 h-2.5 w-2.5 rounded-full bg-primary" />
                              Add a clear booking or reply step.
                            </li>
                          </ul>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {campaignSendProgress ? (
                    <Card className="rounded-[1.5rem] border border-border/70 bg-white shadow-sm">
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
        </DialogContent>
      </Dialog>

      <Dialog open={enableNewContactsDialogOpen} onOpenChange={setEnableNewContactsDialogOpen}>
        <DialogContent className="max-w-2xl rounded-[2rem]">
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
            <div className="px-6 pb-6 text-sm text-destructive">
              {metaConnectError}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EmptyStateCard({
  icon: Icon,
  title,
  description,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <Card className="shadow-sm border-border/50">
      <CardContent className="p-8">
        <EmptyStatePanel icon={Icon} title={title} description={description} />
      </CardContent>
    </Card>
  );
}

function EmptyStatePanel({
  icon: Icon,
  title,
  description,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-6 px-4">
      <div className="p-3 rounded-full bg-muted mb-4">
        <Icon className="w-5 h-5 text-muted-foreground" />
      </div>
      <h3 className="font-semibold">{title}</h3>
      <p className="text-sm text-muted-foreground max-w-md mt-2">
        {description}
      </p>
    </div>
  );
}
