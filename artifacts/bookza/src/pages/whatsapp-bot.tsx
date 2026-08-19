import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
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
  Plus,
  X,
  Scissors,
  Lock,
  ArrowRight,
  Bot,
  MessageSquare,
  ListChecks,
  CalendarClock,
  BookOpen,
  UserRound,
  QrCode,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PageEmptyState, PageHeader } from "@/components/layout/page-ui";
import { usePageChrome } from "@/components/layout/page-chrome";
import {
  SettingsGroup,
  SettingsPanel,
  SettingsRow,
  SettingsSegmentedControl,
  SettingsToggleRow,
} from "@/components/settings/settings-ui";
import { toast } from "sonner";
import { catalogKeys, fetchServices } from "@/lib/catalog";
import { fetchSubscription } from "@/lib/catalog-subscriptions";
import { useEntitlements } from "@/hooks/use-entitlements";
import { BotSetupSkeleton } from "@/components/skeletons/page-skeletons";
import { TourOverlay } from "@/components/tour/TourOverlay";
import { BackToChecklistLink } from "@/components/tour/BackToChecklistLink";
import { WhatsappConnectionManager } from "@/components/settings/WhatsappConnectionManager";
import { WHATSAPP_BOT_TOUR_STEPS } from "@/lib/tour-steps";
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
  | "connection"
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
  const [, navigate] = useLocation();

  const [businessId, setBusinessId] = useState("");
  const [loadingBotSettings, setLoadingBotSettings] = useState(false);
  const [savingBotSettings, setSavingBotSettings] = useState(false);
  const [botEnabled, setBotEnabled] = useState(true);
  const [autoConfirm, setAutoConfirm] = useState(false);
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
  const [activeSection, setActiveSection] = useState<BotSetupSectionId>("connection");

  const updateHour = (day: DayKey, patch: Partial<DayHour>) => {
    setWorkingHours((prev) => ({ ...prev, [day]: { ...prev[day], ...patch } }));
  };

  const { data: subscription, isLoading: loadingSubscription } = useQuery({
    queryKey: ["subscription"],
    queryFn: fetchSubscription,
  });

  // The AI Bot Setup is the WhatsApp Chatbot add-on (free during trial). This
  // used to read two metadata flags (whatsappEnabled + aiAssistantEnabled) that
  // no plan carries any more, so it was blocked for everyone.
  const { data: entitlements, isLoading: loadingEntitlements } = useEntitlements();
  const botSetupEnabled = Boolean(
    entitlements?.entitled && entitlements.grants?.whatsapp_chatbot,
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
        toast.error("Failed to load bot settings", { description: err instanceof Error ? err.message : "Error connecting to database" });
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
      toast("Knowledge base saved");
    } catch (err) {
      toast.error("Could not save knowledge base", { description: err instanceof Error ? err.message : "Please try again." });
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

      toast("Bot settings saved", { description: "Your AI bot configuration has been successfully updated." });
    } catch (err) {
      toast.error("Failed to save bot settings", { description: err instanceof Error ? err.message : "Error connecting to database" });
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
  const botSetupSections = useMemo<Array<{
    value: BotSetupSectionId;
    title: string;
    description: string;
    icon: typeof Bot;
  }>>(
    () => [
      {
        value: "connection",
        title: "Connect WhatsApp",
        description: "Pair your phone with Qwickly",
        icon: QrCode,
      },
      {
        value: "assistant",
        title: "Assistant",
        description: "Status and current operating mode",
        icon: Bot,
      },
      {
        value: "replies",
        title: "Replies",
        description: "How assistant replies are sent",
        icon: MessageSquare,
      },
      {
        value: "booking",
        title: "Booking Rules",
        description: "Bookings, changes, payments, and FAQs",
        icon: ListChecks,
      },
      {
        value: "availability",
        title: "Availability",
        description: "24/7 mode and working hours",
        icon: CalendarClock,
      },
      {
        value: "services",
        title: "Services",
        description: "Choose services the bot can book",
        icon: Scissors,
      },
      {
        value: "knowledge",
        title: "Knowledge",
        description: "FAQs and saved answers",
        icon: BookOpen,
      },
      {
        value: "identity",
        title: "Identity",
        description: "Style, name, and handoff messages",
        icon: UserRound,
      },
    ],
    [],
  );
  const pageChrome = useMemo(
    () => ({
      internalNav: {
        items: botSetupSections.map(({ value, title, icon }) => ({
          value,
          label: title,
          icon,
          dataTourId: `bot-section-${value}`,
        })),
        active: activeSection,
        onChange: (value: string) => setActiveSection(value as BotSetupSectionId),
        ariaLabel: "Bot setup sections",
      },
    }),
    [activeSection, botSetupSections],
  );
  usePageChrome(pageChrome);

  // `flex` is load-bearing next to `flex-row`: stock CardHeader is a grid, so a
  // bare flex-row is inert on it and the icon would stack above the title.
  const sectionHeaderClass = "flex flex-row items-start gap-3";
  const sectionContentClass = "space-y-4";

  const renderSectionContent = () => {
    switch (activeSection) {
      case "connection":
        return <WhatsappConnectionManager />;

      case "assistant":
        return (
          <SettingsPanel>
            <CardHeader className={sectionHeaderClass}>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Bot className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <CardTitle className="text-base md:text-lg">Assistant status</CardTitle>
                <CardDescription className="mt-1">
                  Control whether the WhatsApp assistant can respond to clients.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className={sectionContentClass}>
              <SettingsGroup>
                <SettingsToggleRow
                  data-tour-id="bot-enabled-toggle"
                  title="AI Booking Assistant"
                  description={
                    botEnabled
                      ? "Active and able to reply to WhatsApp clients."
                      : "Paused. Clients will not receive automated replies."
                  }
                  checked={botEnabled}
                  onCheckedChange={setBotEnabled}
                />
                <SettingsRow title="Mode">
                  <Badge variant="secondary">{replyModeLabel}</Badge>
                </SettingsRow>
                <SettingsRow title="Availability">
                  <Badge variant="secondary">{availabilityLabel}</Badge>
                </SettingsRow>
                <SettingsRow title="Bookable services">
                  <Badge variant="secondary">
                    {selectedServicesCount} of {totalServicesCount}
                  </Badge>
                </SettingsRow>
              </SettingsGroup>
            </CardContent>
          </SettingsPanel>
        );

      case "replies":
        return (
          <SettingsPanel>
            <CardHeader className={sectionHeaderClass}>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <MessageSquare className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <CardTitle className="text-base md:text-lg">Replies</CardTitle>
                <CardDescription className="mt-1">
                  Choose whether replies send automatically or wait for review.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className={sectionContentClass}>
              <SettingsGroup>
                <SettingsRow
                  title="Reply approval"
                  description={
                    reviewMode === "auto"
                      ? "The assistant replies and handles simple booking actions automatically."
                      : "The assistant drafts replies, and your team approves them in the inbox."
                  }
                >
                  <SettingsSegmentedControl
                    value={reviewMode}
                    options={[
                      { value: "auto", label: "Auto send" },
                      { value: "approval_required", label: "Review first" },
                    ]}
                    onChange={(value) => setReviewMode(value as BotReviewMode)}
                    className="w-full sm:w-72"
                  />
                </SettingsRow>
              </SettingsGroup>

            </CardContent>
          </SettingsPanel>
        );

      case "booking":
        return (
          <SettingsPanel>
            <CardHeader className={sectionHeaderClass}>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <ListChecks className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <CardTitle className="text-base md:text-lg">Booking rules</CardTitle>
                <CardDescription className="mt-1">
                  Choose which client requests the assistant can manage without staff help.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className={sectionContentClass}>
              <SettingsGroup>
                {[
                  {
                    label: "Auto-confirm bookings",
                    desc: "Confirm bookings when a matching time is available.",
                    checked: autoConfirm,
                    onChange: setAutoConfirm,
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
                    <SettingsToggleRow
                      key={item.label}
                      title={item.label}
                      description={item.desc}
                      checked={item.checked}
                      onCheckedChange={item.onChange}
                    />
                ))}
              </SettingsGroup>

              {/* Cancel/reschedule policy (whether clients can cancel/reschedule +
                  the notice windows) now lives in Settings as a core booking rule,
                  since it applies to the booking page too — not just the bot. */}
              <div className="rounded-xl border border-border/45 bg-muted/20 p-4 text-sm text-muted-foreground">
                Cancellation &amp; reschedule rules — whether clients can cancel or reschedule online
                and how much notice they need — are now set in{" "}
                <a href="/settings" className="font-medium text-primary hover:underline">
                  Settings → Booking
                </a>
                . They apply to both the booking page and the assistant.
              </div>
            </CardContent>
          </SettingsPanel>
        );

      case "availability":
        return (
          <SettingsPanel>
            <CardHeader className={sectionHeaderClass}>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <CalendarClock className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <CardTitle className="text-base md:text-lg">Availability</CardTitle>
                <CardDescription className="mt-1">Use this if the bot should only reply during your business hours.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className={sectionContentClass}>
              <div className="rounded-xl border border-border/45 bg-muted/20 p-4 text-sm text-muted-foreground">
                These hours control only when the WhatsApp assistant auto-replies — they're separate from{" "}
                <a href="/settings" className="font-medium text-primary hover:underline">
                  Settings → Operating Hours
                </a>
                , which controls your public booking page. If you change one, update the other too, or turn on 24/7 mode below
                so the bot always replies.
              </div>
              <SettingsGroup>
                <SettingsToggleRow
                  title="24/7 mode"
                  description="Bot replies around the clock regardless of hours."
                  checked={alwaysOn}
                  onCheckedChange={setAlwaysOn}
                />
              </SettingsGroup>
              <div className={cn("space-y-2 transition-opacity", alwaysOn && "pointer-events-none opacity-50")}>
                {ALL_DAYS.map((day) => {
                  const hour = workingHours[day.key];
                  return (
                    <div
                      key={day.key}
                      className="flex flex-col gap-3 rounded-2xl bg-muted/35 p-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex items-center gap-3">
                        <Switch checked={hour.isOpen} onCheckedChange={(v) => updateHour(day.key, { isOpen: v })} />
                        <Label className="text-sm font-medium">{day.label}</Label>
                      </div>
                      {hour.isOpen ? (
                        <div className="flex items-center gap-2">
                          <Input
                            type="time"
                            value={hour.openTime}
                            onChange={(e) => updateHour(day.key, { openTime: e.target.value })}
                            className="h-9 w-24 bg-muted/50 text-center text-sm"
                          />
                          <span className="text-sm text-muted-foreground">-</span>
                          <Input
                            type="time"
                            value={hour.closeTime}
                            onChange={(e) => updateHour(day.key, { closeTime: e.target.value })}
                            className="h-9 w-24 bg-muted/50 text-center text-sm"
                          />
                        </div>
                      ) : (
                        <span className="text-sm italic text-muted-foreground">Closed</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </SettingsPanel>
        );

      case "services":
        return (
          <SettingsPanel>
            <CardHeader className={sectionHeaderClass}>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Scissors className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1 flex-col gap-3 sm:flex sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="text-base md:text-lg">Services the bot can book</CardTitle>
                  <CardDescription className="mt-1">The assistant can only book enabled services.</CardDescription>
                </div>
                <Badge variant="secondary" className="self-start sm:self-auto">
                  {selectedServicesCount} of {totalServicesCount} enabled
                </Badge>
              </div>
            </CardHeader>
            <CardContent className={sectionContentClass}>
              {loadingServices ? (
                <div className="space-y-3">
                  <Skeleton className="h-20 rounded-xl" />
                  {Array.from({ length: 4 }).map((_, index) => (
                    <div key={index} className="flex items-center justify-between gap-3 rounded-xl border border-border/45 bg-muted/20 p-4">
                      <div className="space-y-2">
                        <Skeleton className="h-4 w-36" />
                        <Skeleton className="h-3 w-28" />
                      </div>
                      <Skeleton className="h-6 w-11 rounded-full" />
                    </div>
                  ))}
                </div>
              ) : activeServices.length === 0 ? (
                <PageEmptyState
                  icon={Scissors}
                  title="No services found"
                  description="Add services on the Services page first."
                />
              ) : (
                <>
                  <SettingsGroup>
                    <SettingsRow
                      title="Enable all services"
                      description="Allow the assistant to book every active service."
                    >
                      <Switch
                        checked={totalServicesCount > 0 && selectedServicesCount === totalServicesCount}
                        onCheckedChange={(checked) =>
                          setAllowedServiceIds(checked ? new Set(activeServices.map((s) => s.id)) : new Set())
                        }
                      />
                    </SettingsRow>
                  </SettingsGroup>
                  <SettingsGroup>
                    {activeServices.map((s) => (
                      <SettingsRow
                        key={s.id}
                        title={s.name}
                        description={s.duration ? `${s.duration} min · R ${s.price.toLocaleString()}` : undefined}
                      >
                        <Switch checked={allowedServiceIds.has(s.id)} onCheckedChange={() => toggleService(s.id)} />
                      </SettingsRow>
                    ))}
                  </SettingsGroup>
                </>
              )}
            </CardContent>
          </SettingsPanel>
        );

      case "knowledge":
        return (
          <SettingsPanel>
            <CardHeader className={sectionHeaderClass}>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <BookOpen className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1 flex-col gap-3 sm:flex sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle className="text-base md:text-lg">Knowledge base</CardTitle>
                  <CardDescription className="mt-1">
                    Teach the bot facts about your business so it can answer common client questions.
                  </CardDescription>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant="secondary">
                    {faqs.length} / {FAQ_COUNT_MAX}
                  </Badge>
                  <Button size="sm" onClick={addFaq} disabled={faqs.length >= FAQ_COUNT_MAX} className="h-8 px-3 text-xs">
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                    Add FAQ
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className={sectionContentClass}>
              {!answerFaqs && (
                <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                  Answer FAQs is disabled in Booking Rules. Turn it on for the bot to use this knowledge base.
                </p>
              )}

              {faqs.length === 0 && (
                <PageEmptyState
                  icon={BookOpen}
                  title="No FAQs yet"
                  description="Add a question the bot should be able to answer."
                />
              )}

              {faqs.map((faq) => (
                <div key={faq.id} className="overflow-hidden rounded-2xl border border-border/45 bg-muted/20">
                  <div className="flex flex-col gap-3 border-b border-border/45 p-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1 space-y-2">
                      <Label className="text-sm font-semibold text-foreground">Question</Label>
                      <Input
                        value={faq.question}
                        maxLength={FAQ_QUESTION_MAX}
                        placeholder="Do you have parking?"
                        onChange={(e) => updateFaq(faq.id, { question: e.target.value })}
                      />
                      <p className="text-right text-[10px] text-muted-foreground">
                        {faq.question.length} / {FAQ_QUESTION_MAX}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center justify-between gap-2 sm:justify-end">
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={faq.enabled}
                          onCheckedChange={(v) => updateFaq(faq.id, { enabled: v })}
                        />
                        <span className="text-sm text-muted-foreground">{faq.enabled ? "Enabled" : "Paused"}</span>
                      </div>
                      <Button variant="ghost" size="icon" onClick={() => removeFaq(faq.id)} aria-label="Remove FAQ">
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2 p-4">
                    <Label className="text-sm font-semibold text-foreground">Answer</Label>
                    <Textarea
                      value={faq.answer}
                      maxLength={FAQ_ANSWER_MAX}
                      rows={4}
                      placeholder="Yes, free parking is available behind the building."
                      onChange={(e) => updateFaq(faq.id, { answer: e.target.value })}
                      className="min-h-28"
                    />
                    <p className="text-right text-[10px] text-muted-foreground">
                      {faq.answer.length} / {FAQ_ANSWER_MAX}
                    </p>
                  </div>
                </div>
              ))}

              <div className="mt-4 flex justify-end pt-2">
                <Button
                  size="sm"
                  onClick={handleSaveFaqs}
                  disabled={savingFaqs}
                  className="w-full sm:w-auto"
                >
                  {savingFaqs && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save knowledge base
                </Button>
              </div>
            </CardContent>
          </SettingsPanel>
        );

      case "identity":
        return (
          <SettingsPanel>
            <CardHeader className={sectionHeaderClass}>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <UserRound className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <CardTitle className="text-base md:text-lg">Identity</CardTitle>
                <CardDescription className="mt-1">Fine-tune the assistant identity and client-facing messages.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className={sectionContentClass}>
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
          </SettingsPanel>
        );

      default:
        return null;
    }
  };

  if (loadingSubscription || loadingEntitlements) {
    return <BotSetupSkeleton />;
  }

  if (!botSetupEnabled) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4 py-8">
        <Card className="w-full max-w-lg">
          <PageEmptyState
            icon={Lock}
            title="Bot Setup locked"
            description="WhatsApp bot setup requires WhatsApp automation and the AI assistant in your current plan."
            actions={
              <Button className="w-full" asChild>
                <a href="/billing">
                  Upgrade plan <ArrowRight className="ml-2 h-4 w-4" />
                </a>
              </Button>
            }
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12">
      <TourOverlay
        tourId="whatsapp-bot"
        steps={WHATSAPP_BOT_TOUR_STEPS}
        onFinish={() => navigate("/get-started")}
      />
      <BackToChecklistLink />
      <PageHeader
        title="Bot Setup"
        description="Control how your WhatsApp assistant replies, books clients, and handles changes."
      />

      <div
        className={cn(
          "fixed bottom-5 right-5 z-40 transition-all duration-200 ease-out sm:bottom-6 sm:right-6",
          hasUnsavedBotSettings
            ? "translate-y-0 scale-100 opacity-100"
            : "pointer-events-none translate-y-2 scale-95 opacity-0",
        )}
      >
        <Button
          className="h-11 rounded-full px-5"
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
        <main className="min-w-0 duration-300 ease-out animate-in fade-in">
          {renderSectionContent()}
        </main>
      )}
    </div>
  );
}
