import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useWhatsappConnection } from "@/hooks/use-whatsapp-connection";
import {
  ArrowRight,
  CheckSquare,
  FileSpreadsheet,
  FileText,
  Loader2,
  Mail,
  Search,
  Send,
  Trash2,
  UploadCloud,
  Users,
  X,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { ensureBusiness } from "@/lib/settings";
import { uploadCampaignImage } from "@/lib/booking-page-upload";
import { fetchSubscription } from "@/lib/catalog-subscriptions";
import { fetchEmailDomain } from "@/lib/email-domains";
import { buildApiUrl } from "@workspace/api-client-react";
import {
  CLIENT_LIST_PAGE_SIZE,
  EMAIL_DAILY_BATCH_SIZE,
  WHATSAPP_SEND_PAUSE_MS,
  extractEmailAddresses,
  fetchAllMarketingClients,
  makeId,
  shouldStopCampaignForError,
  wait,
  type Campaign,
  type CampaignChannel,
  type CampaignSendProgress,
  type CampaignSendResult,
  type CampaignStatus,
  type MarketingClient,
} from "@/lib/marketing-campaigns";
import { PageHeader } from "@/components/layout/page-ui";
import { usePageChrome } from "@/components/layout/page-chrome";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

/**
 * Composing a campaign.
 *
 * This was four steps inside a 1000px modal, with a live preview crammed into
 * the right-hand third and three separate things telling you which step you were
 * on. A campaign is a document you write, not a wizard you complete: the three
 * parts are now sections you can fill in any order, the preview sits beside them
 * the whole time, and the send bar carries the numbers that decide whether you
 * can send at all.
 */
const CAMPAIGN_STEPS = [
  { value: "setup", label: "Setup" },
  { value: "content", label: "Content" },
  { value: "audience", label: "Audience" },
] as const;

type CampaignStep = (typeof CAMPAIGN_STEPS)[number]["value"];

export default function CampaignNewPage() {
  const [, navigate] = useLocation();
  const [step, setStep] = useState<CampaignStep>("setup");

  const [campaignForm, setCampaignForm] = useState({
    name: "",
    type: "WhatsApp" as CampaignChannel,
    message: "",
    imageUrl: "",
    contentType: "text" as "text" | "html",
  });
  const [emailImportFileName, setEmailImportFileName] = useState<string | null>(null);
  const [emailRecipients, setEmailRecipients] = useState<string[]>([]);
  const [selectedEmailRecipients, setSelectedEmailRecipients] = useState<string[]>([]);
  const [manualEmailInput, setManualEmailInput] = useState("");
  const [emailImportErrors, setEmailImportErrors] = useState<string[]>([]);
  const [emailImportWarnings, setEmailImportWarnings] = useState<string[]>([]);
  const [emailImporting, setEmailImporting] = useState(false);
  const [campaignImageUploading, setCampaignImageUploading] = useState(false);
  const fastMode = false;
  const [campaignSending, setCampaignSending] = useState(false);
  const [campaignSendProgress, setCampaignSendProgress] = useState<CampaignSendProgress | null>(null);
  const [selectedClientIds, setSelectedClientIds] = useState<string[]>([]);
  const [sendToAllClients, setSendToAllClients] = useState(false);
  const [clientSearch, setClientSearch] = useState("");
  const [visibleClientCount, setVisibleClientCount] = useState(CLIENT_LIST_PAGE_SIZE);
  const campaignImageInputRef = useRef<HTMLInputElement>(null);

  const {
    data: allClients = [],
    isLoading: loadingClients,
    isFetching: refreshingClients,
  } = useQuery({
    queryKey: ["marketing-clients", "all"],
    queryFn: fetchAllMarketingClients,
    staleTime: 60_000,
  });

  const { data: emailDomain } = useQuery({
    queryKey: ["email-domain"],
    queryFn: fetchEmailDomain,
  });
  const emailDomainVerified = emailDomain?.status === "verified";

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
  const selectedClients = allClients.filter((client) => selectedClientIds.includes(client.id));
  const campaignRecipients = sendToAllClients ? allClients : selectedClients;
  const filteredClientIds = useMemo(() => filteredClients.map((client) => client.id), [filteredClients]);
  const selectedFilteredClientCount = filteredClientIds.filter((id) => selectedClientIds.includes(id)).length;
  const hasMoreVisibleClients = visibleClientCount < filteredClients.length;

  const { connected: whatsappConnected, loading: loadingWhatsappConnection } = useWhatsappConnection();

  const pageChrome = useMemo(
    () => ({
      breadcrumbs: [{ label: "Marketing", href: "/marketing" }, { label: "New campaign" }],
      internalNav: {
        items: CAMPAIGN_STEPS.map((item) => ({ value: item.value, label: item.label })),
        active: step,
        onChange: (value: string) => setStep(value as CampaignStep),
        ariaLabel: "Campaign steps",
      },
    }),
    [step],
  );
  usePageChrome(pageChrome);

  const isEmailCampaign = campaignForm.type === "Email";
  const isWhatsappCampaign = campaignForm.type === "WhatsApp";
  const whatsappBlocked = isWhatsappCampaign && !whatsappConnected && !loadingWhatsappConnection;
  const recipientCount = isEmailCampaign ? selectedEmailRecipients.length : campaignRecipients.length;
  const canSendCampaign =
    !campaignSending &&
    !whatsappBlocked &&
    Boolean(campaignForm.name.trim()) &&
    Boolean(campaignForm.message.trim()) &&
    recipientCount > 0;

  const toggleClientSelection = (clientId: string) => {
    setSelectedClientIds((prev) =>
      prev.includes(clientId) ? prev.filter((id) => id !== clientId) : [...prev, clientId],
    );
  };

  const selectAllFilteredClients = () => {
    setSelectedClientIds((prev) => Array.from(new Set([...prev, ...filteredClientIds])));
  };

  const clearSelectedClients = () => {
    setSelectedClientIds([]);
    setSendToAllClients(false);
  };

  function getErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error) return error.message;
    if (error && typeof error === "object") {
      const record = error as Record<string, unknown>;
      if (typeof record.message === "string" && record.message.trim()) return record.message;
      if (typeof record.error === "string" && record.error.trim()) return record.error;
    }
    return fallback;
  }

  const handleImportEmailRecipients = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = "";

    setEmailImportFileName(file.name);
    setEmailImportErrors([]);
    setEmailImportWarnings([]);
    setEmailImporting(true);

    try {
      let text = "";
      if (file.name.toLowerCase().endsWith(".pdf")) {
        const { extractPdfText } = await import("@/lib/pdf-import");
        text = await extractPdfText(file);
      } else {
        text = await file.text();
      }

      const importedEmails = extractEmailAddresses(text);
      if (importedEmails.length === 0) {
        setEmailRecipients([]);
        setSelectedEmailRecipients([]);
        setEmailImportErrors(["No valid email addresses were found in the uploaded file."]);
        return;
      }

      setEmailRecipients((prev) => {
        const merged = [...prev];
        importedEmails.forEach((email) => {
          if (!merged.includes(email)) merged.push(email);
        });
        return merged;
      });
      setSelectedEmailRecipients((prev) => {
        const merged = [...prev];
        importedEmails.forEach((email) => {
          if (!merged.includes(email)) merged.push(email);
        });
        return merged;
      });
      setEmailImportWarnings([]);
      toast("Emails imported", { description: `${importedEmails.length} email address${importedEmails.length === 1 ? "" : "es"} added for this one-time campaign.` });
    } catch (error) {
      setEmailRecipients([]);
      setSelectedEmailRecipients([]);
      setEmailImportErrors([
        error instanceof Error ? error.message : "Could not read this file. Try a CSV or PDF export with email addresses.",
      ]);
    } finally {
      setEmailImporting(false);
    }
  };

  const clearEmailRecipients = () => {
    setEmailRecipients([]);
    setSelectedEmailRecipients([]);
    setEmailImportFileName(null);
    setEmailImportErrors([]);
    setEmailImportWarnings([]);
    setManualEmailInput("");
  };

  const addManualEmailRecipient = () => {
    const trimmed = manualEmailInput.trim();
    if (!trimmed) return;

    const normalized = trimmed.toLowerCase();
    const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
    if (!isValidEmail) {
      setEmailImportErrors(["Please enter a valid email address."]);
      return;
    }

    setEmailRecipients((prev) => {
      if (prev.some((item) => item.toLowerCase() === normalized)) {
        return prev;
      }
      return [...prev, trimmed];
    });
    setSelectedEmailRecipients((prev) => {
      if (prev.some((item) => item.toLowerCase() === normalized)) {
        return prev;
      }
      return [...prev, trimmed];
    });
    setManualEmailInput("");
    setEmailImportErrors([]);
    setEmailImportWarnings([]);
  };

  const handleCreateCampaign = async () => {
    if (campaignSending) return;

    if (!campaignForm.name.trim()) {
      toast.error("Campaign name is required");
      return;
    }

    const isWhatsapp = campaignForm.type === "WhatsApp";
    const isEmail = campaignForm.type === "Email";
    const recipientIds = isEmail
      ? selectedEmailRecipients
      : sendToAllClients
        ? allClients.map((client) => client.id)
        : selectedClientIds;
    if (isWhatsapp && campaignRecipients.length === 0) {
      toast.error("Select at least one client", { description: "Choose clients to send this WhatsApp campaign to." });
      return;
    }

    if (isEmail && selectedEmailRecipients.length === 0) {
      toast.error("Select at least one email address", { description: "Import recipients and choose the ones you want to include in this email campaign." });
      return;
    }

    if (isEmail && !emailDomainVerified) {
      toast.error("Connect a branded email domain first", { description: "Email campaigns require a verified domain, set up in Settings, before they can send." });
      return;
    }

    const recipientCount = isEmail ? selectedEmailRecipients.length : campaignRecipients.length;

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
      toast.error("Daily limit reached", { description: `You've sent ${messagesSentToday} marketing messages today. Your daily limit is ${dailyLimit}. Try again tomorrow.` });
      return;
    }

    if (recipientCount > remainingMessages) {
      toast.error("Not enough messages remaining", { description: `You have ${remainingMessages} messages remaining today (limit: ${dailyLimit}). Select ${remainingMessages} or fewer clients.` });
      return;
    }

    const next: Omit<Campaign, "status"> & { status: Campaign["status"] } = {
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
        toast("Campaign started", { description: `Sending to ${payload.totalRecipients} recipients in background with anti-fingerprinting protection.` });
      } catch (error) {
        toast.error("Could not send campaign", { description: error instanceof Error
              ? error.message
              : "Please check the WhatsApp connection." });
        return;
      } finally {
        setCampaignSending(false);
      }
    }

    // For email campaigns, queue the send in daily batches of 100 and save the campaign row.
    if (isEmail) {
      setCampaignSending(true);
      try {
        const businessId = await ensureBusiness();
        const { data, error } = await supabase
          .from("marketing_campaigns")
          .insert([
            {
              business_id: businessId,
              name: next.name,
              channel: next.type,
              status: "draft",
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

        if (error || !data) {
          throw new Error(error?.message || "Failed to save email campaign");
        }

        const response = await fetch(buildApiUrl("/api/email/campaigns/send"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(await supabase.auth.getSession()).data.session?.access_token
              ? { Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}` }
              : {},
          },
          body: JSON.stringify({
            campaignId: data.id,
            recipients: recipientIds,
            subject: next.name,
            message: next.message,
            contentType: campaignForm.contentType,
          }),
        });

        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          await supabase
            .from("marketing_campaigns")
            .update({ status: "draft", updated_at: new Date().toISOString() })
            .eq("id", data.id);
          throw new Error(payload?.error || "Failed to queue email campaign");
        }

        insertedCampaign = {
          ...next,
          id: data.id,
          status: "active" as CampaignStatus,
          recipientCount,
        };

        toast("Email campaign queued", { description: `Queued ${recipientCount} email${recipientCount === 1 ? "" : "s"} to be sent in daily batches of ${EMAIL_DAILY_BATCH_SIZE}.` });
      } catch (error) {
        const message = getErrorMessage(error, "Please try again.");
        console.error("Failed to queue email campaign", { error, message });
        toast.error("Could not queue email campaign", { description: message });
        return;
      } finally {
        setCampaignSending(false);
      }
    }

    if (!isWhatsapp && !isEmail) {
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
        toast.error("Could not save campaign", { description: message });
        return;
      }
    }

    setCampaignForm({ name: "", type: "WhatsApp", message: "", imageUrl: "", contentType: "text" });
    setSelectedClientIds([]);
    clearEmailRecipients();
    setSendToAllClients(false);

    toast(isWhatsapp ? "Campaign sent" : isEmail ? "Email campaign queued" : "Campaign created", { description: isWhatsapp
        ? `${next.sent} WhatsApp messages were sent to ${campaignRecipients.length} clients.`
        : isEmail
          ? `${next.name} is being sent to ${recipientCount} selected email${recipientCount === 1 ? "" : "s"} in daily batches of ${EMAIL_DAILY_BATCH_SIZE}.`
          : `${next.name} has been saved as a draft.` });
    setCampaignSendProgress(null);
    navigate("/marketing");
  };

  const handleCampaignImageUpload = async (file: File | null) => {
    if (!file) return;

    setCampaignImageUploading(true);
    try {
      const url = await uploadCampaignImage(file);
      setCampaignForm((form) => ({ ...form, imageUrl: url }));
      toast("Image uploaded", { description: "Campaign image is ready." });
    } catch (error) {
      const message = getErrorMessage(error, "Please try again.");
      toast.error("Image upload failed", { description: message });
    } finally {
      setCampaignImageUploading(false);
    }
  };

  const clearCampaignImage = () => {
    setCampaignForm((form) => ({ ...form, imageUrl: "" }));
  };

  return (
    <div className="space-y-6">
      <PageHeader title="New campaign" description="Write it, choose who gets it, and send." />

      <Card className="sticky top-0 z-30 border-border/70 shadow-sm">
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "inline-flex h-2 w-2 shrink-0 rounded-full",
                  whatsappBlocked ? "bg-amber-500" : canSendCampaign ? "bg-primary" : "bg-muted-foreground/40",
                )}
              />
              <p className="text-sm font-semibold text-foreground">
                {whatsappBlocked
                  ? "WhatsApp not connected"
                  : recipientCount === 0
                    ? "No recipients chosen yet"
                    : `${recipientCount} recipient${recipientCount === 1 ? "" : "s"}`}
              </p>
            </div>
            <p className="text-xs leading-5 text-muted-foreground">
              {whatsappBlocked ? (
                <>
                  Connect your WhatsApp number in{" "}
                  <Link href="/settings" className="font-medium text-primary hover:underline">
                    Settings
                  </Link>{" "}
                  before sending a WhatsApp campaign.
                </>
              ) : campaignSendProgress ? (
                `Sending — ${campaignSendProgress.processed} of ${campaignSendProgress.total} done${campaignSendProgress.failed ? `, ${campaignSendProgress.failed} failed` : ""}`
              ) : isEmailCampaign ? (
                `Email campaigns send in daily batches of ${EMAIL_DAILY_BATCH_SIZE}.`
              ) : (
                "Sends from your own WhatsApp number, paced to avoid rate limits."
              )}
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => navigate("/marketing")} disabled={campaignSending}>
              Cancel
            </Button>
            <Button onClick={handleCreateCampaign} disabled={!canSendCampaign}>
              {campaignSending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              {isEmailCampaign ? "Queue campaign" : "Send campaign"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-6 lg:flex-row lg:items-stretch">
        <div className="w-full space-y-4 pb-4 lg:shrink-0 lg:grow-0 lg:basis-[calc(100%-24rem-1.5rem)]">
          <Card className={cn(step === "setup" ? "" : "hidden")}>
            <CardContent className="space-y-5">
            <div className="space-y-6">
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
                          {
                            id: "Email",
                            label: "Email",
                            subtitle: emailDomainVerified ? "Save as draft" : "Connect a domain",
                            active: emailDomainVerified,
                          },
                          { id: "SMS", label: "SMS", subtitle: "Coming soon", active: false },
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
                              setCampaignForm((f) => ({
                                ...f,
                                type: option.id,
                                contentType: option.id === "Email" ? f.contentType : "text",
                              }))
                            }
                            className={`rounded-lg border p-4 text-left transition-all duration-200 ${
                              option.active
                                ? isSelected
                                  ? "border-primary bg-primary/5 shadow-md ring-1 ring-primary/20 scale-[1.02]"
                                  : "border-border/70 bg-muted hover:border-primary/80 hover:shadow-sm"
                                : "cursor-not-allowed border-border/30 bg-muted/70 text-muted-foreground/60"
                            }`}
                          >
                            <p className={cn("font-semibold", option.active && "text-foreground")}>
                              {option.label}
                            </p>
                            <p
                              className={cn(
                                "text-xs mt-1",
                                option.active && "text-muted-foreground",
                              )}
                            >
                              {option.subtitle}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                    {!emailDomainVerified && (
                      <p className="text-xs text-muted-foreground">
                        Email campaigns send from your own branded domain, not the shared Qwickly
                        sender.{" "}
                        <Link
                          href="/settings?tab=profile&tour=custom-email"
                          className="font-medium text-primary hover:underline"
                        >
                          Connect and verify a domain in Settings
                        </Link>{" "}
                        to unlock this.
                      </p>
                    )}
                  </div>

                </div>
              </section>
            </div>
            </CardContent>
          </Card>

          <Card className={cn(step === "content" ? "" : "hidden")}>
            <CardContent className="space-y-5">
            <div className="space-y-6">
              <section className="space-y-6">
                <h3 className="mb-6 text-lg font-semibold text-foreground">Message content</h3>

                <div className="space-y-6">
                  <div className="space-y-3">
                    {campaignForm.type === "Email" ? (
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Label className="text-sm font-medium">Message content</Label>
                        <div className="flex rounded-full border border-border/70 bg-muted/50 p-1">
                          <Button
                            type="button"
                            variant={campaignForm.contentType === "text" ? "default" : "ghost"}
                            size="sm"
                            className="h-8 rounded-full px-3"
                            onClick={() => setCampaignForm((f) => ({ ...f, contentType: "text" }))}
                          >
                            Text
                          </Button>
                          <Button
                            type="button"
                            variant={campaignForm.contentType === "html" ? "default" : "ghost"}
                            size="sm"
                            className="h-8 rounded-full px-3"
                            onClick={() => setCampaignForm((f) => ({ ...f, contentType: "html" }))}
                          >
                            HTML
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Label className="text-sm font-medium">Message text</Label>
                    )}
                    <Textarea
                      rows={6}
                      placeholder={campaignForm.type === "Email" && campaignForm.contentType === "html"
                        ? "Paste your HTML email content here..."
                        : "Write a compelling message for your customers..."}
                      className="resize-none font-mono"
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
            </CardContent>
          </Card>

          <Card className={cn(step === "audience" ? "" : "hidden")}>
            <CardContent className="space-y-5">
            <div className="space-y-6">
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
                  {isEmailCampaign ? (
                    <div className="space-y-4 rounded-xl border border-dashed border-border/70 bg-card p-4">
                      <div className="flex items-start gap-3">
                        <div className="rounded-full bg-primary/10 p-2 text-primary">
                          <Mail className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 space-y-1">
                          <p className="text-sm font-semibold text-foreground">Temporary email audience</p>
                          <p className="text-sm text-muted-foreground">
                            Import email addresses for this one-time campaign. They are only used here and are not saved to your client list.
                          </p>
                        </div>
                      </div>

                      <div className="grid gap-3 md:grid-cols-2">
                        <label htmlFor="campaign-email-csv-upload" className="flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-border bg-background px-4 py-6 text-center transition hover:border-primary/60 hover:bg-primary/5">
                          <UploadCloud className="h-5 w-5 text-primary" />
                          <span className="mt-2 text-sm font-semibold text-foreground">Import CSV / TSV</span>
                          <span className="mt-1 text-xs text-muted-foreground">Upload a contact export with email addresses</span>
                        </label>
                        <input
                          id="campaign-email-csv-upload"
                          type="file"
                          accept=".csv,.tsv"
                          className="hidden"
                          onChange={handleImportEmailRecipients}
                        />

                        <label htmlFor="campaign-email-pdf-upload" className="flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-border bg-background px-4 py-6 text-center transition hover:border-primary/60 hover:bg-primary/5">
                          <FileText className="h-5 w-5 text-primary" />
                          <span className="mt-2 text-sm font-semibold text-foreground">Import PDF</span>
                          <span className="mt-1 text-xs text-muted-foreground">Use a PDF report with email addresses</span>
                        </label>
                        <input
                          id="campaign-email-pdf-upload"
                          type="file"
                          accept="application/pdf,.pdf"
                          className="hidden"
                          onChange={handleImportEmailRecipients}
                        />
                      </div>

                      <div className="rounded-lg border border-border/60 bg-background p-3">
                        <Label className="text-sm font-medium">Add an email manually</Label>
                        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                          <Input
                            type="email"
                            placeholder="name@example.com"
                            value={manualEmailInput}
                            onChange={(event) => setManualEmailInput(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                addManualEmailRecipient();
                              }
                            }}
                          />
                          <Button type="button" variant="outline" onClick={addManualEmailRecipient}>
                            Add email
                          </Button>
                        </div>
                      </div>

                      {emailImportFileName ? (
                        <p className="text-xs text-muted-foreground">Loaded file: {emailImportFileName}</p>
                      ) : null}

                      {emailImportErrors.length > 0 ? (
                        <div className="space-y-1 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
                          {emailImportErrors.map((error) => <p key={error}>{error}</p>)}
                        </div>
                      ) : null}

                      {emailImportWarnings.length > 0 ? (
                        <div className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-400">
                          {emailImportWarnings.map((warning) => <p key={warning}>{warning}</p>)}
                        </div>
                      ) : null}

                      {emailRecipients.length > 0 ? (
                        <div className="space-y-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-sm font-semibold text-foreground">
                              {emailRecipients.length} temporary recipient{emailRecipients.length === 1 ? "" : "s"}
                            </p>
                            <div className="flex flex-wrap items-center gap-2">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => setSelectedEmailRecipients(emailRecipients)}
                                disabled={selectedEmailRecipients.length === emailRecipients.length}
                              >
                                Select all
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => setSelectedEmailRecipients([])}
                                disabled={selectedEmailRecipients.length === 0}
                              >
                                Clear selection
                              </Button>
                              <Button type="button" variant="ghost" size="sm" onClick={clearEmailRecipients}>
                                Clear all
                              </Button>
                            </div>
                          </div>
                          <div className="rounded-md border border-border/60 bg-background px-3 py-2 text-xs text-muted-foreground">
                            {selectedEmailRecipients.length} selected for this campaign
                          </div>
                          <div className="max-h-48 space-y-2 overflow-y-auto rounded-lg border border-border/60 bg-background p-3">
                            {emailRecipients.map((email) => {
                              const isSelected = selectedEmailRecipients.includes(email);
                              return (
                                <div key={email} className="flex items-center justify-between gap-3 rounded-md border border-border/50 bg-card px-3 py-2 text-sm">
                                  <div className="flex min-w-0 items-center gap-2">
                                    <Checkbox
                                      checked={isSelected}
                                      onCheckedChange={(checked) => {
                                        const shouldSelect = Boolean(checked);
                                        setSelectedEmailRecipients((prev) =>
                                          shouldSelect
                                            ? prev.includes(email)
                                              ? prev
                                              : [...prev, email]
                                            : prev.filter((item) => item !== email),
                                        );
                                      }}
                                    />
                                    <span className="truncate">{email}</span>
                                  </div>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 px-2 text-destructive hover:bg-destructive/10"
                                    onClick={() => {
                                      setEmailRecipients((prev) => prev.filter((item) => item !== email));
                                      setSelectedEmailRecipients((prev) => prev.filter((item) => item !== email));
                                    }}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}

                      {emailImporting ? (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Importing email addresses...
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <>
                      <p className="rounded-lg border border-border/60 bg-muted/40 p-3 text-xs leading-5 text-muted-foreground">
                        Only clients who&apos;ve messaged you on WhatsApp appear here — those are
                        the ones you can reach from your own number. Reaching brand-new contacts is
                        coming soon.
                      </p>
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
                          No clients have messaged you on WhatsApp yet, so there&apos;s no one to send
                          a WhatsApp campaign to. Once a client messages your number, they&apos;ll appear here.
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
                    </>
                  )}
                </div>
              </section>
            </div>
            </CardContent>
          </Card>

          {step === "audience" ? null : (
            <div className="flex justify-end">
              <Button
                variant="outline"
                onClick={() => setStep(step === "setup" ? "content" : "audience")}
              >
                Continue
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          )}
        </div>

        <aside className="w-full lg:shrink-0 lg:grow-0 lg:basis-96">
          <div className="lg:sticky lg:top-24">
            <Card>
              <CardContent className="space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold text-foreground">Preview</h3>
                    <p className="mt-1 text-sm text-muted-foreground">How this campaign is shaping up.</p>
                  </div>
                  <Badge variant="outline" className="rounded-full border-primary/20 bg-primary/10 text-primary">
                    {campaignForm.type}
                  </Badge>
                </div>

                <div className="rounded-lg border border-border/70 bg-muted/30 p-4">
                  <p className="text-xs font-medium text-muted-foreground">Campaign</p>
                  <p className="mt-1 truncate text-sm font-semibold text-foreground">
                    {campaignForm.name || "Untitled campaign"}
                  </p>
                </div>

                <div className="rounded-lg border border-border/70 p-4">
                  <p className="text-xs font-medium text-muted-foreground">Message</p>
                  {campaignForm.imageUrl ? (
                    <img
                      src={campaignForm.imageUrl}
                      alt=""
                      className="mt-2 max-h-40 w-full rounded-md object-cover"
                    />
                  ) : null}
                  <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">
                    {campaignForm.message || "Your message will appear here as you type."}
                  </p>
                </div>

                <div className="rounded-lg border border-border/70 p-4">
                  <p className="text-xs font-medium text-muted-foreground">Audience</p>
                  <p className="mt-1 text-sm text-foreground">
                    {recipientCount === 0
                      ? "Nobody selected yet"
                      : `${recipientCount} ${isEmailCampaign ? "email address" : "client"}${recipientCount === 1 ? "" : "es"}`}
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </aside>
      </div>
    </div>
  );
}
