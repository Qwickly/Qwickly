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
import {
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
  const [campaignSendProgress, setCampaignSendProgress] =
    useState<CampaignSendProgress | null>(null);
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
      dailyLimit = subscription.plans.metadata.marketingMessagesPerDay || 50;
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
        const response = await fetch(`/api/whatsapp/campaigns/send`, {
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
    <div className="space-y-6 pb-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            Marketing
          </h1>
          <p className="text-muted-foreground text-sm">
            Grow your business with campaigns and reviews.
          </p>
        </div>
      </div>

      {/* Top-level stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          {
            label: "Messages Sent",
            value: metrics.totalSent.toString(),
            icon: Send,
            color: "text-blue-600 bg-blue-50 dark:bg-blue-900/30",
          },
          {
            label: "Conversions",
            value: metrics.totalConversions.toString(),
            icon: Users,
            color: "text-purple-600 bg-purple-50 dark:bg-purple-900/30",
          },
          {
            label: "Review Requests",
            value: metrics.reviewRequests.toString(),
            icon: Star,
            color: "text-amber-600 bg-amber-50 dark:bg-amber-900/30",
          },
          {
            label: "Review Responses",
            value: metrics.reviewResponses.toString(),
            icon: Inbox,
            color: "text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30",
          },
        ].map((s) => (
          <Card key={s.label} className="shadow-sm border-border/50">
            <CardContent className="p-5 flex items-center gap-4">
              <div className={`p-3 rounded-lg ${s.color}`}>
                <s.icon className="w-5 h-5" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{s.label}</p>
                <p className="text-2xl font-bold">{s.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="bg-card w-full sm:w-auto shadow-sm border border-border/50">
          <TabsTrigger value="campaigns" className="gap-2">
            <Megaphone className="w-4 h-4" />
            Campaigns
          </TabsTrigger>
          <TabsTrigger value="reviews" className="gap-2">
            <Star className="w-4 h-4" />
            Reviews
          </TabsTrigger>
        </TabsList>

        {/* Campaigns */}
        <TabsContent value="campaigns" className="mt-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Campaigns</h2>
            <Button
              className="bg-primary hover:bg-primary/90"
              onClick={() => setCampaignDialogOpen(true)}
            >
              <Plus className="w-4 h-4 mr-2" /> Create Campaign
            </Button>
          </div>
          {campaigns.length === 0 ? (
            <EmptyStateCard
              icon={Megaphone}
              title="No campaigns yet"
              description="Create your first campaign to start reaching clients."
            />
          ) : (
            <div className="space-y-3">
              {campaigns.map((c) => (
                <Card key={c.id} className="shadow-sm border-border/50">
                  <CardContent className="p-5 flex flex-col sm:flex-row sm:items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <h3 className="font-semibold truncate">{c.name}</h3>
                        <Badge variant="outline" className="text-xs">
                          {c.type}
                        </Badge>
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
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Created {new Date(c.createdAt).toLocaleDateString()}
                      </p>
                      {c.message && (
                        <p className="text-sm text-muted-foreground mt-2 line-clamp-2">
                          {c.message}
                        </p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="reviews" className="mt-6 space-y-4">
          <EmptyStateCard
            icon={Star}
            title="Reviews — Coming Soon"
            description="We're building a way to request and collect customer reviews straight from WhatsApp. Check back soon."
          />
        </TabsContent>
      </Tabs>

      {/* Reviews feature is not live yet — dialog kept commented out below. */}
      {/* <Dialog open={reviewDialogOpen} onOpenChange={setReviewDialogOpen}>
        <DialogContent className="max-w-2xl w-full">
          <DialogHeader>
            <DialogTitle>Send review request</DialogTitle>
            <DialogDescription>
              Send a WhatsApp message asking a client to leave a review.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Client</Label>

              <div className="grid grid-cols-1 gap-3 max-h-[240px] overflow-y-auto pr-1">
                {allClients.map((client) => {
                  const selected = reviewForm.clientId === client.id;

                  return (
                    <button
                      type="button"
                      key={client.id}
                      onClick={() =>
                        setReviewForm((form) => ({
                          ...form,
                          clientId: client.id,
                          clientName: client.name,
                          clientPhone: client.phone,
                        }))
                      }
                      className={`w-full rounded-3xl border p-4 text-left transition duration-200 ${
                        selected
                          ? "border-primary bg-primary/5 shadow-sm"
                          : "border-border/60 bg-card hover:border-primary/70"
                      }`}
                    >
                      <p className="font-semibold text-sm truncate">
                        {client.name}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {client.phone}
                        {client.email ? ` · ${client.email}` : ""}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Client name *</Label>
                <Input
                  value={reviewForm.clientName}
                  onChange={(e) =>
                    setReviewForm((form) => ({
                      ...form,
                      clientName: e.target.value,
                    }))
                  }
                />
              </div>

              <div className="space-y-2">
                <Label>Client phone *</Label>
                <Input
                  value={reviewForm.clientPhone}
                  onChange={(e) =>
                    setReviewForm((form) => ({
                      ...form,
                      clientPhone: e.target.value,
                    }))
                  }
                />
              </div>
            </div>

            <div className="space-y-3">
              <Label>Channel</Label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {(
                  [
                    {
                      id: "WhatsApp",
                      label: "WhatsApp",
                      subtitle: "Send instantly",
                      active: true,
                    },
                    {
                      id: "Email",
                      label: "Email",
                      subtitle: "Coming soon",
                      active: false,
                    },
                    {
                      id: "SMS",
                      label: "SMS",
                      subtitle: "Coming soon",
                      active: false,
                    },
                  ] as const
                ).map((option) => {
                  const isSelected = reviewForm.channel === option.id;
                  return (
                    <button
                      type="button"
                      key={option.id}
                      disabled={!option.active}
                      onClick={() =>
                        option.active &&
                        setReviewForm((form) => ({
                          ...form,
                          channel: option.id,
                        }))
                      }
                      className={`rounded-3xl border p-4 text-left transition-all duration-200 ${
                        option.active
                          ? isSelected
                            ? "border-primary bg-primary/5 shadow-sm"
                            : "border-border/70 bg-card hover:border-primary/80 hover:shadow-sm"
                          : "cursor-not-allowed border-border/30 bg-slate-950/30 text-muted-foreground"
                      }`}
                    >
                      <p className="font-semibold">{option.label}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {option.subtitle}
                      </p>
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                Only WhatsApp can be sent now; Email and SMS are future
                options.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Review URL</Label>
              <Input
                placeholder="Google review link, Facebook review link, etc."
                value={reviewForm.reviewUrl}
                onChange={(e) =>
                  setReviewForm((form) => ({
                    ...form,
                    reviewUrl: e.target.value,
                  }))
                }
              />
            </div>

            <div className="space-y-2">
              <Label>Message *</Label>
              <Textarea
                rows={4}
                value={reviewForm.message}
                onChange={(e) =>
                  setReviewForm((form) => ({
                    ...form,
                    message: e.target.value,
                  }))
                }
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setReviewDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              className="bg-primary hover:bg-primary/90"
              onClick={handleCreateReviewRequest}
            >
              Send request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog> */}

      {/* Create Campaign dialog */}
      <Dialog
        open={campaignDialogOpen}
        onOpenChange={(open) => {
          if (campaignSending) return;
          setCampaignDialogOpen(open);
        }}
      >
        <DialogContent className="max-w-4xl w-full max-h-[calc(100vh-6rem)] overflow-hidden">
          <DialogHeader>
            <DialogTitle>Create campaign</DialogTitle>
            <DialogDescription>
              Create a new campaign draft. Sending can be added later.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 overflow-hidden">
            <div className="space-y-4 max-h-[calc(100vh-18rem)] overflow-y-auto pr-2">
              <div className="space-y-2">
                <Label>Campaign name *</Label>
                <Input
                  placeholder="e.g. Winter Promo"
                  value={campaignForm.name}
                  onChange={(e) =>
                    setCampaignForm((f) => ({ ...f, name: e.target.value }))
                  }
                />
              </div>

              <div className="space-y-3">
                <Label>Channel</Label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {(
                    [
                      {
                        id: "WhatsApp",
                        label: "WhatsApp",
                        subtitle: "Send instantly",
                        active: true,
                      },
                      {
                        id: "Email",
                        label: "Email",
                        subtitle: "Coming soon",
                        active: false,
                      },
                      {
                        id: "SMS",
                        label: "SMS",
                        subtitle: "Coming soon",
                        active: false,
                      },
                    ] as const
                  ).map((option) => {
                    const isSelected = campaignForm.type === option.id;
                    return (
                      <button
                        type="button"
                        key={option.id}
                        disabled={!option.active}
                        onClick={() =>
                          option.active &&
                          setCampaignForm((f) => ({ ...f, type: option.id }))
                        }
                        className={`rounded-3xl border p-4 text-left transition-all duration-200 ${
                          option.active
                            ? isSelected
                              ? "border-primary bg-primary/5 shadow-sm"
                              : "border-border/70 bg-card hover:border-primary/80 hover:shadow-sm"
                            : "cursor-not-allowed border-border/30 bg-slate-950/30 text-muted-foreground"
                        }`}
                      >
                        <p className="font-semibold">{option.label}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {option.subtitle}
                        </p>
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground">
                  Only WhatsApp can be sent now; Email and SMS are future
                  options.
                </p>
              </div>

              <div className="space-y-2">
                <Label>Message</Label>
                <Textarea
                  rows={4}
                  placeholder="Write a short message to customers…"
                  value={campaignForm.message}
                  onChange={(e) =>
                    setCampaignForm((f) => ({ ...f, message: e.target.value }))
                  }
                />
              </div>

              <div className="space-y-2">
                <Label>Campaign image</Label>
                <div className="flex flex-col sm:flex-row sm:items-center sm:gap-3">
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      onClick={() => campaignImageInputRef.current?.click()}
                      disabled={campaignImageUploading}
                    >
                      {campaignImageUploading ? "Uploading…" : "Upload image"}
                    </Button>
                    {campaignForm.imageUrl ? (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={clearCampaignImage}
                        disabled={campaignImageUploading}
                      >
                        Remove
                      </Button>
                    ) : null}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Optional image to attach to WhatsApp campaigns. File upload
                    only.
                  </p>
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
                {campaignForm.imageUrl ? (
                  <img
                    src={campaignForm.imageUrl}
                    alt="Campaign preview"
                    className="mt-2 h-48 w-full rounded-xl object-cover border border-border/50"
                  />
                ) : null}
              </div>

              <div className="space-y-3">
                <div className="rounded-3xl border border-border/60 bg-card p-4 space-y-4">
                  <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                    <div className="min-w-0">
                      <Label>Recipients</Label>
                      <p className="text-xs text-muted-foreground mt-1">
                        Clients are loaded from the database in batches. The list only renders a small chunk at a time.
                      </p>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-2xl border border-border/50 bg-background px-3 py-2">
                        <p className="text-sm font-semibold">{allClients.length}</p>
                        <p className="text-[11px] text-muted-foreground">loaded</p>
                      </div>
                      <div className="rounded-2xl border border-border/50 bg-background px-3 py-2">
                        <p className="text-sm font-semibold">{filteredClients.length}</p>
                        <p className="text-[11px] text-muted-foreground">matching</p>
                      </div>
                      <div className="rounded-2xl border border-border/50 bg-background px-3 py-2">
                        <p className="text-sm font-semibold">
                          {sendToAllClients ? allClients.length : selectedClientIds.length}
                        </p>
                        <p className="text-[11px] text-muted-foreground">selected</p>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col lg:flex-row gap-3">
                    <Input
                      placeholder="Search clients by name, phone, or email"
                      value={clientSearch}
                      onChange={(e) => setClientSearch(e.target.value)}
                      disabled={sendToAllClients || loadingClients}
                      className="lg:flex-1"
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
                </div>

                {loadingClients ? (
                  <div className="rounded-3xl border border-border/50 bg-card p-5 space-y-3">
                    Loading clients…
                  </div>
                ) : allClients.length === 0 ? (
                  <div className="rounded-3xl border border-dashed border-border/50 bg-card p-6 text-center text-sm text-muted-foreground">
                    No clients found. Add clients before sending a campaign.
                  </div>
                ) : filteredClients.length === 0 ? (
                  <div className="rounded-3xl border border-dashed border-border/50 bg-card p-6 text-center text-sm text-muted-foreground">
                    No clients match your search.
                  </div>
                ) : sendToAllClients ? (
                  <div className="rounded-3xl border border-border/50 bg-card p-6 text-center text-sm text-muted-foreground">
                    All {allClients.length} clients will receive this campaign.
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="rounded-3xl border border-border/50 bg-card p-4 space-y-3">
                      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
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
                        <div className="flex flex-wrap items-center gap-2">
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
                          <p className="text-xs text-muted-foreground">
                            Showing {visibleClients.length} of {filteredClients.length}
                          </p>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {selectedVisibleClientCount} of {visibleClients.length} visible selected. {selectedFilteredClientCount} matching clients selected total.
                      </p>
                    </div>

                    <div className="grid grid-cols-1 gap-3 max-h-[420px] overflow-y-auto pr-1">
                    {visibleClients.map((client) => {
                      const checked = selectedClientIds.includes(client.id);
                      return (
                        <button
                          type="button"
                          key={client.id}
                          onClick={() => toggleClientSelection(client.id)}
                          className={`w-full rounded-3xl border p-4 text-left transition duration-200 ${
                            checked
                              ? "border-primary bg-primary/5 shadow-sm"
                              : "border-border/60 bg-card hover:border-primary/70"
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
            </div>
          </div>
          <DialogFooter>
            {campaignSendProgress ? (
              <div className="mr-auto w-full rounded-3xl border border-border/50 bg-card p-4 text-sm sm:max-w-md">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold">
                      {campaignSending ? "Sending WhatsApp campaign" : "Send complete"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {campaignSendProgress.processed} of {campaignSendProgress.total} processed
                      {campaignSendProgress.currentClientName
                        ? ` · ${campaignSendProgress.currentClientName}`
                        : ""}
                    </p>
                  </div>
                  {campaignSending ? (
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  ) : null}
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{
                      width: `${Math.round(
                        (campaignSendProgress.processed /
                          Math.max(campaignSendProgress.total, 1)) *
                          100,
                      )}%`,
                    }}
                  />
                </div>
                <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                  <span>{campaignSendProgress.sent} sent</span>
                  <span>{campaignSendProgress.failed} failed</span>
                </div>
              </div>
            ) : null}
            <Button
              variant="outline"
              onClick={() => setCampaignDialogOpen(false)}
              disabled={campaignSending}
            >
              Cancel
            </Button>
            <Button
              className="bg-primary hover:bg-primary/90"
              onClick={handleCreateCampaign}
              disabled={campaignSending}
            >
              {campaignSending ? "Sending..." : "Create campaign"}
            </Button>
          </DialogFooter>
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
