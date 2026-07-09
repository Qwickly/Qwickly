import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  Check,
  Plus,
  X,
  Scissors,
  Clock,
  Lock,
  ArrowRight,
  Bot,
  MessageSquare,
  ListChecks,
  CalendarClock,
  BookOpen,
  UserRound,
  ChevronRight,
  ChevronLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { catalogKeys, fetchServices } from "@/lib/catalog";
import { fetchSubscription } from "@/lib/catalog-subscriptions";
import { BotSetupSkeleton } from "@/components/skeletons/page-skeletons";
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

type BotSetupSectionId =
  | "assistant"
  | "replies"
  | "booking"
  | "availability"
  | "services"
  | "knowledge"
  | "identity";

const DEFAULT_HOURS: Record<DayKey, DayHour> = {
  monday: { isOpen: true, openTime: "08:00", closeTime: "18:00" },
  tuesday: { isOpen: true, openTime: "08:00", closeTime: "18:00" },
  wednesday: { isOpen: true, openTime: "08:00", closeTime: "18:00" },
  thursday: { isOpen: true, openTime: "08:00", closeTime: "18:00" },
  friday: { isOpen: true, openTime: "08:00", closeTime: "18:00" },
  saturday: { isOpen: true, openTime: "08:00", closeTime: "15:00" },
  sunday: { isOpen: false, openTime: "09:00", closeTime: "13:00" },
};

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
    ...input,
    workingHours: ALL_DAYS.map((day) => ({ day: day.key, ...input.workingHours[day.key] })),
    allowedServiceIds: Array.from(input.allowedServiceIds).sort(),
  });
}

/**
 * Bot Setup — the "configure" half of the WhatsApp area (/whatsapp/bot).
 * Single sectioned scroll: bot on/off, reply type, owner alerts, what the bot
 * handles, change rules, knowledge base, working hours, services, and identity.
 * The live inbox and the pending-approval queue live on /whatsapp.
 */
export default function WhatsappBotPage() {
  const { toast } = useToast();

  const [businessId, setBusinessId] = useState("");
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
  const [welcomeMessage, setWelcomeMessage] = useState("Good day. How can I help you today?");
  const [fallbackMessage, setFallbackMessage] = useState(
    "I'll connect you with a team member who can help. Please hold.",
  );
  const [reviewMode, setReviewMode] = useState<BotReviewMode>("auto");
  const [ownerReviewAlertsEnabled, setOwnerReviewAlertsEnabled] = useState(true);
  const [ownerAlertPhone, setOwnerAlertPhone] = useState("");
  const [ownerAlertQuietStart, setOwnerAlertQuietStart] = useState("21:00");
  const [ownerAlertQuietEnd, setOwnerAlertQuietEnd] = useState("07:00");
  const [alwaysOn, setAlwaysOn] = useState(false);
  const [workingHours, setWorkingHours] = useState<Record<DayKey, DayHour>>(DEFAULT_HOURS);
  const [allowedServiceIds, setAllowedServiceIds] = useState<Set<string>>(new Set());
  const [servicesInitialised, setServicesInitialised] = useState(false);
  const [savedBotSettingsSnapshot, setSavedBotSettingsSnapshot] = useState<string | null>(null);
  const [savingFaqs, setSavingFaqs] = useState(false);
  const [activeSection, setActiveSection] = useState<BotSetupSectionId>("assistant");
  const [mobileSectionOpen, setMobileSectionOpen] = useState(false);

  const updateHour = (day: DayKey, patch: Partial<DayHour>) => {
    setWorkingHours((prev) => ({ ...prev, [day]: { ...prev[day], ...patch } }));
  };

  const { data: subscription, isLoading: loadingSubscription } = useQuery({
    queryKey: ["subscription"],
    queryFn: fetchSubscription,
  });

  const botSetupEnabled = Boolean(
    ((subscription as any)?.metadata?.whatsappEnabled ||
      (subscription as any)?.plans?.metadata?.whatsappEnabled) &&
      ((subscription as any)?.metadata?.aiAssistantEnabled ||
        (subscription as any)?.plans?.metadata?.aiAssistantEnabled),
  );

  const { data: allServices, isLoading: loadingServices } = useQuery({
    queryKey: catalogKeys.services,
    queryFn: fetchServices,
  });

  const activeServices = useMemo(
    () => (allServices ?? []).filter((s) => s.isActive),
    [allServices],
  );

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

        const loadedAllowedServiceIds = new Set(data.allowedServiceIds);
        setAllowedServiceIds(loadedAllowedServiceIds);
        setServicesInitialised(true);

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
          description: err instanceof Error ? err.message : "Error connecting to database",
          variant: "destructive",
        });
      } finally {
        setLoadingBotSettings(false);
      }
    }
    void loadSettings();
  }, [toast]);

  const addFaq = () =>
    setFaqs((prev) =>
      prev.length >= FAQ_COUNT_MAX
        ? prev
        : [...prev, { id: `new-${Date.now()}`, question: "", answer: "", enabled: true }],
    );

  const updateFaq = (id: string, patch: Partial<BotFaq>) =>
    setFaqs((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));

  const removeFaq = (id: string) => setFaqs((prev) => prev.filter((f) => f.id !== id));

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

      await saveBotSettings(settings, hoursList, Array.from(allowedServiceIds), allActiveServiceIds);

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
        description: "Your AI bot configuration has been successfully updated.",
      });
    } catch (err) {
      toast({
        title: "Failed to save bot settings",
        description: err instanceof Error ? err.message : "Error connecting to database",
        variant: "destructive",
      });
    } finally {
      setSavingBotSettings(false);
    }
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
    Boolean(savedBotSettingsSnapshot) && currentBotSettingsSnapshot !== savedBotSettingsSnapshot;

  const replyModeLabel = reviewMode === "approval_required" ? "Review before sending" : "Auto send";
  const availabilityLabel = alwaysOn ? "24/7" : "Business hours";
  const enabledRuleCount = [
    autoConfirm,
    acceptCancellations,
    acceptReschedules,
    sendPaymentLinks,
    answerFaqs,
  ].filter(Boolean).length;

  const botSetupSections: Array<{
    value: BotSetupSectionId;
    title: string;
    description: string;
    icon: typeof Bot;
    badge?: string;
  }> = [
    {
      value: "assistant",
      title: "Assistant",
      description: "Status and current operating mode",
      icon: Bot,
      badge: botEnabled ? "Active" : "Paused",
    },
    {
      value: "replies",
      title: "Replies",
      description: "Sending mode and approval alerts",
      icon: MessageSquare,
      badge: replyModeLabel,
    },
    {
      value: "booking",
      title: "Booking Rules",
      description: "Bookings, changes, payments, and FAQs",
      icon: ListChecks,
      badge: `${enabledRuleCount}/5 on`,
    },
    {
      value: "availability",
      title: "Availability",
      description: "24/7 mode and working hours",
      icon: CalendarClock,
      badge: availabilityLabel,
    },
    {
      value: "services",
      title: "Services",
      description: "Choose services the bot can book",
      icon: Scissors,
      badge: `${selectedServicesCount}/${totalServicesCount}`,
    },
    {
      value: "knowledge",
      title: "Knowledge",
      description: "FAQs and saved answers",
      icon: BookOpen,
      badge: `${faqs.length}/${FAQ_COUNT_MAX}`,
    },
    {
      value: "identity",
      title: "Identity",
      description: "Style, name, and handoff messages",
      icon: UserRound,
      badge: tone,
    },
  ];

  const activeSectionMeta =
    botSetupSections.find((section) => section.value === activeSection) ?? botSetupSections[0];
  const ActiveSectionIcon = activeSectionMeta.icon;

  const renderSectionContent = () => {
    switch (activeSection) {
      case "assistant":
        return (
          <Card className="border-0 bg-transparent shadow-none md:border-border/60 md:bg-card md:shadow-sm">
            <CardHeader className="p-0 pb-4 md:p-5">
              <CardTitle>Assistant status</CardTitle>
              <CardDescription>
                Control whether the WhatsApp assistant can respond to clients.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 p-0 md:p-5 md:pt-0">
              <div className="flex flex-col gap-4 rounded-xl border border-border/60 bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "h-2.5 w-2.5 shrink-0 rounded-full",
                        botEnabled ? "bg-primary" : "bg-muted-foreground/40",
                      )}
                    />
                    <h2 className="text-lg font-semibold text-foreground">AI Booking Assistant</h2>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {botEnabled
                      ? "Active and able to reply to WhatsApp clients."
                      : "Paused. Clients will not receive automated replies."}
                  </p>
                </div>
                <div className="flex items-center gap-3 sm:shrink-0">
                  <Badge
                    variant="outline"
                    className={cn(
                      "px-2.5 py-1 text-xs font-semibold",
                      botEnabled
                        ? "border-primary/20 bg-primary/10 text-primary"
                        : "border-border bg-muted text-muted-foreground",
                    )}
                  >
                    {botEnabled ? "Active" : "Paused"}
                  </Badge>
                  <Switch checked={botEnabled} onCheckedChange={setBotEnabled} />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
                  <p className="text-xs font-medium uppercase text-muted-foreground">Mode</p>
                  <p className="mt-1 text-sm font-semibold text-foreground">{replyModeLabel}</p>
                </div>
                <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
                  <p className="text-xs font-medium uppercase text-muted-foreground">Availability</p>
                  <p className="mt-1 text-sm font-semibold text-foreground">{availabilityLabel}</p>
                </div>
                <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
                  <p className="text-xs font-medium uppercase text-muted-foreground">Bookable services</p>
                  <p className="mt-1 text-sm font-semibold text-foreground">
                    {selectedServicesCount} of {totalServicesCount}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        );

      case "replies":
        return (
          <Card className="border-0 bg-transparent shadow-none md:border-border/60 md:bg-card md:shadow-sm">
            <CardHeader className="p-0 pb-4 md:p-5">
              <CardTitle>Replies</CardTitle>
              <CardDescription>
                Choose whether replies send automatically or wait for review.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5 p-0 md:p-5 md:pt-0">
              <div className="grid items-stretch gap-3 md:grid-cols-2">
                {[
                  {
                    value: "auto" as const,
                    title: "Auto send",
                    description: "The assistant replies and handles simple booking actions automatically.",
                  },
                  {
                    value: "approval_required" as const,
                    title: "Review before sending",
                    description: "The assistant drafts replies, and your team approves them in the inbox.",
                  },
                ].map((option) => {
                  const selected = reviewMode === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setReviewMode(option.value)}
                      className={cn(
                        "h-full rounded-lg border p-4 text-left transition-colors duration-200",
                        "focus-visible:outline-none focus-visible:ring-0",
                        selected
                          ? "border-primary bg-primary/5 text-primary shadow-sm"
                          : "border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                      )}
                    >
                      <div className="flex h-full items-start justify-between gap-3">
                        <div>
                          <p className="font-medium">{option.title}</p>
                          <p className={cn("mt-1 text-xs", selected ? "text-primary/80" : "text-muted-foreground")}>
                            {option.description}
                          </p>
                        </div>
                        <span
                          className={cn(
                            "flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-colors",
                            selected ? "bg-primary text-white" : "bg-muted text-muted-foreground",
                          )}
                        >
                          {selected ? <Check className="h-3 w-3" /> : null}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>

              {reviewMode === "approval_required" ? (
                <div className="space-y-4 rounded-xl border border-border/60 bg-card p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <Label htmlFor="owner-alert-toggle" className="text-sm font-medium">
                        Owner approval alerts
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Get a WhatsApp message when a reply is waiting.
                      </p>
                    </div>
                    <Switch
                      id="owner-alert-toggle"
                      checked={ownerReviewAlertsEnabled}
                      onCheckedChange={setOwnerReviewAlertsEnabled}
                    />
                  </div>

                  {ownerReviewAlertsEnabled ? (
                    <div className="space-y-4">
                      <div className="space-y-1.5">
                        <Label htmlFor="owner-alert-phone" className="text-xs uppercase text-muted-foreground">
                          Alert phone
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
                          <Label htmlFor="owner-alert-quiet-start" className="text-xs uppercase text-muted-foreground">
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
                          <Label htmlFor="owner-alert-quiet-end" className="text-xs uppercase text-muted-foreground">
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
                        Alerts inside your quiet hours are held and sent afterwards, never dropped.
                      </p>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </CardContent>
          </Card>
        );

      case "booking":
        return (
          <Card className="border-0 bg-transparent shadow-none md:border-border/60 md:bg-card md:shadow-sm">
            <CardHeader className="p-0 pb-4 md:p-5">
              <CardTitle>Booking rules</CardTitle>
              <CardDescription>
                Choose which client requests the assistant can manage without staff help.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6 p-0 md:p-5 md:pt-0">
              <div className="space-y-3">
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
                  <div key={item.label} className="flex items-center justify-between gap-4 rounded-xl border border-border/60 bg-card p-4">
                    <div>
                      <Label className="text-sm font-medium">{item.label}</Label>
                      <p className="text-xs text-muted-foreground">{item.desc}</p>
                    </div>
                    <Switch checked={item.checked} onCheckedChange={item.onChange} />
                  </div>
                ))}
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-3 rounded-xl border border-border/60 bg-card p-4">
                  <p className="text-sm font-medium">Cancellations</p>
                  {acceptCancellations ? (
                    <>
                      <div className="space-y-1.5">
                        <Label htmlFor="cancel-notice" className="text-xs uppercase text-muted-foreground">
                          Minimum notice (hours) - 0 for no limit
                        </Label>
                        <Input
                          id="cancel-notice"
                          type="number"
                          min={0}
                          value={cancellationMinNoticeHours}
                          onChange={(e) =>
                            setCancellationMinNoticeHours(Math.max(0, Math.trunc(Number(e.target.value) || 0)))
                          }
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="cancel-decline" className="text-xs uppercase text-muted-foreground">
                          Custom decline message
                        </Label>
                        <Input
                          id="cancel-decline"
                          placeholder="Leave blank for the default. Use {hours} for the window."
                          value={cancellationDeclineMessage}
                          onChange={(e) => setCancellationDeclineMessage(e.target.value)}
                        />
                      </div>
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Turn on Handle cancellations above to set a cancellation notice window.
                    </p>
                  )}
                </div>

                <div className="space-y-3 rounded-xl border border-border/60 bg-card p-4">
                  <p className="text-sm font-medium">Reschedules</p>
                  {acceptReschedules ? (
                    <>
                      <div className="space-y-1.5">
                        <Label htmlFor="reschedule-notice" className="text-xs uppercase text-muted-foreground">
                          Minimum notice (hours) - 0 for no limit
                        </Label>
                        <Input
                          id="reschedule-notice"
                          type="number"
                          min={0}
                          value={rescheduleMinNoticeHours}
                          onChange={(e) =>
                            setRescheduleMinNoticeHours(Math.max(0, Math.trunc(Number(e.target.value) || 0)))
                          }
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="reschedule-decline" className="text-xs uppercase text-muted-foreground">
                          Custom decline message
                        </Label>
                        <Input
                          id="reschedule-decline"
                          placeholder="Leave blank for the default. Use {hours} for the window."
                          value={rescheduleDeclineMessage}
                          onChange={(e) => setRescheduleDeclineMessage(e.target.value)}
                        />
                      </div>
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Turn on Handle reschedules above to set a reschedule notice window.
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        );

      case "availability":
        return (
          <Card className="border-0 bg-transparent shadow-none md:border-border/60 md:bg-card md:shadow-sm">
            <CardHeader className="p-0 pb-4 md:p-5">
              <CardTitle>Availability</CardTitle>
              <CardDescription>Use this if the bot should only reply during your business hours.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 p-0 md:p-5 md:pt-0">
              <div className="flex items-center justify-between rounded-xl border border-border/60 bg-card p-4">
                <div>
                  <Label className="font-medium">24/7 mode</Label>
                  <p className="text-xs text-muted-foreground">Bot replies around the clock regardless of hours.</p>
                </div>
                <Switch checked={alwaysOn} onCheckedChange={setAlwaysOn} />
              </div>
              <div className={cn("space-y-2 transition-opacity", alwaysOn && "pointer-events-none opacity-50")}>
                {ALL_DAYS.map((day) => {
                  const hour = workingHours[day.key];
                  return (
                    <div
                      key={day.key}
                      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-b border-border/60 py-3 last:border-0 sm:grid-cols-[auto_6rem_1fr]"
                    >
                      <div className="flex min-w-0 items-center gap-3 sm:contents">
                        <Switch checked={hour.isOpen} onCheckedChange={(v) => updateHour(day.key, { isOpen: v })} />
                        <Label className="min-w-0 truncate font-medium sm:w-24">{day.label}</Label>
                      </div>
                      {hour.isOpen ? (
                        <div className="grid grid-cols-[4.8rem_auto_4.8rem] items-center gap-1.5 sm:flex sm:min-w-0 sm:grid-cols-none sm:gap-2">
                          <Input
                            type="time"
                            value={hour.openTime}
                            onChange={(e) => updateHour(day.key, { openTime: e.target.value })}
                            className="h-8 min-w-0 bg-muted/50 px-1.5 text-center text-[11px] tabular-nums sm:h-9 sm:w-32 sm:px-2 sm:text-sm [&::-webkit-calendar-picker-indicator]:hidden"
                          />
                          <span className="text-xs text-muted-foreground sm:text-sm">-</span>
                          <Input
                            type="time"
                            value={hour.closeTime}
                            onChange={(e) => updateHour(day.key, { closeTime: e.target.value })}
                            className="h-8 min-w-0 bg-muted/50 px-1.5 text-center text-[11px] tabular-nums sm:h-9 sm:w-32 sm:px-2 sm:text-sm [&::-webkit-calendar-picker-indicator]:hidden"
                          />
                        </div>
                      ) : (
                        <span className="text-right text-sm italic text-muted-foreground sm:text-left">Closed</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        );

      case "services":
        return (
          <Card className="border-0 bg-transparent shadow-none md:border-border/60 md:bg-card md:shadow-sm">
            <CardHeader className="p-0 pb-4 md:p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle>Services the bot can book</CardTitle>
                  <CardDescription className="mt-1">The assistant can only book enabled services.</CardDescription>
                </div>
                <Badge variant="secondary" className="self-start sm:self-auto">
                  {selectedServicesCount} of {totalServicesCount} enabled
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 p-0 md:p-5 md:pt-0">
              {loadingServices ? (
                <div className="space-y-3">
                  <Skeleton className="h-20 rounded-xl" />
                  {Array.from({ length: 4 }).map((_, index) => (
                    <div key={index} className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-card p-3">
                      <div className="space-y-2">
                        <Skeleton className="h-4 w-36" />
                        <Skeleton className="h-3 w-28" />
                      </div>
                      <Skeleton className="h-6 w-11 rounded-full" />
                    </div>
                  ))}
                </div>
              ) : activeServices.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                    <Scissors className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">No services found</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">Add services on the Services page first.</p>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex flex-col gap-3 rounded-xl border border-border/60 bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <Label className="text-sm font-medium">Enable all services</Label>
                      <p className="text-xs text-muted-foreground">Allow the assistant to book every active service.</p>
                    </div>
                    <Switch
                      checked={totalServicesCount > 0 && selectedServicesCount === totalServicesCount}
                      onCheckedChange={(checked) =>
                        setAllowedServiceIds(checked ? new Set(activeServices.map((s) => s.id)) : new Set())
                      }
                    />
                  </div>
                  {activeServices.map((s) => (
                    <div
                      key={s.id}
                      className="flex flex-col gap-3 rounded-lg border border-border/60 bg-card p-3 transition-colors hover:border-primary/30 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div>
                        <Label className="cursor-pointer text-sm font-medium">{s.name}</Label>
                        {s.duration ? (
                          <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            {s.duration} min · R {s.price.toLocaleString()}
                          </p>
                        ) : null}
                      </div>
                      <Switch checked={allowedServiceIds.has(s.id)} onCheckedChange={() => toggleService(s.id)} />
                    </div>
                  ))}
                </>
              )}
            </CardContent>
          </Card>
        );

      case "knowledge":
        return (
          <Card className="border-0 bg-transparent shadow-none md:border-border/60 md:bg-card md:shadow-sm">
            <CardHeader className="p-0 pb-4 md:p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle>Knowledge base</CardTitle>
                  <CardDescription>
                    Teach the bot facts about your business so it can answer common client questions.
                  </CardDescription>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant="secondary">
                    {faqs.length} / {FAQ_COUNT_MAX}
                  </Badge>
                  <Button
                    size="sm"
                    onClick={addFaq}
                    disabled={faqs.length >= FAQ_COUNT_MAX}
                    className="h-8 bg-primary px-3 text-xs text-white hover:bg-primary/90"
                  >
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                    Add FAQ
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 p-0 md:p-5 md:pt-0">
              {!answerFaqs && (
                <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                  Answer FAQs is disabled in Booking Rules. Turn it on for the bot to use this knowledge base.
                </p>
              )}

              {faqs.length === 0 && (
                <p className="rounded-xl border border-dashed border-border/70 p-5 text-center text-sm text-muted-foreground">
                  No FAQs yet. Add a question the bot should be able to answer.
                </p>
              )}

              {faqs.map((faq) => (
                <div key={faq.id} className="space-y-2 rounded-lg border border-border/60 bg-card p-3">
                  <div className="flex items-center justify-between gap-2">
                    <Input
                      value={faq.question}
                      maxLength={FAQ_QUESTION_MAX}
                      placeholder="Question e.g. Do you have parking?"
                      onChange={(e) => updateFaq(faq.id, { question: e.target.value })}
                    />
                    <div className="flex shrink-0 items-center gap-1">
                      <Switch
                        checked={faq.enabled}
                        onCheckedChange={(v) => updateFaq(faq.id, { enabled: v })}
                      />
                      <Button variant="ghost" size="icon" onClick={() => removeFaq(faq.id)}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <Textarea
                    value={faq.answer}
                    maxLength={FAQ_ANSWER_MAX}
                    rows={2}
                    placeholder="Answer e.g. Yes, free parking behind the building."
                    onChange={(e) => updateFaq(faq.id, { answer: e.target.value })}
                  />
                  <p className="text-right text-[10px] text-muted-foreground">
                    {faq.answer.length} / {FAQ_ANSWER_MAX}
                  </p>
                </div>
              ))}

              <div className="mt-4 flex justify-end pt-2">
                <Button
                  size="sm"
                  onClick={handleSaveFaqs}
                  disabled={savingFaqs}
                  className="w-full bg-primary hover:bg-primary/90 sm:w-auto"
                >
                  {savingFaqs && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save knowledge base
                </Button>
              </div>
            </CardContent>
          </Card>
        );

      case "identity":
        return (
          <Card className="border-0 bg-transparent shadow-none md:border-border/60 md:bg-card md:shadow-sm">
            <CardHeader className="p-0 pb-4 md:p-5">
              <CardTitle>Identity</CardTitle>
              <CardDescription>Fine-tune the assistant identity and client-facing messages.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 p-0 md:p-5 md:pt-0">
              <div className="space-y-2">
                <Label>Communication style</Label>
                <Select value={tone} onValueChange={(v) => setTone(v as BotTone)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="friendly">Friendly and approachable</SelectItem>
                    <SelectItem value="professional">Professional and formal</SelectItem>
                    <SelectItem value="casual">Casual and relaxed</SelectItem>
                    <SelectItem value="concise">Brief and direct</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Assistant name</Label>
                <Input value={botName} onChange={(e) => setBotName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Opening message</Label>
                <Input value={welcomeMessage} onChange={(e) => setWelcomeMessage(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Handoff message</Label>
                <Input value={fallbackMessage} onChange={(e) => setFallbackMessage(e.target.value)} />
              </div>
            </CardContent>
          </Card>
        );

      default:
        return null;
    }
  };

  if (loadingSubscription) {
    return <BotSetupSkeleton />;
  }

  if (!botSetupEnabled) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4 py-8">
        <Card className="relative w-full max-w-lg overflow-hidden border-border/60 shadow-sm">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-primary/10 to-transparent" />
          <CardContent className="relative p-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10">
            <Lock className="h-8 w-8 text-primary" />
          </div>
          <h2 className="mb-2 text-2xl font-semibold text-foreground">Bot Setup locked</h2>
          <p className="mb-6 text-sm leading-7 text-muted-foreground">
            WhatsApp bot setup requires WhatsApp automation and the AI assistant in your current plan.
          </p>
          <Button className="w-full bg-primary text-white hover:bg-primary/90" asChild>
            <a href="/billing">
              Upgrade plan <ArrowRight className="ml-2 h-4 w-4" />
            </a>
          </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Bot Setup</h1>
          <p className="text-sm text-muted-foreground">
            Control how your WhatsApp assistant replies, books clients, and handles changes.
          </p>
        </div>
      </div>

      <div
        className={cn(
          "fixed bottom-5 right-5 z-40 transition-all duration-200 ease-out sm:bottom-6 sm:right-6",
          hasUnsavedBotSettings
            ? "translate-y-0 scale-100 opacity-100"
            : "pointer-events-none translate-y-2 scale-95 opacity-0",
        )}
      >
        <Button
          className="h-11 rounded-full bg-primary px-5 text-white shadow-lg shadow-primary/20 hover:bg-primary/90"
          onClick={handleSaveBotSettings}
          disabled={savingBotSettings || !hasUnsavedBotSettings}
        >
          {savingBotSettings ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Saving…
            </>
          ) : (
            "Save changes"
          )}
        </Button>
      </div>

      {loadingBotSettings ? (
        <BotSetupSkeleton showHeader={false} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
          {!mobileSectionOpen && (
            <div className="divide-y divide-border/60 lg:hidden">
              {botSetupSections.map(({ value, title, description, icon: Icon, badge }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    setActiveSection(value);
                    setMobileSectionOpen(true);
                  }}
                  className="flex w-full items-center gap-3 px-1 py-4 text-left transition-colors hover:bg-muted/40"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-primary">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">{title}</span>
                      {badge ? (
                        <Badge variant="secondary" className="text-[10px] font-medium">
                          {badge}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="truncate text-sm text-muted-foreground">{description}</p>
                  </div>
                  <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
                </button>
              ))}
            </div>
          )}

          <aside className="hidden lg:sticky lg:top-6 lg:block lg:self-start">
            <div className="flex flex-col gap-1">
              {botSetupSections.map(({ value, title, icon: Icon, badge }) => {
                const selected = activeSection === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setActiveSection(value)}
                    className={cn(
                      "group flex w-full items-center gap-2.5 rounded-lg border border-transparent px-3 py-2.5 text-left text-sm font-medium transition-colors hover:bg-muted/60",
                      selected && "border-border/60 bg-muted shadow-sm",
                    )}
                  >
                    <Icon className={cn("h-4 w-4 shrink-0 text-muted-foreground", selected && "text-primary")} />
                    <span className="min-w-0 flex-1 truncate">{title}</span>
                    {badge ? (
                      <Badge variant="secondary" className="ml-1 text-[10px] font-medium">
                        {badge}
                      </Badge>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </aside>

          <main className={cn("min-w-0", !mobileSectionOpen && "hidden lg:block")}>
            {mobileSectionOpen && (
              <div className="mb-4 duration-200 ease-out animate-in fade-in slide-in-from-left-2 lg:hidden">
                <button
                  type="button"
                  onClick={() => setMobileSectionOpen(false)}
                  className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Bot Setup
                </button>
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-primary">
                    <ActiveSectionIcon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold text-foreground">{activeSectionMeta.title}</h2>
                    <p className="text-sm text-muted-foreground">{activeSectionMeta.description}</p>
                  </div>
                </div>
              </div>
            )}
            <div className="duration-300 ease-out animate-in fade-in slide-in-from-right-3 lg:animate-none">
              {renderSectionContent()}
            </div>
          </main>
        </div>
      )}
    </div>
  );
}
