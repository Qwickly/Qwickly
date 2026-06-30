import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  getGetWhatsappConversationsQueryKey,
  type WhatsappConversation,
  type WhatsappMessage,
  useGetWhatsappConversations,
  useMarkWhatsappConversationRead,
  useSendWhatsappConversationMessage,
} from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Loader2,
  MessageSquare,
  Bot,
  Settings2,
  Search,
  UserCircle2,
  Send,
  Plus,
  Clock,
  Check,
  CheckCheck,
  AlertCircle,
  Scissors,
  Unplug,
  Copy,
  X,
  MoreHorizontal,
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { WhatsappConnectionManager } from "@/components/settings/WhatsappConnectionManager";
import { useWhatsappConnection } from "@/hooks/use-whatsapp-connection";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import {
  getCachedConversations,
  setCachedConversations,
  getCachedMessages,
  setCachedMessages,
} from "@/lib/whatsapp-cache";
import { catalogKeys, fetchServices } from "@/lib/catalog";
import {
  fetchBotSettings,
  saveBotSettings,
  type BotTone,
  type BotSettings,
  type BotWorkingHour,
  type BotReviewMode,
} from "@/lib/bot-settings";

const ALL_DAYS = [
  { key: "monday", label: "Monday" },
  { key: "tuesday", label: "Tuesday" },
  { key: "wednesday", label: "Wednesday" },
  { key: "thursday", label: "Thursday" },
  { key: "friday", label: "Friday" },
  { key: "saturday", label: "Saturday" },
  { key: "sunday", label: "Sunday" },
] as const;

type DayKey = (typeof ALL_DAYS)[number]["key"];

type DayHour = {
  isOpen: boolean;
  openTime: string;
  closeTime: string;
};

type WhatsappAiDraft = {
  id: string;
  remoteJid: string;
  clientId: string | null;
  clientName: string | null;
  clientPhone: string | null;
  inboundMessageText: string;
  suggestedReply: string;
  proposedActions: Array<Record<string, unknown>>;
  status: string;
  createdAt: string;
};

const DEFAULT_HOURS: Record<DayKey, DayHour> = {
  monday: { isOpen: true, openTime: "08:00", closeTime: "18:00" },
  tuesday: { isOpen: true, openTime: "08:00", closeTime: "18:00" },
  wednesday: { isOpen: true, openTime: "08:00", closeTime: "18:00" },
  thursday: { isOpen: true, openTime: "08:00", closeTime: "18:00" },
  friday: { isOpen: true, openTime: "08:00", closeTime: "18:00" },
  saturday: { isOpen: true, openTime: "08:00", closeTime: "15:00" },
  sunday: { isOpen: false, openTime: "09:00", closeTime: "13:00" },
};

const MESSAGE_BATCH_SIZE = 25;
const MAX_MESSAGE_LIMIT = 500;

function createBotSettingsSnapshot(input: {
  businessId: string;
  botEnabled: boolean;
  autoConfirm: boolean;
  acceptCancellations: boolean;
  sendPaymentLinks: boolean;
  answerFaqs: boolean;
  alwaysOn: boolean;
  tone: BotTone;
  botName: string;
  welcomeMessage: string;
  fallbackMessage: string;
  reviewMode: BotReviewMode;
  ownerReviewAlertsEnabled: boolean;
  ownerAlertPhone: string;
  ownerAlertQuietStart: string;
  ownerAlertQuietEnd: string;
  workingHours: Record<DayKey, DayHour>;
  allowedServiceIds: Set<string>;
}): string {
  return JSON.stringify({
    businessId: input.businessId,
    botEnabled: input.botEnabled,
    autoConfirm: input.autoConfirm,
    acceptCancellations: input.acceptCancellations,
    sendPaymentLinks: input.sendPaymentLinks,
    answerFaqs: input.answerFaqs,
    alwaysOn: input.alwaysOn,
    tone: input.tone,
    botName: input.botName,
    welcomeMessage: input.welcomeMessage,
    fallbackMessage: input.fallbackMessage,
    reviewMode: input.reviewMode,
    ownerReviewAlertsEnabled: input.ownerReviewAlertsEnabled,
    ownerAlertPhone: input.ownerAlertPhone,
    ownerAlertQuietStart: input.ownerAlertQuietStart,
    ownerAlertQuietEnd: input.ownerAlertQuietEnd,
    workingHours: ALL_DAYS.map((day) => ({
      day: day.key,
      ...input.workingHours[day.key],
    })),
    allowedServiceIds: Array.from(input.allowedServiceIds).sort(),
  });
}

async function fetchWhatsappMessages(
  conversationId: number,
  limit: number,
): Promise<WhatsappMessage[]> {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  const response = await fetch(
    `/api/whatsapp/conversations/${conversationId}/messages?limit=${limit}`,
    {
      headers: {
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
    },
  );

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error ?? "Could not load WhatsApp messages");
  }

  return response.json() as Promise<WhatsappMessage[]>;
}

async function fetchWhatsappAiDrafts(): Promise<WhatsappAiDraft[]> {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  const response = await fetch("/api/whatsapp/ai-drafts?limit=25", {
    headers: {
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error ?? "Could not load AI drafts");
  }

  const payload = await response.json();
  return (payload?.drafts ?? []) as WhatsappAiDraft[];
}

export default function WhatsAppPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("conversations");
  const [selectedConversationId, setSelectedConversationId] = useState<
    number | null
  >(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [replyText, setReplyText] = useState("");
  const [newChatPhone, setNewChatPhone] = useState("");
  const [newChatMessage, setNewChatMessage] = useState("");
  const [showNewChatForm, setShowNewChatForm] = useState(false);
  const [creatingNewChat, setCreatingNewChat] = useState(false);
  const [messageLimit, setMessageLimit] = useState(MESSAGE_BATCH_SIZE);
  const messagePaneRef = useRef<HTMLDivElement | null>(null);
  const previousScrollHeightRef = useRef(0);
  const loadingOlderRef = useRef(false);
  const {
    connection,
    connected,
    loading: loadingConnection,
    disconnecting,
    disconnect,
  } = useWhatsappConnection();

  // Bot setup state
  const [alwaysOn, setAlwaysOn] = useState(false);
  const [workingHours, setWorkingHours] =
    useState<Record<DayKey, DayHour>>(DEFAULT_HOURS);
  const [allowedServiceIds, setAllowedServiceIds] = useState<Set<string>>(
    new Set(),
  );
  const [servicesInitialised, setServicesInitialised] = useState(false);

  // Supabase Bot Settings state
  const [businessId, setBusinessId] = useState<string>("");
  const [loadingBotSettings, setLoadingBotSettings] = useState(false);
  const [savingBotSettings, setSavingBotSettings] = useState(false);
  const [botEnabled, setBotEnabled] = useState(true);
  const [autoConfirm, setAutoConfirm] = useState(false);
  const [acceptCancellations, setAcceptCancellations] = useState(true);
  const [sendPaymentLinks, setSendPaymentLinks] = useState(true);
  const [answerFaqs, setAnswerFaqs] = useState(true);
  const [tone, setTone] = useState<BotTone>("friendly");
  const [botName, setBotName] = useState("Qwickly Assistant");
  const [welcomeMessage, setWelcomeMessage] = useState(
    "Good day. How can I help you today?",
  );
  const [fallbackMessage, setFallbackMessage] = useState(
    "I'll connect you with a team member who can help. Please hold.",
  );
  const [reviewMode, setReviewMode] = useState<BotReviewMode>("auto");
  const [ownerReviewAlertsEnabled, setOwnerReviewAlertsEnabled] = useState(true);
  const [ownerAlertPhone, setOwnerAlertPhone] = useState("");
  const [ownerAlertQuietStart, setOwnerAlertQuietStart] = useState("21:00");
  const [ownerAlertQuietEnd, setOwnerAlertQuietEnd] = useState("07:00");
  const [savedBotSettingsSnapshot, setSavedBotSettingsSnapshot] = useState<
    string | null
  >(null);
  const [approvingDraftId, setApprovingDraftId] = useState<string | null>(null);
  const [dismissingDraftId, setDismissingDraftId] = useState<string | null>(null);

  const [showAdvancedBotSettings, setShowAdvancedBotSettings] = useState(false);

  const updateHour = (day: DayKey, patch: Partial<DayHour>) => {
    setWorkingHours((prev) => ({ ...prev, [day]: { ...prev[day], ...patch } }));
  };

  // Fetch real services
  const { data: allServices, isLoading: loadingServices } = useQuery({
    queryKey: catalogKeys.services,
    queryFn: fetchServices,
  });

  const activeServices = useMemo(
    () => (allServices ?? []).filter((s) => s.isActive),
    [allServices],
  );

  // When services first load, default all to allowed
  useEffect(() => {
    if (!servicesInitialised && activeServices.length > 0) {
      setAllowedServiceIds(new Set(activeServices.map((s) => s.id)));
      setServicesInitialised(true);
    }
  }, [activeServices, servicesInitialised]);

  const toggleService = (id: string) => {
    setAllowedServiceIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Fetch Bot Settings on Mount
  useEffect(() => {
    async function loadSettings() {
      try {
        setLoadingBotSettings(true);
        const data = await fetchBotSettings();
        setBusinessId(data.settings.business_id);
        setBotEnabled(data.settings.bot_enabled);
        setAutoConfirm(data.settings.auto_confirm);
        setAcceptCancellations(data.settings.accept_cancellations);
        setSendPaymentLinks(data.settings.send_payment_links);
        setAnswerFaqs(data.settings.answer_faqs);
        setAlwaysOn(data.settings.always_on);
        setTone(data.settings.tone);
        setBotName(data.settings.bot_name);
        setWelcomeMessage(data.settings.welcome_message);
        setFallbackMessage(data.settings.fallback_message);
        setReviewMode(data.settings.review_mode ?? "auto");
        setOwnerReviewAlertsEnabled(data.settings.owner_review_alerts_enabled);
        setOwnerAlertPhone(data.settings.owner_alert_phone);
        setOwnerAlertQuietStart(data.settings.owner_alert_quiet_start);
        setOwnerAlertQuietEnd(data.settings.owner_alert_quiet_end);

        // Populate working hours map
        const hoursMap = { ...DEFAULT_HOURS };
        data.workingHours.forEach((wh) => {
          const key = wh.day_name as DayKey;
          if (hoursMap[key]) {
            hoursMap[key] = {
              isOpen: wh.is_open,
              openTime: wh.open_time,
              closeTime: wh.close_time,
            };
          }
        });
        setWorkingHours(hoursMap);

        // Populate allowed services
        const loadedAllowedServiceIds = new Set(data.allowedServiceIds);
        setAllowedServiceIds(loadedAllowedServiceIds);
        setServicesInitialised(true);
        setSavedBotSettingsSnapshot(
          createBotSettingsSnapshot({
            businessId: data.settings.business_id,
            botEnabled: data.settings.bot_enabled,
            autoConfirm: data.settings.auto_confirm,
            acceptCancellations: data.settings.accept_cancellations,
            sendPaymentLinks: data.settings.send_payment_links,
            answerFaqs: data.settings.answer_faqs,
            alwaysOn: data.settings.always_on,
            tone: data.settings.tone,
            botName: data.settings.bot_name,
            welcomeMessage: data.settings.welcome_message,
            fallbackMessage: data.settings.fallback_message,
            reviewMode: data.settings.review_mode ?? "auto",
            ownerReviewAlertsEnabled: data.settings.owner_review_alerts_enabled,
            ownerAlertPhone: data.settings.owner_alert_phone,
            ownerAlertQuietStart: data.settings.owner_alert_quiet_start,
            ownerAlertQuietEnd: data.settings.owner_alert_quiet_end,
            workingHours: hoursMap,
            allowedServiceIds: loadedAllowedServiceIds,
          }),
        );
      } catch (err) {
        toast({
          title: "Failed to load bot settings",
          description:
            err instanceof Error ? err.message : "Error connecting to database",
          variant: "destructive",
        });
      } finally {
        setLoadingBotSettings(false);
      }
    }
    void loadSettings();
  }, [toast]);

  // Save Bot Settings to Supabase
  const handleSaveBotSettings = async () => {
    try {
      setSavingBotSettings(true);

      const settings: BotSettings = {
        business_id: businessId,
        bot_enabled: botEnabled,
        auto_confirm: autoConfirm,
        accept_cancellations: acceptCancellations,
        send_payment_links: sendPaymentLinks,
        answer_faqs: answerFaqs,
        always_on: alwaysOn,
        tone: tone,
        bot_name: botName,
        welcome_message: welcomeMessage,
        fallback_message: fallbackMessage,
        review_mode: reviewMode,
        owner_review_alerts_enabled: ownerReviewAlertsEnabled,
        owner_alert_phone: ownerAlertPhone,
        owner_alert_quiet_start: ownerAlertQuietStart,
        owner_alert_quiet_end: ownerAlertQuietEnd,
      };

      const hoursList: BotWorkingHour[] = ALL_DAYS.map((day) => ({
        business_id: businessId,
        day_name: day.key,
        is_open: workingHours[day.key].isOpen,
        open_time: workingHours[day.key].openTime,
        close_time: workingHours[day.key].closeTime,
      }));

      const allActiveServiceIds = activeServices.map((s) => s.id);

      await saveBotSettings(
        settings,
        hoursList,
        Array.from(allowedServiceIds),
        allActiveServiceIds,
      );

      setSavedBotSettingsSnapshot(
        createBotSettingsSnapshot({
          businessId,
          botEnabled,
          autoConfirm,
          acceptCancellations,
          sendPaymentLinks,
          answerFaqs,
          alwaysOn,
          tone,
          botName,
          welcomeMessage,
          fallbackMessage,
          reviewMode,
          ownerReviewAlertsEnabled,
          ownerAlertPhone,
          ownerAlertQuietStart,
          ownerAlertQuietEnd,
          workingHours,
          allowedServiceIds,
        }),
      );

      toast({
        title: "Bot settings saved",
        description:
          "Your AI bot configuration has been successfully updated in Supabase.",
      });
    } catch (err) {
      toast({
        title: "Failed to save bot settings",
        description:
          err instanceof Error ? err.message : "Error connecting to database",
        variant: "destructive",
      });
    } finally {
      setSavingBotSettings(false);
    }
  };

  const { data: conversations, isLoading: loadingConversations } =
    useGetWhatsappConversations({
      query: {
        queryKey: getGetWhatsappConversationsQueryKey(),
        refetchInterval: connected ? 10_000 : false,
        initialData: getCachedConversations<WhatsappConversation[]>(),
      },
    });

  const {
    data: aiDrafts = [],
    isLoading: loadingAiDrafts,
  } = useQuery({
    queryKey: ["whatsapp-ai-drafts"],
    queryFn: fetchWhatsappAiDrafts,
    refetchInterval:
      connected && reviewMode === "approval_required" ? 10_000 : false,
  });

  useEffect(() => {
    if (conversations) {
      setCachedConversations(conversations);
    }
  }, [conversations]);
  const selectedConv =
    conversations?.find((conv) => conv.id === selectedConversationId) ?? null;
  const {
    data: messages,
    isLoading: loadingMessages,
    isFetching: fetchingMessages,
  } = useQuery({
    queryKey: ["whatsapp-messages", selectedConv?.id, messageLimit],
    queryFn: () => fetchWhatsappMessages(selectedConv!.id, messageLimit),
    enabled: Boolean(selectedConv),
    refetchInterval: selectedConv && connected ? 7_500 : false,
    initialData: selectedConv
      ? getCachedMessages<WhatsappMessage[]>(selectedConv.id)
      : undefined,
  });

  useEffect(() => {
    if (messages && selectedConv) {
      setCachedMessages(selectedConv.id, messages);
    }
  }, [messages, selectedConv]);
  const sendMessage = useSendWhatsappConversationMessage();
  const markRead = useMarkWhatsappConversationRead();
  const markReadMutate = markRead.mutate;
  const markingRead = markRead.isPending;
  const canLoadMoreMessages = Boolean(
    messages &&
    messages.length >= messageLimit &&
    messageLimit < MAX_MESSAGE_LIMIT,
  );

  const filteredConversations = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return conversations ?? [];

    return (conversations ?? []).filter((conv) =>
      [conv.clientName, conv.clientPhone, conv.lastMessage]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(query)),
    );
  }, [conversations, searchQuery]);

  useEffect(() => {
    if (filteredConversations.length === 0) {
      setSelectedConversationId(null);
      return;
    }

    setSelectedConversationId((current) =>
      current && filteredConversations.some((conv) => conv.id === current)
        ? current
        : filteredConversations[0]!.id,
    );
  }, [filteredConversations]);

  useEffect(() => {
    setReplyText("");
    setMessageLimit(MESSAGE_BATCH_SIZE);
    loadingOlderRef.current = false;
    previousScrollHeightRef.current = 0;
  }, [selectedConversationId]);

  useLayoutEffect(() => {
    const pane = messagePaneRef.current;
    if (!pane || !messages) return;

    if (loadingOlderRef.current) {
      const previousHeight = previousScrollHeightRef.current;
      pane.scrollTop = Math.max(pane.scrollHeight - previousHeight, 0);
      loadingOlderRef.current = false;
      return;
    }

    pane.scrollTop = pane.scrollHeight;
  }, [messages, selectedConversationId]);

  useEffect(() => {
    if (!selectedConv || selectedConv.unreadCount <= 0 || markingRead) {
      return;
    }

    markReadMutate(
      { id: selectedConv.id },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({
            queryKey: getGetWhatsappConversationsQueryKey(),
          });
        },
      },
    );
  }, [markReadMutate, markingRead, queryClient, selectedConv]);

  const handleSendReply = () => {
    const message = replyText.trim();
    if (!selectedConv || !message || sendMessage.isPending) return;

    sendMessage.mutate(
      { id: selectedConv.id, data: { message } },
      {
        onSuccess: () => {
          setReplyText("");
          void queryClient.invalidateQueries({
            queryKey: getGetWhatsappConversationsQueryKey(),
          });
          void queryClient.invalidateQueries({
            queryKey: ["whatsapp-messages", selectedConv.id],
          });
        },
        onError: (error) => {
          toast({
            title: "Could not send message",
            description:
              error instanceof Error
                ? error.message
                : "Please check the WhatsApp connection and try again.",
            variant: "destructive",
          });
        },
      },
    );
  };

  const handleCreateNewChat = async () => {
    const phone = newChatPhone.trim();
    const message = newChatMessage.trim();
    if (!connected || creatingNewChat || !phone || !message) return;

    try {
      setCreatingNewChat(true);
      const session = await supabase.auth.getSession();
      const accessToken = session.data.session?.access_token;
      const response = await fetch(`/api/whatsapp/contacts/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ phone, message }),
      });

      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload?.error || "Failed to send WhatsApp message.");

      setNewChatPhone("");
      setNewChatMessage("");
      setShowNewChatForm(false);
      toast({
        title: "Message sent",
        description: "Your message was delivered or queued for delivery.",
      });
      void queryClient.invalidateQueries({
        queryKey: getGetWhatsappConversationsQueryKey(),
      });
      if (payload?.conversationId) {
        setSelectedConversationId(payload.conversationId);
      }
    } catch (error) {
      toast({
        title: "Could not send message",
        description:
          error instanceof Error
            ? error.message
            : "Please check the WhatsApp connection and try again.",
        variant: "destructive",
      });
    } finally {
      setCreatingNewChat(false);
    }
  };

  const handleApproveDraft = async (draftId: string) => {
    if (approvingDraftId) return;

    try {
      setApprovingDraftId(draftId);
      const session = await supabase.auth.getSession();
      const accessToken = session.data.session?.access_token;
      const response = await fetch(`/api/whatsapp/ai-drafts/${draftId}/approve`, {
        method: "POST",
        headers: {
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "Could not approve draft.");
      }

      toast({
        title: "AI reply sent",
        description: "The approved WhatsApp response has been sent.",
      });
      void queryClient.invalidateQueries({ queryKey: ["whatsapp-ai-drafts"] });
      void queryClient.invalidateQueries({
        queryKey: getGetWhatsappConversationsQueryKey(),
      });
    } catch (error) {
      toast({
        title: "Could not approve draft",
        description:
          error instanceof Error ? error.message : "Please try again shortly.",
        variant: "destructive",
      });
    } finally {
      setApprovingDraftId(null);
    }
  };

  const handleDismissDraft = async (draftId: string) => {
    if (dismissingDraftId) return;

    try {
      setDismissingDraftId(draftId);
      const session = await supabase.auth.getSession();
      const accessToken = session.data.session?.access_token;
      const response = await fetch(`/api/whatsapp/ai-drafts/${draftId}/dismiss`, {
        method: "POST",
        headers: {
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "Could not dismiss draft.");
      }

      toast({
        title: "Draft dismissed",
        description: "The AI response was removed from the approval queue.",
      });
      void queryClient.invalidateQueries({ queryKey: ["whatsapp-ai-drafts"] });
    } catch (error) {
      toast({
        title: "Could not dismiss draft",
        description:
          error instanceof Error ? error.message : "Please try again shortly.",
        variant: "destructive",
      });
    } finally {
      setDismissingDraftId(null);
    }
  };

  const handleCopyDraft = async (reply: string) => {
    try {
      await navigator.clipboard.writeText(reply);
      toast({ title: "Copied", description: "The suggested reply was copied." });
    } catch {
      toast({
        title: "Could not copy",
        description: "Your browser blocked clipboard access.",
        variant: "destructive",
      });
    }
  };

  const handleDisconnectWhatsapp = async () => {
    if (
      !confirm(
        "Disconnect this WhatsApp account from Bookza? New incoming messages will stop syncing until you reconnect.",
      )
    ) {
      return;
    }

    try {
      await disconnect();
      toast({
        title: "WhatsApp disconnected",
        description: "The saved session was cleared. Reconnect with a QR code when you're ready.",
      });
      void queryClient.invalidateQueries({
        queryKey: getGetWhatsappConversationsQueryKey(),
      });
    } catch (error) {
      toast({
        title: "Could not disconnect WhatsApp",
        description: error instanceof Error ? error.message : "Please try again in a moment.",
        variant: "destructive",
      });
    }
  };

  const renderMessageStatus = (status: string) => {
    if (status === "failed") return <AlertCircle className="w-3 h-3" />;
    if (status === "read")
      return <CheckCheck className="w-3 h-3 text-sky-200" />;
    if (status === "delivered") return <CheckCheck className="w-3 h-3" />;
    return <Check className="w-3 h-3" />;
  };

  const loadMoreMessages = () => {
    if (!canLoadMoreMessages || fetchingMessages) return;

    const pane = messagePaneRef.current;
    previousScrollHeightRef.current = pane?.scrollHeight ?? 0;
    loadingOlderRef.current = true;
    setMessageLimit((current) =>
      Math.min(current + MESSAGE_BATCH_SIZE, MAX_MESSAGE_LIMIT),
    );
  };

  const selectedServicesCount = activeServices.filter((service) =>
    allowedServiceIds.has(service.id),
  ).length;
  const totalServicesCount = activeServices.length;
  const currentBotSettingsSnapshot = useMemo(
    () =>
      createBotSettingsSnapshot({
        businessId,
        botEnabled,
        autoConfirm,
        acceptCancellations,
        sendPaymentLinks,
        answerFaqs,
        alwaysOn,
        tone,
        botName,
        welcomeMessage,
        fallbackMessage,
        reviewMode,
        ownerReviewAlertsEnabled,
        ownerAlertPhone,
        ownerAlertQuietStart,
        ownerAlertQuietEnd,
        workingHours,
        allowedServiceIds,
      }),
    [
      acceptCancellations,
      allowedServiceIds,
      alwaysOn,
      answerFaqs,
      autoConfirm,
      botEnabled,
      botName,
      businessId,
      fallbackMessage,
      reviewMode,
      ownerReviewAlertsEnabled,
      ownerAlertPhone,
      ownerAlertQuietStart,
      ownerAlertQuietEnd,
      sendPaymentLinks,
      tone,
      welcomeMessage,
      workingHours,
    ],
  );
  const hasUnsavedBotSettings =
    Boolean(savedBotSettingsSnapshot) &&
    currentBotSettingsSnapshot !== savedBotSettingsSnapshot;
  const saveBotSettingsButton = hasUnsavedBotSettings ? (
    <Button
      size="sm"
      className="h-8 rounded-full px-3 shadow-sm"
      onClick={handleSaveBotSettings}
      disabled={savingBotSettings}
    >
      {savingBotSettings ? (
        <>
          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
          Saving...
        </>
      ) : (
        "Save changes"
      )}
    </Button>
  ) : null;

  return (
    <div className="space-y-6 h-full flex flex-col">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 shrink-0">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            WhatsApp Hub
          </h1>
          <p className="text-muted-foreground text-sm">
            Manage messages and the AI assistant.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium",
              connected
                ? "bg-emerald-50 border-emerald-100 text-emerald-800 dark:bg-emerald-950/30 dark:border-emerald-900/50 dark:text-emerald-400"
                : connection.status === "qrcode"
                  ? "bg-amber-50 border-amber-100 text-amber-800 dark:bg-amber-950/30 dark:border-amber-900/50 dark:text-amber-400"
                  : "bg-slate-50 border-slate-200 text-slate-700 dark:bg-slate-950/30 dark:border-slate-800 dark:text-slate-300",
            )}
          >
            <div
              className={cn(
                "w-2 h-2 rounded-full",
                connected
                  ? "bg-emerald-500 animate-pulse"
                  : connection.status === "qrcode"
                    ? "bg-amber-500 animate-pulse"
                    : "bg-slate-400",
              )}
            />
            {loadingConnection
              ? "Checking connection..."
              : connected
                ? "WhatsApp Connected"
                : connection.status === "qrcode"
                  ? "QR Code Ready"
                  : "WhatsApp Not Connected"}
          </div>
          {connected && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  disabled={disconnecting}
                >
                  {disconnecting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <MoreHorizontal className="h-4 w-4" />
                  )}
                  <span className="sr-only">WhatsApp actions</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={handleDisconnectWhatsapp}
                  disabled={disconnecting}
                >
                  <Unplug className="h-4 w-4" />
                  Disconnect WhatsApp
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {!loadingConnection && !connected && <WhatsappConnectionManager />}
      {/*

          { label: "AI Success Rate", value: `${stats?.successRate ?? "—"}%`, icon: CheckCircle2, color: "bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-400" },
      */}
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="flex-1 flex flex-col min-h-0"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <TabsList className="bg-card w-full sm:w-auto self-start shadow-sm border border-border/50">
            <TabsTrigger value="conversations" className="gap-2">
              <MessageSquare className="w-4 h-4" /> Conversations
            </TabsTrigger>
            <TabsTrigger value="bot-type" className="gap-2">
              <Bot className="w-4 h-4" /> AI Bot Type
            </TabsTrigger>
            <TabsTrigger value="bot-settings" className="gap-2">
              <Settings2 className="w-4 h-4" /> AI Bot Settings
            </TabsTrigger>
          </TabsList>
          {saveBotSettingsButton}
        </div>

        <div className="mt-4 flex-1 min-h-0">
          {/* Conversations */}
          <TabsContent
            value="conversations"
            className="m-0 h-[580px] flex gap-4"
          >
            <Card className="w-full sm:w-80 flex flex-col border-border/50 shadow-sm overflow-hidden h-full">
              <div className="p-4 border-b bg-card">
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search chats…"
                    className="pl-9 bg-background"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                  />
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {connected
                    ? "Showing live WhatsApp conversations for this connected account. Broadcast status updates are hidden."
                    : "Connect WhatsApp to load conversations for this account."}
                </p>
                {connected && (
                  <div className="mt-3 flex flex-col gap-2">
                    <Button
                      size="xs"
                      variant="secondary"
                      type="button"
                      onClick={() => setShowNewChatForm((current) => !current)}
                    >
                      {showNewChatForm ? "Hide new chat" : "Start new chat"}
                    </Button>
                    {showNewChatForm ? (
                      <div className="space-y-3 rounded-lg border border-border/70 bg-background p-3">
                        <div>
                          <Label
                            htmlFor="new-chat-phone"
                            className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                          >
                            Phone number
                          </Label>
                          <Input
                            id="new-chat-phone"
                            placeholder="+2783 123 4567"
                            value={newChatPhone}
                            onChange={(event) =>
                              setNewChatPhone(event.target.value)
                            }
                          />
                        </div>
                        <div>
                          <Label
                            htmlFor="new-chat-message"
                            className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                          >
                            Message
                          </Label>
                          <Textarea
                            id="new-chat-message"
                            placeholder="Type your message here..."
                            value={newChatMessage}
                            onChange={(event) =>
                              setNewChatMessage(event.target.value)
                            }
                            className="min-h-[96px]"
                          />
                        </div>
                        <Button
                          size="sm"
                          className="w-full"
                          disabled={
                            !newChatPhone.trim() ||
                            !newChatMessage.trim() ||
                            creatingNewChat
                          }
                          onClick={handleCreateNewChat}
                        >
                          {creatingNewChat ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            "Send new chat"
                          )}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
              <div className="flex-1 overflow-y-auto bg-card">
                {loadingConversations ? (
                  <div className="flex items-center justify-center h-32">
                    <Loader2 className="w-6 h-6 animate-spin text-primary" />
                  </div>
                ) : filteredConversations.length > 0 ? (
                  filteredConversations.map((conv) => (
                    <div
                      key={conv.id}
                      onClick={() => setSelectedConversationId(conv.id)}
                      className={cn(
                        "flex items-center gap-3 p-4 border-b cursor-pointer hover:bg-muted/50 transition-colors",
                        selectedConv?.id === conv.id &&
                          "bg-primary/5 border-l-2 border-l-primary",
                      )}
                    >
                      <Avatar className="w-10 h-10 border border-border">
                        <AvatarImage src={conv.avatarUrl || undefined} />
                        <AvatarFallback className="bg-primary/10 text-primary font-medium">
                          {conv.clientName.substring(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-baseline mb-0.5">
                          <h4 className="font-semibold text-sm truncate">
                            {conv.clientName}
                          </h4>
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            {format(new Date(conv.lastMessageAt), "HH:mm")}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          {conv.isBot && (
                            <Bot className="w-3 h-3 text-primary shrink-0" />
                          )}
                          <p
                            className={cn(
                              "text-xs truncate",
                              conv.unreadCount > 0
                                ? "font-medium text-foreground"
                                : "text-muted-foreground",
                            )}
                          >
                            {conv.lastMessage}
                          </p>
                        </div>
                      </div>
                      {conv.unreadCount > 0 && (
                        <Badge className="bg-primary hover:bg-primary rounded-full px-1.5 py-0 min-w-[20px] h-5 flex items-center justify-center shrink-0">
                          {conv.unreadCount}
                        </Badge>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="flex h-full min-h-32 items-center justify-center p-6 text-center text-sm text-muted-foreground">
                    {connected
                      ? "No received WhatsApp conversations were found for this account yet."
                      : "Connect WhatsApp to start seeing conversations here."}
                  </div>
                )}
              </div>
            </Card>

            <Card className="hidden sm:flex flex-1 flex-col border-border/50 shadow-sm overflow-hidden h-full bg-card/50">
              {selectedConv ? (
                <>
                  <div className="p-4 border-b bg-card flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Avatar className="w-10 h-10 border border-border">
                        <AvatarFallback className="bg-primary/10 text-primary font-semibold">
                          {selectedConv.clientName
                            .substring(0, 2)
                            .toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <h3 className="font-semibold">
                          {selectedConv.clientName}
                        </h3>
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          {selectedConv.isBot ? (
                            <>
                              <Bot className="w-3 h-3" /> AI bot active
                            </>
                          ) : selectedConv.unreadCount > 0 ? (
                            `${selectedConv.unreadCount} unread`
                          ) : (
                            "Read"
                          )}
                        </p>
                      </div>
                    </div>
                    <Button size="sm" variant="outline">
                      View Client
                    </Button>
                  </div>

                  <div
                    ref={messagePaneRef}
                    className="flex-1 overflow-y-auto p-4 space-y-3 bg-muted/20"
                    onScroll={(event) => {
                      if (event.currentTarget.scrollTop <= 8) {
                        loadMoreMessages();
                      }
                    }}
                  >
                    {loadingMessages ? (
                      <div className="flex items-center justify-center h-32">
                        <Loader2 className="w-6 h-6 animate-spin text-primary" />
                      </div>
                    ) : (messages?.length ?? 0) > 0 ? (
                      <>
                        {canLoadMoreMessages && (
                          <div className="flex justify-center pb-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-8 text-xs"
                              disabled={fetchingMessages}
                              onClick={loadMoreMessages}
                            >
                              {fetchingMessages ? (
                                <Loader2 className="w-3 h-3 mr-2 animate-spin" />
                              ) : null}
                              Load more
                            </Button>
                          </div>
                        )}
                        {messages!.map((message) => {
                          const inbound = message.direction === "inbound";
                          return (
                            <div
                              key={`${message.direction}-${message.timestamp}-${message.id}`}
                              className={cn(
                                "flex",
                                inbound ? "justify-start" : "justify-end",
                              )}
                            >
                              {inbound && (
                                <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center mr-2 shrink-0 self-end">
                                  <MessageSquare className="w-4 h-4 text-primary" />
                                </div>
                              )}
                              <div
                                className={cn(
                                  "max-w-[70%] px-3 py-2 rounded-xl text-sm",
                                  inbound
                                    ? "bg-card border border-border/50 rounded-bl-sm"
                                    : "bg-primary text-primary-foreground rounded-br-sm",
                                )}
                              >
                                <p>{message.content}</p>
                                <p
                                  className={cn(
                                    "text-xs mt-1 flex items-center gap-1",
                                    inbound
                                      ? "text-muted-foreground"
                                      : "text-primary-foreground/70 justify-end",
                                  )}
                                >
                                  <span>
                                    {format(
                                      new Date(message.timestamp),
                                      "MMM d, HH:mm",
                                    )}
                                  </span>
                                  {!inbound &&
                                    renderMessageStatus(message.status)}
                                </p>
                              </div>
                            </div>
                          );
                        })}
                      </>
                    ) : (
                      <div className="flex h-full min-h-32 items-center justify-center text-center text-sm text-muted-foreground">
                        No messages were found in this conversation yet.
                      </div>
                    )}
                  </div>

                  <div className="p-4 border-t bg-card">
                    <div className="flex items-end gap-2">
                      <Textarea
                        placeholder={
                          connected
                            ? "Reply to this conversation..."
                            : "Connect WhatsApp before replying."
                        }
                        className="bg-background min-h-[44px] max-h-32 resize-none"
                        value={replyText}
                        disabled={!connected || sendMessage.isPending}
                        onChange={(event) => setReplyText(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" && !event.shiftKey) {
                            event.preventDefault();
                            handleSendReply();
                          }
                        }}
                      />
                      <Button
                        size="icon"
                        className="shrink-0 h-11 w-11"
                        disabled={
                          !connected ||
                          !replyText.trim() ||
                          sendMessage.isPending
                        }
                        onClick={handleSendReply}
                      >
                        {sendMessage.isPending ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Send className="w-4 h-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="p-4 border-b bg-card flex items-center gap-3">
                    <Avatar className="w-10 h-10 border border-border">
                      <AvatarFallback className="bg-muted">
                        <UserCircle2 className="w-6 h-6 text-muted-foreground" />
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <h3 className="font-semibold">Select a conversation</h3>
                      <p className="text-xs text-muted-foreground">
                        View message history and reply
                      </p>
                    </div>
                  </div>
                  <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-8 text-center">
                    <MessageSquare className="w-12 h-12 mb-4 opacity-20" />
                    <p className="text-sm">
                      Select a conversation from the sidebar to view the chat
                      history or send a message.
                    </p>
                  </div>
                </>
              )}
            </Card>
          </TabsContent>

          {/* Bot Type */}
          <TabsContent value="bot-type" className="m-0 space-y-6">
            {loadingBotSettings ? (
              <div className="flex flex-col items-center justify-center py-20 gap-4">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground animate-pulse">
                  Loading bot settings...
                </p>
              </div>
            ) : (
              <>
                <div className="space-y-6">
                  <Card className="shadow-sm border-border/50">
                    <CardHeader>
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-primary/10 rounded-lg">
                            <Bot className="w-5 h-5 text-primary" />
                          </div>
                          <div>
                            <CardTitle>AI Booking Assistant</CardTitle>
                            <CardDescription>
                              Let the assistant answer WhatsApp messages, handle
                              bookings, and guide clients automatically.
                            </CardDescription>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <Badge
                            className={cn(
                              "border",
                              botEnabled
                                ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                                : "bg-slate-100 text-slate-700 border-slate-200",
                            )}
                          >
                            {botEnabled ? "Active" : "Paused"}
                          </Badge>
                          <Switch
                            checked={botEnabled}
                            onCheckedChange={setBotEnabled}
                          />
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground">
                        {botEnabled
                          ? "The assistant can respond to clients automatically."
                          : "The assistant is paused. Clients will not receive automated replies."}
                      </p>
                    </CardContent>
                  </Card>

                      <Card className="shadow-sm border-border/50">
                        <CardHeader>
                          <CardTitle>AI Bot Type</CardTitle>
                          <CardDescription>
                            Choose how the assistant sends WhatsApp replies.
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="grid gap-3 md:grid-cols-2">
                          <button
                            type="button"
                            onClick={() => setReviewMode("auto")}
                            className={cn(
                              "rounded-lg border p-4 text-left transition-colors hover:border-primary/50",
                              reviewMode === "auto"
                                ? "border-primary bg-primary/5"
                                : "border-border bg-background",
                            )}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="font-medium">Auto Assistant</p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  Replies and booking actions happen
                                  automatically.
                                </p>
                              </div>
                              {reviewMode === "auto" ? (
                                <Check className="h-4 w-4 text-primary" />
                              ) : null}
                            </div>
                          </button>
                          <button
                            type="button"
                            onClick={() => setReviewMode("approval_required")}
                            className={cn(
                              "rounded-lg border p-4 text-left transition-colors hover:border-primary/50",
                              reviewMode === "approval_required"
                                ? "border-primary bg-primary/5"
                                : "border-border bg-background",
                            )}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="font-medium">2 Step Assistant</p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  AI drafts wait for staff approval before
                                  sending or changing bookings.
                                </p>
                              </div>
                              {reviewMode === "approval_required" ? (
                                <Check className="h-4 w-4 text-primary" />
                              ) : null}
                            </div>
                          </button>
                        </CardContent>
                      </Card>

                      {reviewMode === "approval_required" ? (
                  <Card className="shadow-sm border-border/50">
                    <CardHeader>
                      <CardTitle>Owner approval alerts</CardTitle>
                      <CardDescription>
                        Get a WhatsApp message from Qwickly when a reply is
                        waiting, so you don't have to watch this page. We batch
                        and rate-limit these so you're never spammed.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex items-center justify-between gap-3">
                        <Label htmlFor="owner-alert-toggle" className="text-sm font-medium">
                          Notify me on WhatsApp
                        </Label>
                        <Switch
                          id="owner-alert-toggle"
                          checked={ownerReviewAlertsEnabled}
                          onCheckedChange={setOwnerReviewAlertsEnabled}
                        />
                      </div>

                      {ownerReviewAlertsEnabled ? (
                        <div className="space-y-4">
                          <div className="space-y-1.5">
                            <Label
                              htmlFor="owner-alert-phone"
                              className="text-xs uppercase text-muted-foreground"
                            >
                              Alert number (optional)
                            </Label>
                            <Input
                              id="owner-alert-phone"
                              type="tel"
                              placeholder="Defaults to your connected WhatsApp number"
                              value={ownerAlertPhone}
                              onChange={(e) => setOwnerAlertPhone(e.target.value)}
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                              <Label
                                htmlFor="owner-alert-quiet-start"
                                className="text-xs uppercase text-muted-foreground"
                              >
                                Quiet hours from
                              </Label>
                              <Input
                                id="owner-alert-quiet-start"
                                type="time"
                                value={ownerAlertQuietStart}
                                onChange={(e) => setOwnerAlertQuietStart(e.target.value)}
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label
                                htmlFor="owner-alert-quiet-end"
                                className="text-xs uppercase text-muted-foreground"
                              >
                                Quiet hours to
                              </Label>
                              <Input
                                id="owner-alert-quiet-end"
                                type="time"
                                value={ownerAlertQuietEnd}
                                onChange={(e) => setOwnerAlertQuietEnd(e.target.value)}
                              />
                            </div>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Alerts inside your quiet hours are held and sent
                            afterwards, never dropped.
                          </p>
                        </div>
                      ) : null}
                    </CardContent>
                  </Card>
                      ) : null}

                      {reviewMode === "approval_required" ? (
                  <Card className="shadow-sm border-border/50">
                    <CardHeader>
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <CardTitle>Pending AI replies</CardTitle>
                          <CardDescription>
                            Review customer messages and approve the AI response
                            when it looks right.
                          </CardDescription>
                        </div>
                        <Badge variant="secondary">
                          {aiDrafts.length} pending
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {loadingAiDrafts ? (
                        <div className="flex h-24 items-center justify-center">
                          <Loader2 className="h-5 w-5 animate-spin text-primary" />
                        </div>
                      ) : aiDrafts.length === 0 ? (
                        <div className="rounded-lg border border-dashed p-6 text-center">
                          <p className="text-sm font-medium">
                            No AI replies waiting
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            New drafts will appear here when approval is
                            enabled.
                          </p>
                        </div>
                      ) : (
                        aiDrafts.map((draft) => (
                          <div
                            key={draft.id}
                            className="space-y-3 rounded-lg border bg-muted/20 p-4"
                          >
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                              <div>
                                <p className="text-sm font-medium">
                                  {draft.clientName || draft.clientPhone || "WhatsApp customer"}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {format(new Date(draft.createdAt), "d MMM yyyy, HH:mm")}
                                </p>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {draft.proposedActions.map((action, index) => (
                                  <Badge key={index} variant="outline">
                                    {String(action.type ?? "Action")}
                                  </Badge>
                                ))}
                              </div>
                            </div>

                            <div className="grid gap-3 lg:grid-cols-2">
                              <div className="space-y-1">
                                <Label className="text-xs uppercase text-muted-foreground">
                                  Customer
                                </Label>
                                <p className="whitespace-pre-wrap rounded-md bg-background p-3 text-sm leading-relaxed">
                                  {draft.inboundMessageText}
                                </p>
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs uppercase text-muted-foreground">
                                  AI reply
                                </Label>
                                <p className="whitespace-pre-wrap rounded-md bg-background p-3 text-sm leading-relaxed">
                                  {draft.suggestedReply}
                                </p>
                              </div>
                            </div>

                            <div className="flex flex-wrap justify-end gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => handleCopyDraft(draft.suggestedReply)}
                              >
                                <Copy className="mr-2 h-4 w-4" />
                                Copy
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => handleDismissDraft(draft.id)}
                                disabled={Boolean(dismissingDraftId || approvingDraftId)}
                              >
                                {dismissingDraftId === draft.id ? (
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                ) : (
                                  <X className="mr-2 h-4 w-4" />
                                )}
                                Dismiss
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                onClick={() => handleApproveDraft(draft.id)}
                                disabled={Boolean(approvingDraftId || dismissingDraftId)}
                              >
                                {approvingDraftId === draft.id ? (
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                ) : (
                                  <Check className="mr-2 h-4 w-4" />
                                )}
                                Approve and send
                              </Button>
                            </div>
                          </div>
                        ))
                      )}
                    </CardContent>
                  </Card>
                      ) : null}
                </div>
              </>
            )}
          </TabsContent>

          {/* Bot Settings */}
          <TabsContent value="bot-settings" className="m-0 space-y-6">
            {loadingBotSettings ? (
              <div className="flex flex-col items-center justify-center py-20 gap-4">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground animate-pulse">
                  Loading bot settings...
                </p>
              </div>
            ) : (
              <>
                <div className="space-y-6">
                  <Card className="shadow-sm border-border/50">
                    <CardHeader>
                      <CardTitle>What should the bot handle?</CardTitle>
                      <CardDescription>
                        Choose which client requests the assistant can manage
                        without staff help.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {[
                        {
                          label: "Auto-confirm bookings",
                          desc: "Confirm bookings when a matching time is available.",
                          checked: autoConfirm,
                          onChange: setAutoConfirm,
                        },
                        {
                          label: "Handle cancellations",
                          desc: "Let clients cancel appointments in WhatsApp.",
                          checked: acceptCancellations,
                          onChange: setAcceptCancellations,
                        },
                        {
                          label: "Send payment links",
                          desc: "Share payment links when a booking needs a deposit.",
                          checked: sendPaymentLinks,
                          onChange: setSendPaymentLinks,
                        },
                        {
                          label: "Answer FAQs",
                          desc: "Reply to common questions about services, prices, and policies.",
                          checked: answerFaqs,
                          onChange: setAnswerFaqs,
                        },
                      ].map((item) => (
                        <div
                          key={item.label}
                          className="flex items-center justify-between gap-4"
                        >
                          <div>
                            <Label className="font-medium text-sm">
                              {item.label}
                            </Label>
                            <p className="text-xs text-muted-foreground">
                              {item.desc}
                            </p>
                          </div>
                          <Switch
                            checked={item.checked}
                            onCheckedChange={item.onChange}
                          />
                        </div>
                      ))}
                    </CardContent>
                  </Card>

                  <Card className="shadow-sm border-border/50">
                    <CardHeader>
                      <CardTitle>When should the bot reply?</CardTitle>
                      <CardDescription>
                        Use this if the bot should only reply during your
                        business hours.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex items-center justify-between p-3 border rounded-lg bg-muted/30">
                        <div>
                          <Label className="font-medium">
                            24/7 mode (always on)
                          </Label>
                          <p className="text-xs text-muted-foreground">
                            Bot replies around the clock regardless of hours.
                          </p>
                        </div>
                        <Switch
                          checked={alwaysOn}
                          onCheckedChange={setAlwaysOn}
                        />
                      </div>
                      <div
                        className={cn(
                          "space-y-2 transition-opacity",
                          alwaysOn && "opacity-50 pointer-events-none",
                        )}
                      >
                        {ALL_DAYS.map((day) => {
                          const hour = workingHours[day.key];
                          return (
                            <div
                              key={day.key}
                              className="grid grid-cols-[auto_6rem_1fr] items-center gap-3 py-2 border-b last:border-0"
                            >
                              <Switch
                                checked={hour.isOpen}
                                onCheckedChange={(v) =>
                                  updateHour(day.key, { isOpen: v })
                                }
                              />
                              <Label className="w-24 shrink-0 font-medium">
                                {day.label}
                              </Label>
                              {hour.isOpen ? (
                                <div className="flex items-center gap-2 min-w-0">
                                  <Input
                                    type="time"
                                    value={hour.openTime}
                                    onChange={(e) =>
                                      updateHour(day.key, {
                                        openTime: e.target.value,
                                      })
                                    }
                                    className="w-32 bg-muted/50 text-center [&::-webkit-calendar-picker-indicator]:hidden"
                                  />
                                  <span className="text-muted-foreground text-sm">
                                    –
                                  </span>
                                  <Input
                                    type="time"
                                    value={hour.closeTime}
                                    onChange={(e) =>
                                      updateHour(day.key, {
                                        closeTime: e.target.value,
                                      })
                                    }
                                    className="w-32 bg-muted/50 text-center [&::-webkit-calendar-picker-indicator]:hidden"
                                  />
                                </div>
                              ) : (
                                <span className="text-sm text-muted-foreground italic">
                                  Closed
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="shadow-sm border-border/50">
                    <CardHeader>
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <CardTitle>Services the bot can book</CardTitle>
                          <CardDescription>
                            The assistant can only book enabled services.
                          </CardDescription>
                        </div>
                        <Badge variant="secondary">
                          {selectedServicesCount} of {totalServicesCount}{" "}
                          services enabled
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {loadingServices ? (
                        <div className="flex items-center justify-center h-24">
                          <Loader2 className="w-5 h-5 animate-spin text-primary" />
                        </div>
                      ) : activeServices.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-8 text-center gap-3">
                          <div className="w-10 h-10 bg-muted rounded-full flex items-center justify-center">
                            <Scissors className="w-5 h-5 text-muted-foreground" />
                          </div>
                          <div>
                            <p className="text-sm font-medium">
                              No services found
                            </p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              Add services on the Services page first.
                            </p>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center justify-between gap-4 p-3 border rounded-lg bg-muted/30">
                            <div>
                              <Label className="font-medium text-sm">
                                Enable all services
                              </Label>
                              <p className="text-xs text-muted-foreground">
                                Allow the assistant to book every active
                                service.
                              </p>
                            </div>
                            <Switch
                              checked={
                                totalServicesCount > 0 &&
                                selectedServicesCount === totalServicesCount
                              }
                              onCheckedChange={(checked) =>
                                setAllowedServiceIds(
                                  checked
                                    ? new Set(activeServices.map((s) => s.id))
                                    : new Set(),
                                )
                              }
                            />
                          </div>
                          {activeServices.map((s) => (
                            <div
                              key={s.id}
                              className="flex items-center justify-between p-3 border rounded-lg hover:border-primary/30 transition-colors"
                            >
                              <div>
                                <Label className="font-medium text-sm cursor-pointer">
                                  {s.name}
                                </Label>
                                {s.duration ? (
                                  <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                                    <Clock className="w-3 h-3" />
                                    {s.duration} min · R{" "}
                                    {s.price.toLocaleString()}
                                  </p>
                                ) : null}
                              </div>
                              <Switch
                                checked={allowedServiceIds.has(s.id)}
                                onCheckedChange={() => toggleService(s.id)}
                              />
                            </div>
                          ))}
                        </>
                      )}
                    </CardContent>
                  </Card>

                  <Card className="shadow-sm border-border/50">
                    <CardHeader>
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <CardTitle>Advanced settings</CardTitle>
                          <CardDescription>
                            Fine-tune the assistant identity and client-facing
                            messages.
                          </CardDescription>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() =>
                            setShowAdvancedBotSettings((current) => !current)
                          }
                        >
                          {showAdvancedBotSettings
                            ? "Hide advanced settings"
                            : "Show advanced settings"}
                        </Button>
                      </div>
                    </CardHeader>
                    {showAdvancedBotSettings ? (
                      <CardContent className="space-y-4">
                        <div className="space-y-2">
                          <Label>Communication style</Label>
                          <Select
                            value={tone}
                            onValueChange={(v) => setTone(v as BotTone)}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="friendly">
                                Friendly and approachable
                              </SelectItem>
                              <SelectItem value="professional">
                                Professional and formal
                              </SelectItem>
                              <SelectItem value="casual">
                                Casual and relaxed
                              </SelectItem>
                              <SelectItem value="concise">
                                Brief and direct
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>Assistant name</Label>
                          <Input
                            value={botName}
                            onChange={(e) => setBotName(e.target.value)}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Opening message</Label>
                          <Input
                            value={welcomeMessage}
                            onChange={(e) => setWelcomeMessage(e.target.value)}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Handoff message</Label>
                          <Input
                            value={fallbackMessage}
                            onChange={(e) => setFallbackMessage(e.target.value)}
                          />
                        </div>
                      </CardContent>
                    ) : null}
                  </Card>
                </div>

              </>
            )}
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
