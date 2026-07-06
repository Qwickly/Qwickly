import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  getGetWhatsappConversationsQueryKey,
  buildApiUrl,
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
  Lock,
  ArrowRight,
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
  fetchBotFaqs,
  saveBotFaqs,
  FAQ_QUESTION_MAX,
  FAQ_ANSWER_MAX,
  FAQ_COUNT_MAX,
  type BotTone,
  type BotSettings,
  type BotWorkingHour,
  type BotReviewMode,
  type BotFaq,
} from "@/lib/bot-settings";
import { fetchSubscription } from "@/lib/catalog-subscriptions";

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
  cancellationMinNoticeHours: number;
  cancellationDeclineMessage: string;
  acceptReschedules: boolean;
  rescheduleMinNoticeHours: number;
  rescheduleDeclineMessage: string;
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
    cancellationMinNoticeHours: input.cancellationMinNoticeHours,
    cancellationDeclineMessage: input.cancellationDeclineMessage,
    acceptReschedules: input.acceptReschedules,
    rescheduleMinNoticeHours: input.rescheduleMinNoticeHours,
    rescheduleDeclineMessage: input.rescheduleDeclineMessage,
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
    buildApiUrl(`/api/whatsapp/conversations/${conversationId}/messages?limit=${limit}`),
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
  const response = await fetch(buildApiUrl("/api/whatsapp/ai-drafts?limit=25"), {
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
  const { data: subscription, isLoading: loadingSubscription } = useQuery({
    queryKey: ["subscription"],
    queryFn: fetchSubscription,
  });

  // Check if WhatsApp is enabled in subscription
  const whatsappEnabled = Boolean(
    (subscription as any)?.metadata?.whatsappEnabled ||
    (subscription as any)?.plans?.metadata?.whatsappEnabled,
  );

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("conversations");
  const [selectedConversationId, setSelectedConversationId] = useState<
    number | null
  >(null);
  // Mobile split-view: 'list' shows conversation list, 'chat' shows active chat
  const [mobileView, setMobileView] = useState<'list' | 'chat'>('list');
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
  const [cancellationMinNoticeHours, setCancellationMinNoticeHours] = useState(24);
  const [cancellationDeclineMessage, setCancellationDeclineMessage] = useState("");
  const [acceptReschedules, setAcceptReschedules] = useState(true);
  const [rescheduleMinNoticeHours, setRescheduleMinNoticeHours] = useState(24);
  const [rescheduleDeclineMessage, setRescheduleDeclineMessage] = useState("");
  const [sendPaymentLinks, setSendPaymentLinks] = useState(true);
  const [answerFaqs, setAnswerFaqs] = useState(true);
  const [faqs, setFaqs] = useState<BotFaq[]>([]);
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
        setCancellationMinNoticeHours(data.settings.cancellation_min_notice_hours);
        setCancellationDeclineMessage(data.settings.cancellation_decline_message);
        setAcceptReschedules(data.settings.accept_reschedules);
        setRescheduleMinNoticeHours(data.settings.reschedule_min_notice_hours);
        setRescheduleDeclineMessage(data.settings.reschedule_decline_message);
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

        // Populate knowledge base (FAQs) — persisted independently of the
        // settings snapshot via its own save button.
        try {
          setFaqs(await fetchBotFaqs());
        } catch {
          // Non-fatal: the rest of the bot settings still load.
        }
        setSavedBotSettingsSnapshot(
          createBotSettingsSnapshot({
            businessId: data.settings.business_id,
            botEnabled: data.settings.bot_enabled,
            autoConfirm: data.settings.auto_confirm,
            acceptCancellations: data.settings.accept_cancellations,
            cancellationMinNoticeHours: data.settings.cancellation_min_notice_hours,
            cancellationDeclineMessage: data.settings.cancellation_decline_message,
            acceptReschedules: data.settings.accept_reschedules,
            rescheduleMinNoticeHours: data.settings.reschedule_min_notice_hours,
            rescheduleDeclineMessage: data.settings.reschedule_decline_message,
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

  // ── Knowledge base (FAQ) editing ──────────────────────────────────────────
  const [savingFaqs, setSavingFaqs] = useState(false);

  const addFaq = () =>
    setFaqs((prev) =>
      prev.length >= FAQ_COUNT_MAX
        ? prev
        : [...prev, { id: `new-${Date.now()}`, question: "", answer: "", enabled: true }],
    );

  const updateFaq = (id: string, patch: Partial<BotFaq>) =>
    setFaqs((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));

  const removeFaq = (id: string) =>
    setFaqs((prev) => prev.filter((f) => f.id !== id));

  const handleSaveFaqs = async () => {
    try {
      setSavingFaqs(true);
      await saveBotFaqs(faqs);
      setFaqs(await fetchBotFaqs());
      toast({ title: "Knowledge base saved" });
    } catch (err) {
      toast({
        title: "Could not save knowledge base",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSavingFaqs(false);
    }
  };

  // Save Bot Settings to Supabase
  const handleSaveBotSettings = async () => {
    try {
      setSavingBotSettings(true);

      const settings: BotSettings = {
        business_id: businessId,
        bot_enabled: botEnabled,
        auto_confirm: autoConfirm,
        accept_cancellations: acceptCancellations,
        cancellation_min_notice_hours: cancellationMinNoticeHours,
        cancellation_decline_message: cancellationDeclineMessage,
        accept_reschedules: acceptReschedules,
        reschedule_min_notice_hours: rescheduleMinNoticeHours,
        reschedule_decline_message: rescheduleDeclineMessage,
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
          cancellationMinNoticeHours,
          cancellationDeclineMessage,
          acceptReschedules,
          rescheduleMinNoticeHours,
          rescheduleDeclineMessage,
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
    if (Array.isArray(conversations)) {
      setCachedConversations(conversations);
    }
  }, [conversations]);
  const selectedConv =
    Array.isArray(conversations)
      ? conversations.find((conv) => conv.id === selectedConversationId) ?? null
      : null;
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
    const list = Array.isArray(conversations) ? conversations : [];
    if (!query) return list;

    return list.filter((conv) =>
      [conv.clientName, conv.clientPhone, conv.lastMessage]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(query)),
    );
  }, [conversations, searchQuery]);

  useEffect(() => {
    if (filteredConversations.length === 0) {
      setSelectedConversationId(null);
      setMobileView('list');
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
      const response = await fetch(buildApiUrl(`/api/whatsapp/contacts/messages`), {
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
      const response = await fetch(buildApiUrl(`/api/whatsapp/ai-drafts/${draftId}/approve`), {
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
      const response = await fetch(buildApiUrl(`/api/whatsapp/ai-drafts/${draftId}/dismiss`), {
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
        cancellationMinNoticeHours,
        cancellationDeclineMessage,
        acceptReschedules,
        rescheduleMinNoticeHours,
        rescheduleDeclineMessage,
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
      cancellationMinNoticeHours,
      cancellationDeclineMessage,
      acceptReschedules,
      rescheduleMinNoticeHours,
      rescheduleDeclineMessage,
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

  // Show lock screen if WhatsApp is not enabled
  if (loadingSubscription) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-8rem)]">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!whatsappEnabled) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-8rem)]">
        <Card className="max-w-md p-8 text-center border-border/50">
          <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-4">
            <Lock className="w-8 h-8 text-amber-600" />
          </div>
          <h2 className="text-2xl font-bold mb-2">WhatsApp Locked</h2>
          <p className="text-muted-foreground mb-6">
            WhatsApp automation and inbox is not included in your current plan. Upgrade to access automated confirmations, reminders, and client messaging.
          </p>
          <Button className="w-full" asChild>
            <a href="/billing">
              Upgrade Plan <ArrowRight className="w-4 h-4 ml-2" />
            </a>
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 h-full flex flex-col">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 shrink-0">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-200/50 dark:shadow-emerald-900/50">
              <MessageSquare className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
              WhatsApp Hub
            </h1>
          </div>
          <p className="text-muted-foreground text-sm ml-13">
            Manage messages and the AI assistant.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div
            className={cn(
              "flex items-center gap-2.5 px-4 py-2 rounded-2xl border text-xs sm:text-sm font-medium shadow-sm transition-all duration-200",
              connected
                ? "bg-gradient-to-r from-emerald-50 to-emerald-100 border-emerald-200 text-emerald-800 dark:from-emerald-950/40 dark:to-emerald-900/40 dark:border-emerald-800 dark:text-emerald-400"
                : connection.status === "qrcode"
                  ? "bg-gradient-to-r from-amber-50 to-amber-100 border-amber-200 text-amber-800 dark:from-amber-950/40 dark:to-amber-900/40 dark:border-amber-800 dark:text-amber-400"
                  : "bg-gradient-to-r from-slate-50 to-slate-100 border-slate-200 text-slate-700 dark:from-slate-950/40 dark:to-slate-900/40 dark:border-slate-800 dark:text-slate-300",
            )}
          >
            <div
              className={cn(
                "w-2.5 h-2.5 rounded-full shadow-sm",
                connected
                  ? "bg-emerald-500 animate-pulse shadow-emerald-200"
                  : connection.status === "qrcode"
                    ? "bg-amber-500 animate-pulse shadow-amber-200"
                    : "bg-slate-400 shadow-slate-200",
              )}
            />
            {loadingConnection
              ? "Checking..."
              : connected
                ? "Connected"
                : connection.status === "qrcode"
                  ? "QR Ready"
                  : "Not Connected"}
          </div>
          {connected && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 rounded-xl shadow-sm border-slate-200/50 hover:bg-slate-50 dark:border-slate-700/50 dark:hover:bg-slate-800"
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
              <DropdownMenuContent align="end" className="rounded-xl">
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive rounded-lg"
                  onClick={handleDisconnectWhatsapp}
                  disabled={disconnecting}
                >
                  <Unplug className="h-4 w-4 mr-2" />
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
        <div className="flex flex-col gap-3 sm:gap-4 sm:flex-row sm:items-center sm:justify-between shrink-0">
          <div className="flex justify-center w-full">
            <TabsList className="bg-gradient-to-br from-white via-slate-50 to-slate-100 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900 rounded-2xl shadow-xl shadow-slate-200/60 dark:shadow-black/40 border border-slate-200/60 dark:border-slate-700/60 p-1.5 gap-1.5 w-full sm:w-auto overflow-hidden">
              <TabsTrigger 
                value="conversations" 
                className="gap-2.5 rounded-xl data-[state=active]:bg-gradient-to-r data-[state=active]:from-emerald-500 data-[state=active]:to-emerald-600 data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:shadow-emerald-500/30 data-[state=inactive]:text-slate-600 data-[state=inactive]:hover:bg-slate-100/80 dark:data-[state=inactive]:text-slate-300 dark:data-[state=inactive]:hover:bg-slate-800/80 transition-all duration-300 px-4 py-3 text-sm font-semibold flex-1 sm:flex-none min-w-[100px] justify-center"
              >
                <MessageSquare className="w-4.5 h-4.5 shrink-0" /> 
                <span className="hidden sm:inline">Conversations</span>
                <span className="sm:hidden">Chats</span>
              </TabsTrigger>
              <TabsTrigger 
                value="bot-type" 
                className="gap-2.5 rounded-xl data-[state=active]:bg-gradient-to-r data-[state=active]:from-violet-500 data-[state=active]:to-violet-600 data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:shadow-violet-500/30 data-[state=inactive]:text-slate-600 data-[state=inactive]:hover:bg-slate-100/80 dark:data-[state=inactive]:text-slate-300 dark:data-[state=inactive]:hover:bg-slate-800/80 transition-all duration-300 px-4 py-3 text-sm font-semibold flex-1 sm:flex-none min-w-[100px] justify-center"
              >
                <Bot className="w-4.5 h-4.5 shrink-0" /> 
                <span className="hidden sm:inline">AI Bot Type</span>
                <span className="sm:hidden">Bot Type</span>
              </TabsTrigger>
              <TabsTrigger 
                value="bot-settings" 
                className="gap-2.5 rounded-xl data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-500 data-[state=active]:to-blue-600 data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:shadow-blue-500/30 data-[state=inactive]:text-slate-600 data-[state=inactive]:hover:bg-slate-100/80 dark:data-[state=inactive]:text-slate-300 dark:data-[state=inactive]:hover:bg-slate-800/80 transition-all duration-300 px-4 py-3 text-sm font-semibold flex-1 sm:flex-none min-w-[100px] justify-center"
              >
                <Settings2 className="w-4.5 h-4.5 shrink-0" /> 
                <span className="hidden sm:inline">AI Bot Settings</span>
                <span className="sm:hidden">Settings</span>
              </TabsTrigger>
            </TabsList>
          </div>
          {saveBotSettingsButton}
        </div>

        <div className="mt-4 flex-1 min-h-0">
          {/* Conversations */}
          <TabsContent
            value="conversations"
            className="m-0 grid gap-4 min-h-[calc(100vh-200px)] sm:min-h-[560px] lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)]"
          >
            {/* Mobile: show back button when in chat view */}
            {mobileView === 'chat' && selectedConversationId && (
              <div className="lg:hidden fixed top-20 left-4 z-50">
                <button
                  type="button"
                  onClick={() => setMobileView('list')}
                  className="flex items-center gap-2 text-sm font-semibold text-emerald-600 dark:text-emerald-400 bg-white dark:bg-slate-800 px-4 py-2 rounded-full shadow-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 transition-all"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
                  Back to Chats
                </button>
              </div>
            )}
            <Card className={cn(
              "w-full lg:max-w-[400px] flex flex-col border-border/50 shadow-2xl shadow-slate-200/60 dark:shadow-slate-900/60 overflow-hidden h-full rounded-3xl bg-gradient-to-b from-white to-slate-50/50 dark:from-slate-900 dark:to-slate-950/50",
              mobileView === 'chat' && selectedConversationId ? 'hidden lg:flex' : 'flex'
            )}>
              <div className="p-4 sm:p-5 border-b border-border/40 bg-gradient-to-br from-white via-slate-50 to-slate-100 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900">
                <div className="flex flex-col gap-3 sm:gap-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-base sm:text-lg font-bold bg-gradient-to-r from-slate-900 to-slate-700 dark:from-white dark:to-slate-300 bg-clip-text text-transparent">Chats</h2>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {connected
                          ? `${filteredConversations.length} conversations`
                          : "Connect WhatsApp to load conversations."}
                      </p>
                    </div>
                    {connected && (
                      <div className="flex items-center gap-2">
                        <Badge className="rounded-full px-2.5 py-1 text-[11px] sm:text-xs font-semibold bg-gradient-to-r from-emerald-500 to-emerald-600 text-white border-0 shadow-lg shadow-emerald-500/30">
                          {filteredConversations.length}
                        </Badge>
                      </div>
                    )}
                  </div>
                  
                  <div className="relative">
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/70" />
                    <Input
                      placeholder="Search conversations..."
                      className="pl-10 pr-4 h-10 sm:h-11 bg-white dark:bg-slate-950 rounded-2xl border-slate-200/80 dark:border-slate-700/80 focus:border-emerald-400 dark:focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/20 transition-all duration-200 text-sm"
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                    />
                  </div>

                  {connected && (
                    <Button
                      size="sm"
                      className="w-full h-10 sm:h-11 rounded-2xl bg-gradient-to-r from-slate-400 via-slate-500 to-slate-600 hover:from-slate-400 hover:via-slate-500 hover:to-slate-600 text-white shadow-xl shadow-slate-500/20 border-0 font-semibold transition-all duration-300 text-sm cursor-not-allowed opacity-75"
                      type="button"
                      disabled
                    >
                      <Plus className="w-4 h-4 mr-2" />
                      New Conversation - Coming Soon
                    </Button>
                  )}

                  <div className="rounded-3xl border border-amber-200/50 dark:border-amber-900/30 bg-gradient-to-br from-amber-50 to-amber-100/50 dark:from-amber-950/20 dark:to-amber-900/10 p-4 sm:p-5 shadow-lg shadow-amber-500/10">
                    <div className="flex items-start gap-3">
                      <Clock className="w-5 h-5 sm:w-6 sm:h-6 text-amber-600 dark:text-amber-500 flex-shrink-0 mt-0.5" />
                      <div>
                        <h3 className="font-bold text-amber-900 dark:text-amber-100 text-sm sm:text-base">Coming Soon</h3>
                        <p className="text-xs sm:text-sm text-amber-800 dark:text-amber-200 mt-1">
                          We're upgrading to WhatsApp's official Cloud API for more reliable message delivery. This feature will be available shortly.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              
              <div className="flex-1 overflow-y-auto bg-gradient-to-b from-slate-50/50 to-slate-100/50 dark:from-slate-900/50 dark:to-slate-950/50 custom-scrollbar">
                {loadingConversations ? (
                  <div className="flex items-center justify-center h-32 sm:h-40">
                    <Loader2 className="w-6 h-6 sm:w-8 sm:h-8 animate-spin text-emerald-500" />
                  </div>
                ) : filteredConversations.length > 0 ? (
                  <div className="p-2 sm:p-3 space-y-1.5 sm:space-y-2">
                    {filteredConversations.map((conv) => (
                      <button
                        key={conv.id}
                        type="button"
                        onClick={() => {
                          setSelectedConversationId(conv.id);
                          setMobileView('chat');
                        }}
                        className={cn(
                          "group relative w-full flex items-start gap-2.5 sm:gap-3 p-3 sm:p-4 rounded-2xl cursor-pointer transition-all duration-300 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50",
                          selectedConv?.id === conv.id
                            ? "bg-gradient-to-r from-emerald-500 to-emerald-600 text-white shadow-xl shadow-emerald-500/30 scale-[1.02]"
                            : "bg-white dark:bg-slate-800/50 hover:bg-gradient-to-r hover:from-slate-50 hover:to-slate-100 dark:hover:from-slate-800 dark:hover:to-slate-700/50 hover:shadow-lg hover:scale-[1.01] border border-slate-200/60 dark:border-slate-700/60",
                        )}
                      >
                        <Avatar className={cn(
                          "w-10 h-10 sm:w-12 sm:h-12 border-2 transition-all duration-300 shrink-0",
                          selectedConv?.id === conv.id ? "border-white/30 shadow-lg" : "border-slate-200 dark:border-slate-600 group-hover:border-emerald-300 dark:group-hover:border-emerald-600"
                        )}>
                          <AvatarImage src={conv.avatarUrl || undefined} />
                          <AvatarFallback className={cn(
                            "font-bold text-xs sm:text-sm",
                            selectedConv?.id === conv.id ? "bg-white/20 text-white" : "bg-gradient-to-br from-emerald-500 to-emerald-600 text-white"
                          )}>
                            {conv.clientName.substring(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2 mb-1 sm:mb-1.5">
                            <h4 className={cn(
                              "font-semibold truncate text-xs sm:text-sm",
                              selectedConv?.id === conv.id ? "text-white" : "text-foreground"
                            )}>
                              {conv.clientName}
                            </h4>
                            <span className={cn(
                              "text-[10px] sm:text-[11px] font-medium whitespace-nowrap shrink-0",
                              selectedConv?.id === conv.id ? "text-white/80" : "text-muted-foreground"
                            )}>
                              {format(new Date(conv.lastMessageAt), "HH:mm")}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 sm:gap-2">
                            {conv.isBot && (
                              <span className={cn(
                                "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 sm:px-2 sm:py-0.5 text-[9px] sm:text-[10px] font-bold uppercase tracking-wider shrink-0",
                                selectedConv?.id === conv.id ? "bg-white/20 text-white" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400"
                              )}>
                                <Bot className="w-2.5 h-2.5 sm:w-3 sm:h-3" /> Bot
                              </span>
                            )}
                            <p
                              className={cn(
                                "truncate text-[11px] sm:text-xs leading-relaxed line-clamp-2",
                                selectedConv?.id === conv.id ? "text-white/90" : conv.unreadCount > 0 ? "font-semibold text-foreground" : "text-muted-foreground"
                              )}
                            >
                              {conv.lastMessage}
                            </p>
                          </div>
                        </div>
                        {conv.unreadCount > 0 && (
                          <Badge className={cn(
                            "rounded-full px-1.5 py-0.5 sm:px-2 sm:py-1 min-w-[20px] sm:min-w-[24px] h-5 sm:h-6 flex items-center justify-center shrink-0 text-[10px] sm:text-[11px] font-bold",
                            selectedConv?.id === conv.id ? "bg-white text-emerald-600" : "bg-gradient-to-r from-emerald-500 to-emerald-600 text-white shadow-md shadow-emerald-500/30"
                          )}>
                            {conv.unreadCount}
                          </Badge>
                        )}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="flex h-full min-h-40 sm:min-h-48 items-center justify-center p-6 sm:p-8 text-center">
                    <div className="space-y-3 sm:space-y-4">
                      <div className="w-14 h-14 sm:w-16 sm:h-16 mx-auto rounded-full bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-700 flex items-center justify-center">
                        <MessageSquare className="w-7 h-7 sm:w-8 sm:h-8 text-muted-foreground/50" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-foreground mb-1">
                          {connected ? "No conversations yet" : "Connect WhatsApp"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {connected
                            ? "Start a conversation to see it here."
                            : "Connect your WhatsApp account to load conversations."}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </Card>

            <Card className={cn(
              "flex-1 flex-col border-border/50 shadow-2xl shadow-slate-200/60 dark:shadow-slate-900/60 overflow-hidden h-full bg-gradient-to-b from-white to-slate-50/50 dark:from-slate-900 dark:to-slate-950/50 rounded-3xl",
              mobileView === 'list' ? 'hidden lg:flex' : 'flex'
            )}>
              {selectedConv ? (
                <>
                  <div className="p-4 sm:p-5 border-b border-border/40 bg-gradient-to-br from-white via-slate-50 to-slate-100 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900 rounded-t-3xl">
                    {/* Mobile back button inside chat header */}
                    <button
                      type="button"
                      onClick={() => setMobileView('list')}
                      className="flex lg:hidden items-center gap-2 text-sm font-semibold text-emerald-600 dark:text-emerald-400 mb-3 sm:mb-4 hover:text-emerald-700 dark:hover:text-emerald-300 transition-colors"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
                      All Chats
                    </button>
                    <div className="flex items-center justify-between gap-3 sm:gap-4">
                      <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
                        <Avatar className="w-10 h-10 sm:w-12 sm:h-12 border-2 border-slate-200 dark:border-slate-700 shadow-md">
                          <AvatarFallback className="bg-gradient-to-br from-emerald-500 to-emerald-600 text-white font-bold text-sm sm:text-base">
                            {selectedConv.clientName
                              .substring(0, 2)
                              .toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <h3 className="font-bold text-foreground truncate text-sm sm:text-base">
                            {selectedConv.clientName}
                          </h3>
                          <p className="text-xs text-muted-foreground flex items-center gap-1.5 truncate mt-0.5">
                            {selectedConv.isBot ? (
                              <>
                                <Bot className="w-3 h-3 text-emerald-500" /> <span className="font-medium text-emerald-600 dark:text-emerald-400">AI Bot Active</span>
                              </>
                            ) : selectedConv.unreadCount > 0 ? (
                              <span className="font-medium text-foreground">{selectedConv.unreadCount} unread</span>
                            ) : (
                              <span className="text-muted-foreground">Read</span>
                            )}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="rounded-full px-2.5 py-1 text-[11px] sm:text-xs font-semibold">
                          {selectedConv.isBot ? "Bot Chat" : "Customer Chat"}
                        </Badge>
                      </div>
                    </div>
                  </div>

                  <div
                    ref={messagePaneRef}
                    className="flex-1 overflow-y-auto p-3 sm:p-5 space-y-3 sm:space-y-4 bg-gradient-to-b from-slate-50/80 via-slate-100/50 to-slate-100/80 dark:from-slate-900/80 dark:via-slate-950/50 dark:to-slate-950/80 custom-scrollbar"
                    onScroll={(event) => {
                      if (event.currentTarget.scrollTop <= 8) {
                        loadMoreMessages();
                      }
                    }}
                  >
                    {loadingMessages ? (
                      <div className="flex items-center justify-center h-32 sm:h-40">
                        <Loader2 className="w-6 h-6 sm:w-8 sm:h-8 animate-spin text-emerald-500" />
                      </div>
                    ) : (messages?.length ?? 0) > 0 ? (
                      <>
                        {canLoadMoreMessages && (
                          <div className="flex justify-center pb-3 sm:pb-4">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-8 sm:h-9 px-3 sm:px-4 text-xs rounded-full border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 font-medium"
                              disabled={fetchingMessages}
                              onClick={loadMoreMessages}
                            >
                              {fetchingMessages ? (
                                <Loader2 className="w-3 h-3 mr-2 animate-spin" />
                              ) : null}
                              Load older messages
                            </Button>
                          </div>
                        )}
                        {messages!.map((message) => {
                          const inbound = message.direction === "inbound";
                          return (
                            <div
                              key={`${message.direction}-${message.timestamp}-${message.id}`}
                              className={cn(
                                "flex gap-2 sm:gap-3",
                                inbound ? "justify-start" : "justify-end",
                              )}
                            >
                              {inbound && (
                                <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center shrink-0 self-end mb-1 shadow-lg shadow-emerald-500/30 border-2 border-white dark:border-slate-800">
                                  <MessageSquare className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-white" />
                                </div>
                              )}
                              <div
                                className={cn(
                                  "max-w-full sm:max-w-[75%] px-3 sm:px-5 py-2.5 sm:py-3 text-xs sm:text-sm shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-300",
                                  inbound
                                    ? "bg-white dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700/60 rounded-2xl rounded-bl-sm"
                                    : "bg-gradient-to-br from-emerald-500 to-emerald-600 text-white rounded-2xl rounded-br-sm shadow-emerald-500/30",
                                )}
                              >
                                <p className="leading-relaxed">{message.content}</p>
                                <p
                                  className={cn(
                                    "text-[10px] sm:text-xs mt-1.5 sm:mt-2 flex items-center gap-1 sm:gap-1.5",
                                    inbound
                                      ? "text-muted-foreground"
                                      : "text-white/80 justify-end",
                                  )}
                                >
                                  <span className="font-medium">
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
                      <div className="flex h-full min-h-40 sm:min-h-48 items-center justify-center text-center">
                        <div className="space-y-3 sm:space-y-4">
                          <div className="w-14 h-14 sm:w-16 sm:h-16 mx-auto rounded-full bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-700 flex items-center justify-center">
                            <MessageSquare className="w-7 h-7 sm:w-8 sm:h-8 text-muted-foreground/50" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-foreground mb-1">No messages yet</p>
                            <p className="text-xs text-muted-foreground">
                              Start the conversation by sending a message.
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="p-3 sm:p-4 border-t border-border/40 bg-gradient-to-r from-white via-slate-50 to-white dark:from-slate-900 dark:via-slate-800 dark:to-slate-900 shadow-inner">
                    <div className="flex gap-2 sm:gap-3 items-end">
                      <div className="flex-1">
                        <Textarea
                          placeholder={
                            connected
                              ? "Type your message..."
                              : "Connect WhatsApp to reply."
                          }
                          className="min-h-[44px] sm:min-h-[52px] max-h-32 resize-none rounded-2xl border-slate-200/80 dark:border-slate-700/80 bg-white dark:bg-slate-950 focus:border-emerald-400 dark:focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/20 transition-all duration-200 text-xs sm:text-sm"
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
                      </div>
                      <Button
                        size="icon"
                        className="shrink-0 h-10 w-10 sm:h-12 sm:w-12 rounded-2xl bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white shadow-lg shadow-emerald-500/30 border-0 transition-all duration-300"
                        disabled={
                          !connected ||
                          !replyText.trim() ||
                          sendMessage.isPending
                        }
                        onClick={handleSendReply}
                      >
                        {sendMessage.isPending ? (
                          <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 animate-spin" />
                        ) : (
                          <Send className="w-4 h-4 sm:w-5 sm:h-5" />
                        )}
                      </Button>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="p-5 sm:p-8 border-b border-border/40 bg-gradient-to-br from-white via-slate-50 to-slate-100 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900 flex items-center gap-3 sm:gap-4 rounded-t-3xl">
                    <Avatar className="w-12 h-12 sm:w-14 sm:h-14 border-2 border-slate-200 dark:border-slate-700 shadow-md">
                      <AvatarFallback className="bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-700">
                        <UserCircle2 className="w-7 h-7 sm:w-8 sm:h-8 text-muted-foreground" />
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <h3 className="font-bold text-base sm:text-lg text-foreground">Select a Conversation</h3>
                      <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
                        Choose a chat to view messages and reply
                      </p>
                    </div>
                  </div>
                  <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-6 sm:p-8 text-center min-h-[350px] sm:min-h-[400px] bg-gradient-to-b from-slate-50/50 via-slate-100/30 to-slate-100/50 dark:from-slate-900/50 dark:via-slate-950/30 dark:to-slate-950/50">
                    <div className="w-20 h-20 sm:w-24 sm:h-24 bg-gradient-to-br from-emerald-100 to-emerald-200 dark:from-emerald-900/30 dark:to-emerald-800/30 rounded-full flex items-center justify-center mb-4 sm:mb-6 shadow-xl shadow-emerald-500/20">
                      <MessageSquare className="w-10 h-10 sm:w-12 sm:h-12 text-emerald-500" />
                    </div>
                    <p className="text-sm sm:text-base font-medium text-foreground mb-1.5 sm:mb-2">Ready to chat?</p>
                    <p className="text-xs sm:text-sm max-w-sm leading-relaxed">
                      Select a conversation from the list on the left to view message history and send replies.
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
                  <Card className="shadow-sm border-border/50 hover:shadow-md hover:border-primary/20 transition-all duration-300">
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

                      <Card className="shadow-sm border-border/50 hover:shadow-md hover:border-primary/20 transition-all duration-300">
                        <CardHeader>
                          <CardTitle>AI Bot Type</CardTitle>
                          <CardDescription>
                            Choose how the assistant sends WhatsApp replies.
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="grid gap-3 md:grid-cols-2 items-stretch">
                          <button
                            type="button"
                            onClick={() => setReviewMode("auto")}
                            className={cn(
                              "rounded-3xl border p-4 text-left transition-colors hover:border-primary/50 h-full",
                              reviewMode === "auto"
                                ? "border-primary bg-primary/5"
                                : "border-border bg-slate-50",
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
                              "rounded-3xl border p-4 text-left transition-colors hover:border-primary/50 h-full",
                              reviewMode === "approval_required"
                                ? "border-primary bg-primary/5"
                                : "border-border bg-slate-50",
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
                  <Card className="shadow-sm border-border/50 hover:shadow-md hover:border-primary/20 transition-all duration-300">
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
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                  <Card className="shadow-sm border-border/50 hover:shadow-md hover:border-primary/20 transition-all duration-300">
                    <CardHeader>
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <CardTitle>Pending AI replies</CardTitle>
                            <CardDescription className="mt-1">
                              Review customer messages and approve the AI response
                              when it looks right.
                            </CardDescription>
                          </div>
                          <Badge variant="secondary" className="self-start sm:self-auto">
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
                            className="space-y-3 rounded-lg border bg-slate-50 p-4"
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
                                <p className="whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-sm leading-relaxed">
                                  {draft.inboundMessageText}
                                </p>
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs uppercase text-muted-foreground">
                                  AI reply
                                </Label>
                                <p className="whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-sm leading-relaxed">
                                  {draft.suggestedReply}
                                </p>
                              </div>
                            </div>

                              <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="w-full sm:w-auto"
                                  onClick={() => handleCopyDraft(draft.suggestedReply)}
                                >
                                  <Copy className="mr-2 h-4 w-4" />
                                  Copy
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="w-full sm:w-auto"
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
                                  className="w-full sm:w-auto"
                                  onClick={() => handleApproveDraft(draft.id)}
                                  disabled={Boolean(approvingDraftId || dismissingDraftId)}
                                >
                                  {approvingDraftId === draft.id ? (
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                  ) : (
                                    <Check className="mr-2 h-4 w-4" />
                                  )}
                                  Approve & send
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
                  <Card className="shadow-sm border-border/50 hover:shadow-md hover:border-primary/20 transition-all duration-300">
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
                          label: "Handle reschedules",
                          desc: "Let clients move an existing appointment to a new time.",
                          checked: acceptReschedules,
                          onChange: setAcceptReschedules,
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

                  <Card className="shadow-sm border-border/50 hover:shadow-md hover:border-primary/20 transition-all duration-300">
                    <CardHeader>
                      <CardTitle>Change rules</CardTitle>
                      <CardDescription>
                        Set how much notice clients must give to cancel or
                        reschedule through the bot. These are enforced even if the
                        bot doesn't mention them.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      {acceptCancellations ? (
                        <div className="space-y-3">
                          <p className="text-sm font-medium">Cancellations</p>
                          <div className="space-y-1.5">
                            <Label
                              htmlFor="cancel-notice"
                              className="text-xs uppercase text-muted-foreground"
                            >
                              Minimum notice (hours) — 0 for no limit
                            </Label>
                            <Input
                              id="cancel-notice"
                              type="number"
                              min={0}
                              value={cancellationMinNoticeHours}
                              onChange={(e) =>
                                setCancellationMinNoticeHours(
                                  Math.max(0, Math.trunc(Number(e.target.value) || 0)),
                                )
                              }
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label
                              htmlFor="cancel-decline"
                              className="text-xs uppercase text-muted-foreground"
                            >
                              Custom decline message (optional)
                            </Label>
                            <Input
                              id="cancel-decline"
                              placeholder="Leave blank for the default. Use {hours} for the window."
                              value={cancellationDeclineMessage}
                              onChange={(e) => setCancellationDeclineMessage(e.target.value)}
                            />
                          </div>
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          Turn on “Handle cancellations” above to set a
                          cancellation notice window.
                        </p>
                      )}

                      {acceptReschedules ? (
                        <div className="space-y-3">
                          <p className="text-sm font-medium">Reschedules</p>
                          <div className="space-y-1.5">
                            <Label
                              htmlFor="reschedule-notice"
                              className="text-xs uppercase text-muted-foreground"
                            >
                              Minimum notice (hours) — 0 for no limit
                            </Label>
                            <Input
                              id="reschedule-notice"
                              type="number"
                              min={0}
                              value={rescheduleMinNoticeHours}
                              onChange={(e) =>
                                setRescheduleMinNoticeHours(
                                  Math.max(0, Math.trunc(Number(e.target.value) || 0)),
                                )
                              }
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label
                              htmlFor="reschedule-decline"
                              className="text-xs uppercase text-muted-foreground"
                            >
                              Custom decline message (optional)
                            </Label>
                            <Input
                              id="reschedule-decline"
                              placeholder="Leave blank for the default. Use {hours} for the window."
                              value={rescheduleDeclineMessage}
                              onChange={(e) => setRescheduleDeclineMessage(e.target.value)}
                            />
                          </div>
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          Turn on “Handle reschedules” above to set a reschedule
                          notice window.
                        </p>
                      )}
                    </CardContent>
                  </Card>

                  <Card className="shadow-sm border-border/50 hover:shadow-md hover:border-primary/20 transition-all duration-300">
                    <CardHeader>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <CardTitle>Knowledge base</CardTitle>
                          <CardDescription>
                            Teach the bot facts about your business (parking,
                            payment, policies…). It answers customer questions from
                            these — and never makes up answers it wasn't given.
                          </CardDescription>
                        </div>
                        <Badge variant="secondary">
                          {faqs.length} / {FAQ_COUNT_MAX}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {!answerFaqs && (
                        <p className="text-xs text-muted-foreground rounded-md bg-muted/40 p-3">
                          Turn on “Answer FAQs” above for the bot to use these.
                        </p>
                      )}

                      {faqs.length === 0 && (
                        <p className="text-sm text-muted-foreground">
                          No FAQs yet. Add a question the bot should be able to
                          answer.
                        </p>
                      )}

                      {faqs.map((faq) => (
                        <div
                          key={faq.id}
                          className="space-y-2 rounded-lg border p-3"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <Input
                              value={faq.question}
                              maxLength={FAQ_QUESTION_MAX}
                              placeholder="Question e.g. Do you have parking?"
                              onChange={(e) =>
                                updateFaq(faq.id, { question: e.target.value })
                              }
                            />
                            <div className="flex items-center gap-1 shrink-0">
                              <Switch
                                checked={faq.enabled}
                                onCheckedChange={(v) =>
                                  updateFaq(faq.id, { enabled: v })
                                }
                              />
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => removeFaq(faq.id)}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                          <Textarea
                            value={faq.answer}
                            maxLength={FAQ_ANSWER_MAX}
                            rows={2}
                            placeholder="Answer e.g. Yes, free parking behind the building."
                            onChange={(e) =>
                              updateFaq(faq.id, { answer: e.target.value })
                            }
                          />
                          <p className="text-right text-[10px] text-muted-foreground">
                            {faq.answer.length} / {FAQ_ANSWER_MAX}
                          </p>
                        </div>
                      ))}

                      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 mt-4 pt-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={addFaq}
                          disabled={faqs.length >= FAQ_COUNT_MAX}
                          className="w-full sm:w-auto"
                        >
                          <Plus className="h-4 w-4 mr-1" /> Add FAQ
                        </Button>
                        <Button
                          size="sm"
                          onClick={handleSaveFaqs}
                          disabled={savingFaqs}
                          className="w-full sm:w-auto bg-primary hover:bg-primary/90"
                        >
                          {savingFaqs && (
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          )}
                          Save knowledge base
                        </Button>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="shadow-sm border-border/50 hover:shadow-md hover:border-primary/20 transition-all duration-300">
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
                              className="grid grid-cols-1 items-start gap-3 py-2 border-b last:border-0 sm:grid-cols-[auto_6rem_1fr] sm:items-center"
                            >
                              <Switch
                                checked={hour.isOpen}
                                onCheckedChange={(v) =>
                                  updateHour(day.key, { isOpen: v })
                                }
                              />
                              <Label className="sm:w-24 shrink-0 font-medium">
                                {day.label}
                              </Label>
                              {hour.isOpen ? (
                                <div className="flex flex-col items-start gap-2 min-w-0 sm:flex-row sm:items-center">
                                  <Input
                                    type="time"
                                    value={hour.openTime}
                                    onChange={(e) =>
                                      updateHour(day.key, {
                                        openTime: e.target.value,
                                      })
                                    }
                                    className="w-full sm:w-32 bg-muted/50 text-center [&::-webkit-calendar-picker-indicator]:hidden"
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
                                    className="w-full sm:w-32 bg-muted/50 text-center [&::-webkit-calendar-picker-indicator]:hidden"
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

                  <Card className="shadow-sm border-border/50 hover:shadow-md hover:border-primary/20 transition-all duration-300">
                    <CardHeader>
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <CardTitle>Services the bot can book</CardTitle>
                            <CardDescription className="mt-1">
                              The assistant can only book enabled services.
                            </CardDescription>
                          </div>
                          <Badge variant="secondary" className="self-start sm:self-auto">
                            {selectedServicesCount} of {totalServicesCount}{" "}
                            enabled
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
                          <div className="flex flex-col gap-3 p-3 border rounded-3xl bg-muted/30">
                            <div>
                              <Label className="font-medium text-sm">
                                Enable all services
                              </Label>
                              <p className="text-xs text-muted-foreground">
                                Allow the assistant to book every active
                                service.
                              </p>
                            </div>
                            <div className="flex justify-end">
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
                          </div>
                          {activeServices.map((s) => (
                            <div
                              key={s.id}
                              className="flex flex-col gap-3 p-3 border rounded-lg hover:border-primary/30 transition-colors sm:flex-row sm:items-center sm:justify-between"
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

                  <Card className="shadow-sm border-border/50 hover:shadow-md hover:border-primary/20 transition-all duration-300">
                    <CardHeader>
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <CardTitle>Advanced settings</CardTitle>
                            <CardDescription className="mt-1">
                              Fine-tune the assistant identity and client-facing
                              messages.
                            </CardDescription>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            className="w-full sm:w-auto self-start sm:self-auto"
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
