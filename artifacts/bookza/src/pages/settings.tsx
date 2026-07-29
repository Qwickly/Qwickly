import { useEffect, useRef, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Building2,
  Bell,
  CreditCard,
  MessageSquare,
  Shield,
  Users,
  Save,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Sparkles,
  ChevronRight,
  Circle,
  ArrowRight,
  Lock,
  Clock,
  Globe,
  KeyRound,
  CalendarClock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { MobileSectionHeader } from "@/components/layout/MobileSectionHeader";
import { InfoTile, PageHeader } from "@/components/layout/page-ui";
import {
  ONBOARDING_TABS,
  ONBOARDING_TAB_LABELS,
  allOnboardingTabsVisited,
  completeOnboarding,
  markOnboardingTabVisited,
  nextOnboardingTab,
  type OnboardingTabId,
} from "@/lib/onboarding";
import { useAuth } from "@/contexts/AuthContext";
import { useEntitlements } from "@/hooks/use-entitlements";
import { useSettings } from "@/hooks/use-settings";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import {
  deleteBusinessData,
  getProviderSetting,
  inviteTeamMember,
  removeTeamMember,
  saveNotificationSettings,
  saveOperatingHours,
  savePaymentProviders,
  updateTeamMember,
} from "@/lib/settings";
import { fetchSubscription } from "@/lib/catalog-subscriptions";
import { WhatsappConnectionManager } from "@/components/settings/WhatsappConnectionManager";
import { CustomDomainManager } from "@/components/settings/CustomDomainManager";
import {
  SettingsGroup,
  SettingsNumberUnitField,
  SettingsPanel,
  SettingsRow,
  SettingsSegmentedControl,
  SettingsToggleRow,
} from "@/components/settings/settings-ui";
import {
  INDUSTRIES,
  PAYMENT_PROVIDERS,
  WEEKDAY_LABELS,
  WEEKDAYS,
  type BookingPolicy,
  type PaymentProviderKey,
  type NotificationSettings,
  type TeamMember,
  type Weekday,
  type WhatsappSettings,
} from "@/types/settings";

type NotificationToggleKey = Exclude<keyof NotificationSettings, "business_id">;
type EventChannel = "off" | "whatsapp" | "email" | "both";
const BUSINESS_DESCRIPTION_MAX_LENGTH = 500;

// Onboarding progress bar, shared by the desktop page header and the mobile
// section-menu header so the two don't hand-roll the same markup twice.
function OnboardingProgressBar({
  percent,
  className,
  troughClassName = "bg-muted",
}: {
  percent: number;
  className?: string;
  troughClassName?: string;
}) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div className={cn("h-2 flex-1 overflow-hidden rounded-full", troughClassName)}>
        <div
          className="h-full rounded-full bg-primary transition-all duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {percent}%
      </span>
    </div>
  );
}

export default function SettingsPage() {
  const { user, signOut } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { settings, updateSettings, loading, saving, hasUnsavedChanges, error, save, reload } =
    useSettings();

  const { data: subscription, isLoading: loadingSubscription } = useQuery({
    queryKey: ["subscription"],
    queryFn: fetchSubscription,
  });
  const { data: entitlements } = useEntitlements();

  const whatsappEnabled = Boolean(entitlements?.entitled && entitlements.whatsappSession);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<TeamMember["role"]>("staff");
  const [inviting, setInviting] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [updatingPassword, setUpdatingPassword] = useState(false);
  const [persisting, setPersisting] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<OnboardingTabId>("profile");
  const [tabsVisited, setTabsVisited] = useState<OnboardingTabId[]>([]);
  const [completingOnboarding, setCompletingOnboarding] = useState(false);
  const [mobileSectionOpen, setMobileSectionOpen] = useState(false);
  const businessDescriptionRef = useRef<HTMLTextAreaElement>(null);

  const isOnboarding = Boolean(
    settings && !settings.business.onboarding_completed,
  );

  useEffect(() => {
    const requestedTab = new URLSearchParams(window.location.search).get("tab");
    if (ONBOARDING_TABS.includes(requestedTab as OnboardingTabId)) {
      setActiveTab(requestedTab as OnboardingTabId);
    }
  }, []);

  useEffect(() => {
    const textarea = businessDescriptionRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [settings?.business.description]);

  useEffect(() => {
    if (!settings) return;
    const visited = (settings.business.onboarding_tabs_visited ?? []).filter(
      (t): t is OnboardingTabId =>
        ONBOARDING_TABS.includes(t as OnboardingTabId),
    );
    setTabsVisited(visited);

    if (!settings.business.onboarding_completed) {
      const firstUnvisited =
        ONBOARDING_TABS.find((t) => !visited.includes(t)) ?? "profile";
      setActiveTab(firstUnvisited);
      if (!visited.includes(firstUnvisited)) {
        void markOnboardingTabVisited(
          settings.business.id,
          firstUnvisited,
          visited,
        ).then((next) => {
          setTabsVisited(next);
          updateSettings((prev) =>
            prev
              ? {
                  ...prev,
                  business: { ...prev.business, onboarding_tabs_visited: next },
                }
              : prev,
            { markClean: true },
          );
        });
      }
    }
  }, [
    settings?.business.id,
    settings?.business.onboarding_completed,
    updateSettings,
  ]);

  const handleTabChange = async (tab: string) => {
    const tabId = tab as OnboardingTabId;
    setActiveTab(tabId);
    if (
      !settings ||
      settings.business.onboarding_completed ||
      tabsVisited.includes(tabId)
    )
      return;
    try {
      const next = await markOnboardingTabVisited(
        settings.business.id,
        tabId,
        tabsVisited,
      );
      setTabsVisited(next);
      updateSettings((prev) =>
        prev
          ? {
              ...prev,
              business: { ...prev.business, onboarding_tabs_visited: next },
            }
          : prev,
        { markClean: true },
      );
    } catch (err) {
      toast({
        title: "Could not save progress",
        description: err instanceof Error ? err.message : "Please try again",
        variant: "destructive",
      });
    }
  };

  const handleNextOnboardingTab = () => {
    const next = nextOnboardingTab(tabsVisited);
    if (next) handleTabChange(next);
  };

  const handleCompleteOnboarding = async () => {
    if (!settings || !allOnboardingTabsVisited(tabsVisited)) return;
    setCompletingOnboarding(true);
    try {
      await save();
      await completeOnboarding(settings.business.id);
      updateSettings((prev) =>
        prev
          ? {
              ...prev,
              business: {
                ...prev.business,
                onboarding_completed: true,
                onboarding_tabs_visited: [...ONBOARDING_TABS],
              },
            }
          : prev,
        { markClean: true },
      );
      toast({
        title: "Setup complete!",
        description: "Your business is ready. Welcome to Qwickly.",
      });
      setLocation("/dashboard");
    } catch (err) {
      toast({
        title: "Could not finish setup",
        description: err instanceof Error ? err.message : "Please try again",
        variant: "destructive",
      });
    } finally {
      setCompletingOnboarding(false);
    }
  };

  const persist = async (key: string, fn: () => Promise<void>) => {
    setPersisting(key);
    try {
      await fn();
    } catch (err) {
      toast({
        title: "Save failed",
        description:
          err instanceof Error ? err.message : "Could not save to Supabase",
        variant: "destructive",
      });
      throw err;
    } finally {
      setPersisting(null);
    }
  };

  const handleSave = async () => {
    try {
      await save();
      if (settings) {
        await Promise.all(
          settings.teamMembers.map((m) =>
            updateTeamMember(m.id, {
              role: m.role,
              perm_bookings: m.perm_bookings,
              perm_clients: m.perm_clients,
              perm_payments: m.perm_payments,
              perm_analytics: m.perm_analytics,
              perm_settings: m.perm_settings,
            }),
          ),
        );
      }
      await reload();
      toast({
        title: "Settings saved",
        description: "Your changes have been updated.",
      });
    } catch (err) {
      toast({
        title: "Save failed",
        description:
          err instanceof Error ? err.message : "Could not save settings",
        variant: "destructive",
      });
    }
  };

  const handleInvite = async () => {
    if (!settings || !inviteName.trim() || !inviteEmail.trim()) return;
    setInviting(true);
    try {
      const member = await inviteTeamMember(settings.business.id, {
        name: inviteName.trim(),
        email: inviteEmail.trim().toLowerCase(),
        role: inviteRole,
        perm_bookings: true,
        perm_clients: inviteRole !== "staff",
        perm_payments: inviteRole === "manager",
        perm_analytics: inviteRole === "manager",
        perm_settings: false,
      });
      updateSettings((prev) => ({
        ...prev,
        teamMembers: [...prev.teamMembers, member],
      }));
      setInviteOpen(false);
      setInviteName("");
      setInviteEmail("");
      setInviteRole("staff");
      toast({
        title: "Team member invited",
        description: `${member.name} was added.`,
      });
    } catch (err) {
      toast({
        title: "Invite failed",
        description:
          err instanceof Error ? err.message : "Could not invite member",
        variant: "destructive",
      });
    } finally {
      setInviting(false);
    }
  };

  const handleRemoveMember = async (member: TeamMember) => {
    if (member.role === "owner") return;
    try {
      await removeTeamMember(member.id);
      updateSettings((prev) => ({
        ...prev,
        teamMembers: prev.teamMembers.filter((m) => m.id !== member.id),
      }));
      toast({ title: "Member removed" });
    } catch (err) {
      toast({
        title: "Remove failed",
        description:
          err instanceof Error ? err.message : "Could not remove member",
        variant: "destructive",
      });
    }
  };

  const handlePasswordUpdate = async () => {
    if (newPassword.length < 8) {
      toast({
        title: "Password too short",
        description: "Use at least 8 characters.",
        variant: "destructive",
      });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: "Passwords don't match", variant: "destructive" });
      return;
    }
    setUpdatingPassword(true);
    try {
      if (currentPassword && user?.email) {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: user.email,
          password: currentPassword,
        });
        if (signInError) {
          toast({
            title: "Current password incorrect",
            variant: "destructive",
          });
          return;
        }
      }
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });
      if (error) throw error;
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast({ title: "Password updated" });
    } catch (err) {
      toast({
        title: "Update failed",
        description:
          err instanceof Error ? err.message : "Could not update password",
        variant: "destructive",
      });
    } finally {
      setUpdatingPassword(false);
    }
  };

  const handleDeleteData = async () => {
    if (
      !settings ||
      !confirm("Delete all business data? This cannot be undone.")
    )
      return;
    try {
      await deleteBusinessData(settings.business.id);
      await reload();
      toast({
        title: "Business data deleted",
        description: "Defaults have been recreated.",
      });
    } catch (err) {
      toast({
        title: "Delete failed",
        description:
          err instanceof Error ? err.message : "Could not delete data",
        variant: "destructive",
      });
    }
  };

  const handleCloseAccount = async () => {
    if (
      !confirm("Permanently close your Qwickly account? This cannot be undone.")
    )
      return;
    try {
      if (settings) await deleteBusinessData(settings.business.id);
      await signOut();
      setLocation("/");
    } catch (err) {
      toast({
        title: "Account closure failed",
        description:
          err instanceof Error ? err.message : "Could not close account",
        variant: "destructive",
      });
    }
  };

  const updateHour = (
    day: Weekday,
    patch: Partial<{ is_open: boolean; open_time: string; close_time: string }>,
  ) => {
    updateSettings((prev) => {
      const operatingHours = prev.operatingHours.map((h) =>
        h.day_name === day ? { ...h, ...patch } : h,
      );
      void persist("hours", () => saveOperatingHours(operatingHours));
      return { ...prev, operatingHours };
    });
  };

  // Sets a notification event's channel (off / whatsapp / email / both) by
  // writing its two boolean columns together in a single save.
  const setEventChannel = (
    waKey: NotificationToggleKey,
    emKey: NotificationToggleKey,
    channel: EventChannel,
  ) => {
    updateSettings((prev) => {
      const notifications = {
        ...prev.notifications,
        [waKey]: channel === "whatsapp" || channel === "both",
        [emKey]: channel === "email" || channel === "both",
      };
      void persist("notifications", () => saveNotificationSettings(notifications));
      return { ...prev, notifications };
    });
  };

  const updateProvider = (
    key: PaymentProviderKey,
    patch: Partial<{ enabled: boolean; connected: boolean }>,
  ) => {
    updateSettings((prev) => {
      const paymentProviders = prev.paymentProviders.map((p) =>
        p.provider_key === key ? { ...p, ...patch } : p,
      );
      void persist("payments", () => savePaymentProviders(paymentProviders));
      return { ...prev, paymentProviders };
    });
  };

  // Booking policy edits the shared settings object (no auto-save) so the
  // floating "Save changes" button appears, like the business-profile fields.
  const updateBookingPolicy = <K extends keyof BookingPolicy>(key: K, value: BookingPolicy[K]) => {
    updateSettings((prev) => ({
      ...prev,
      bookingPolicy: { ...prev.bookingPolicy, [key]: value },
    }));
  };

  const updateTeamMemberLocal = (id: string, patch: Partial<TeamMember>) => {
    updateSettings((prev) => ({
      ...prev,
      teamMembers: prev.teamMembers.map((m) =>
        m.id === id ? { ...m, ...patch } : m,
      ),
    }));
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="flex flex-col gap-6 lg:flex-row">
          <Skeleton className="h-96 w-full lg:w-60" />
          <Skeleton className="h-96 flex-1" />
        </div>
      </div>
    );
  }

  if (error || !settings) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <AlertCircle className="w-10 h-10 text-destructive" />
        <p className="text-muted-foreground text-center max-w-md">
          {error ?? "Could not load settings."} Run{" "}
          <code className="text-xs bg-muted px-1 rounded">
            supabase/migrations/001_settings_schema.sql
          </code>{" "}
          and{" "}
          <code className="text-xs bg-muted px-1 rounded">
            supabase/migrations/002_onboarding.sql
          </code>{" "}
          in Supabase first.
        </p>
        <Button onClick={() => reload()}>Retry</Button>
      </div>
    );
  }

  const { business, operatingHours, notifications, deposits, bookingPolicy } = settings;

  const onboardingProgress = tabsVisited.length;
  const onboardingComplete = allOnboardingTabsVisited(tabsVisited);
  const nextTab = nextOnboardingTab(tabsVisited);

  const sectionMeta: Record<
    OnboardingTabId,
    { title: string; description: string }
  > = {
    profile: {
      title: "Business Profile",
      description: "Business details, public info, and hours",
    },
    booking: {
      title: "Booking",
      description: "Cancellation and reschedule rules",
    },
    notifications: {
      title: "Notifications",
      description: "Client and staff message automation",
    },
    payments: {
      title: "Payments",
      description: "Deposits and payment providers",
    },
    whatsapp: {
      title: "WhatsApp",
      description: "Automation and shared client inbox",
    },
    team: {
      title: "Team",
      description: "Staff logins, roles, and permissions",
    },
    security: {
      title: "Security",
      description: "Account, password, and danger zone",
    },
  };

  const settingsTabs = [
    { value: "profile" as const, icon: Building2 },
    { value: "booking" as const, icon: CalendarClock },
    { value: "notifications" as const, icon: Bell },
    { value: "payments" as const, icon: CreditCard },
    { value: "whatsapp" as const, icon: MessageSquare },
    { value: "team" as const, icon: Users },
    { value: "security" as const, icon: Shield },
  ];

  const activeSectionMeta = sectionMeta[activeTab];
  const ActiveSectionIcon =
    settingsTabs.find((tab) => tab.value === activeTab)?.icon ?? Building2;

  const onboardingPercent = Math.round(
    (onboardingProgress / ONBOARDING_TABS.length) * 100,
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Header — hidden on mobile while a section is open, so it doesn't
          compete with the MobileSectionHeader back control below. Always
          shown on desktop (sidebar + content sit side by side there).
          The onboarding variant carries an inline icon + progress badge that
          doesn't fit PageHeader's string-only title/description shape, so it
          stays hand-rolled; the plain variant maps onto PageHeader directly. */}
      {isOnboarding ? (
        <div
          className={cn(
            "flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between",
            mobileSectionOpen && "hidden md:flex",
          )}
        >
          <div className="min-w-0 space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
                <Sparkles className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl font-bold tracking-tight text-foreground">
                    Set up your business
                  </h1>
                  <Badge variant="secondary" className="shrink-0 text-xs font-medium">
                    {onboardingProgress}/{ONBOARDING_TABS.length}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  Open each section and save your preferences.
                </p>
              </div>
            </div>
            <OnboardingProgressBar percent={onboardingPercent} className="max-w-md" />
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {nextTab && !onboardingComplete && (
              <Button onClick={handleNextOnboardingTab} variant="outline">
                Next: {ONBOARDING_TAB_LABELS[nextTab]}
                <ChevronRight className="ml-1.5 h-4 w-4" />
              </Button>
            )}
            <Button
              onClick={handleCompleteOnboarding}
              disabled={!onboardingComplete || completingOnboarding}
              className="bg-primary hover:bg-primary/90"
            >
              {completingOnboarding && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Finish setup
            </Button>
          </div>
        </div>
      ) : (
        <PageHeader
          title="Settings"
          description="Manage your business profile, automation, payments, team access, and security."
          className={cn(mobileSectionOpen && "hidden md:flex")}
        />
      )}

      <Tabs
        value={activeTab}
        onValueChange={handleTabChange}
        className="flex flex-col gap-4 md:grid md:gap-6 md:grid-cols-[240px_minmax(0,1fr)]"
      >
        {/* Mobile section menu (below md) */}
        {!mobileSectionOpen && (
          <div className="relative -mx-4 overflow-hidden bg-background px-4 pb-2 pt-1 md:hidden">
            <div className="relative space-y-4">
              <SettingsPanel className="rounded-[1.5rem] p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-primary/15 bg-primary/10 text-lg font-bold text-primary shadow-inner">
                    {(business.business_name || user?.email || "Q").slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base font-semibold text-foreground">
                      {business.business_name || "Your business"}
                    </p>
                    <p className="truncate text-sm text-muted-foreground">
                      {business.email || user?.email || "Account settings"}
                    </p>
                  </div>
                  {isOnboarding && (
                    <Badge variant="secondary" className="shrink-0 rounded-full text-xs font-semibold">
                      {onboardingProgress}/{ONBOARDING_TABS.length}
                    </Badge>
                  )}
                </div>

                {isOnboarding && (
                  <OnboardingProgressBar
                    percent={onboardingPercent}
                    className="mt-4"
                  />
                )}
              </SettingsPanel>

              <div className="grid grid-cols-2 gap-3">
                {[
                  { value: "payments" as const, label: "Payments", helper: "Deposits", icon: CreditCard },
                  { value: "profile" as const, label: "Public booking", helper: "Page details", icon: Globe },
                ].map(({ value, label, helper, icon: Icon }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      void handleTabChange(value);
                      setMobileSectionOpen(true);
                    }}
                    className="min-h-32 rounded-[1.35rem] border border-border/55 bg-card/80 p-4 text-left shadow-[0_1px_2px_hsl(var(--foreground)/0.04)] backdrop-blur-xl transition-colors active:bg-muted/35"
                  >
                    <div className="mb-7 flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                      <Icon className="h-5 w-5" />
                    </div>
                    <p className="text-base font-semibold text-foreground">{label}</p>
                    <p className="text-sm text-muted-foreground">{helper}</p>
                  </button>
                ))}
              </div>

              <SettingsPanel className="overflow-hidden rounded-[1.5rem]">
                {settingsTabs.map(({ value, icon: Icon }, index) => {
                  const meta = sectionMeta[value];
                  const visited = tabsVisited.includes(value);
                  const isTeam = value === "team";
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => {
                        void handleTabChange(value);
                        setMobileSectionOpen(true);
                      }}
                      className={cn(
                        "flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left transition-colors active:bg-muted/35",
                        index > 0 && "border-t border-border/45",
                      )}
                    >
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-muted/70 text-primary shadow-inner">
                        <Icon className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-base font-semibold text-foreground">
                            {meta.title}
                          </span>
                          {isTeam ? (
                            <Badge variant="secondary" className="rounded-full text-[10px] font-medium">
                              Soon
                            </Badge>
                          ) : isOnboarding && visited ? (
                            <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
                          ) : null}
                        </div>
                        <p className="truncate text-sm text-muted-foreground">
                          {meta.description}
                        </p>
                      </div>
                      <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground/80" />
                    </button>
                  );
                })}
              </SettingsPanel>
            </div>
          </div>
        )}

        {/* Mobile section header (below md, when a section is open) */}
        {mobileSectionOpen && (
          <MobileSectionHeader
            backLabel="Settings"
            onBack={() => setMobileSectionOpen(false)}
            icon={ActiveSectionIcon}
            title={activeSectionMeta.title}
            description={activeSectionMeta.description}
            className="md:hidden"
          />
        )}

        {/* Desktop settings navigation (md and up) */}
        <aside className="hidden md:sticky md:top-6 md:block md:self-start">
          <TabsList className="flex h-auto w-full flex-col items-stretch justify-start gap-1 rounded-2xl border-none bg-transparent p-0">
            {settingsTabs.map(({ value, icon: Icon }) => {
              const visited = tabsVisited.includes(value);
              const isTeam = value === "team";
              return (
                <TabsTrigger
                  key={value}
                  value={value}
                  className="group w-full justify-start gap-2.5 whitespace-nowrap rounded-lg border border-transparent px-3 py-2.5 text-sm font-medium transition-colors hover:bg-muted/60 data-[state=active]:border-primary/20 data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none"
                >
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground group-data-[state=active]:text-primary" />
                  <span className="flex-1 text-left">
                    {ONBOARDING_TAB_LABELS[value]}
                  </span>
                  {isTeam ? (
                    <Badge
                      variant="secondary"
                      className="ml-1 text-[10px] font-medium"
                    >
                      Soon
                    </Badge>
                  ) : isOnboarding ? (
                    visited ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
                    ) : (
                      <Circle className="h-4 w-4 shrink-0 text-muted-foreground/40" />
                    )
                  ) : null}
                </TabsTrigger>
              );
            })}
          </TabsList>

          {isOnboarding && (
            <div className="mt-4 rounded-xl border border-border/60 bg-muted/30 p-4">
              <p className="text-sm leading-relaxed text-muted-foreground">
                {onboardingComplete
                  ? "All sections reviewed. Finish setup to open your dashboard."
                  : `${ONBOARDING_TABS.length - onboardingProgress} section${ONBOARDING_TABS.length - onboardingProgress === 1 ? "" : "s"} left — use Next or pick a tab with an empty circle.`}
              </p>
            </div>
          )}
        </aside>

        {/* Settings content — always on md; on mobile only when a section is open */}
        <div
          className={cn(
            "min-w-0",
            !mobileSectionOpen && "hidden md:block",
            mobileSectionOpen && "duration-300 ease-out animate-in fade-in slide-in-from-right-3 md:animate-none",
          )}
        >
          {/* Business Profile */}
          <TabsContent value="profile" className="m-0 space-y-6">
            <SettingsPanel>
              <CardHeader className="flex flex-row items-start gap-3 p-4 pb-2 md:p-5">
                <div className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/15 bg-primary/10 text-primary md:flex">
                  <Building2 className="h-4 w-4" />
                </div>
                <div>
                  <CardTitle className="text-base md:text-lg">Business details</CardTitle>
                  <CardDescription className="text-sm">
                    Core information about your business.
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 p-4 pt-2 md:p-5 md:pt-0">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="text-sm">Business name</Label>
                    <Input
                      value={business.business_name}
                      onChange={(e) =>
                        updateSettings((p) => ({
                          ...p,
                          business: {
                            ...p.business,
                            business_name: e.target.value,
                          },
                        }))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm">Industry</Label>
                    <Select
                      value={business.industry}
                      onValueChange={(v) =>
                        updateSettings((p) => ({
                          ...p,
                          business: { ...p.business, industry: v },
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {INDUSTRIES.map((i) => (
                          <SelectItem key={i.value} value={i.value} className="text-sm">
                            {i.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="text-sm">Phone number</Label>
                    <Input
                      value={business.phone}
                      onChange={(e) =>
                        updateSettings((p) => ({
                          ...p,
                          business: { ...p.business, phone: e.target.value },
                        }))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm">Email address</Label>
                    <Input
                      type="email"
                      value={business.email}
                      onChange={(e) =>
                        updateSettings((p) => ({
                          ...p,
                          business: { ...p.business, email: e.target.value },
                        }))
                      }
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-sm">Business description</Label>
                  <Textarea
                    ref={businessDescriptionRef}
                    rows={3}
                    maxLength={BUSINESS_DESCRIPTION_MAX_LENGTH}
                    className="min-h-36 resize-none overflow-hidden md:min-h-24"
                    value={business.description}
                    onChange={(e) =>
                      updateSettings((p) => ({
                        ...p,
                        business: { ...p.business, description: e.target.value },
                      }))
                    }
                  />
                  <p className="text-right text-xs text-muted-foreground">
                    {business.description.length}/{BUSINESS_DESCRIPTION_MAX_LENGTH}
                  </p>
                </div>
              </CardContent>
            </SettingsPanel>

            <CustomDomainManager />

            <SettingsPanel>
              <CardHeader className="flex flex-row items-start gap-3 p-4 pb-2 md:p-5">
                <div className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/15 bg-primary/10 text-primary md:flex">
                  <Globe className="h-4 w-4" />
                </div>
                <div>
                  <CardTitle className="text-base md:text-lg">Public information</CardTitle>
                  <CardDescription className="text-sm">
                    Details shown to clients on your public pages.
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="p-4 pt-2 md:p-5 md:pt-0">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="text-sm">Physical address</Label>
                    <Input
                      value={business.address}
                      onChange={(e) =>
                        updateSettings((p) => ({
                          ...p,
                          business: { ...p.business, address: e.target.value },
                        }))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm">Website URL</Label>
                    <Input
                      value={business.website_url}
                      onChange={(e) =>
                        updateSettings((p) => ({
                          ...p,
                          business: {
                            ...p.business,
                            website_url: e.target.value,
                          },
                        }))
                      }
                    />
                  </div>
                </div>
              </CardContent>
            </SettingsPanel>

            <SettingsPanel>
              <CardHeader className="flex flex-row items-start gap-3 p-4 pb-2 md:p-5">
                <div className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/15 bg-primary/10 text-primary md:flex">
                  <Clock className="h-4 w-4" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-base md:text-lg">Operating hours</CardTitle>
                    {persisting === "hours" && (
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
                    )}
                  </div>
                  <CardDescription className="text-sm">
                    Your standard weekly availability. Changes save automatically.
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="p-4 pt-2 md:p-5 md:pt-0">
                <SettingsGroup>
                  {WEEKDAYS.map((day) => {
                    const hour = operatingHours.find((h) => h.day_name === day);
                    if (!hour) return null;
                    const hoursBusy = persisting === "hours";
                    return (
                      <SettingsRow key={day} title={WEEKDAY_LABELS[day]}>
                        <div className="flex items-center gap-3">
                          <Switch
                            checked={hour.is_open}
                            disabled={hoursBusy}
                            onCheckedChange={(v) => updateHour(day, { is_open: v })}
                            className="shrink-0"
                          />
                          {hour.is_open ? (
                            <div className="flex items-center gap-2">
                              <Input
                                type="time"
                                value={hour.open_time}
                                disabled={hoursBusy}
                                onChange={(e) =>
                                  updateHour(day, { open_time: e.target.value })
                                }
                                className="h-9 w-32 bg-muted/50 text-center text-sm"
                              />
                              <span className="text-sm text-muted-foreground">–</span>
                              <Input
                                type="time"
                                value={hour.close_time}
                                disabled={hoursBusy}
                                onChange={(e) =>
                                  updateHour(day, { close_time: e.target.value })
                                }
                                className="h-9 w-32 bg-muted/50 text-center text-sm"
                              />
                            </div>
                          ) : (
                            <span className="text-sm italic text-muted-foreground">
                              Closed
                            </span>
                          )}
                        </div>
                      </SettingsRow>
                    );
                  })}
                </SettingsGroup>
              </CardContent>
            </SettingsPanel>
          </TabsContent>

          {/* Booking */}
          <TabsContent value="booking" className="m-0 space-y-6">
            <SettingsPanel>
              <CardHeader className="flex flex-row items-start gap-3 p-4 pb-2 md:p-5">
                <div className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/15 bg-primary/10 text-primary md:flex">
                  <CalendarClock className="h-4 w-4" />
                </div>
                <div className="flex-1">
                  <CardTitle className="text-base md:text-lg">Cancellation &amp; reschedule rules</CardTitle>
                  <CardDescription className="text-sm">
                    How long before an appointment a client can cancel or reschedule online. Applies to
                    the booking page and the WhatsApp assistant.
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 p-4 pt-2 md:p-5 md:pt-0">
                <SettingsGroup>
                  <SettingsToggleRow
                    title="Allow online cancellations"
                    description="Clients can cancel from the booking page or WhatsApp assistant."
                    checked={bookingPolicy.acceptCancellations}
                    onCheckedChange={(v) => updateBookingPolicy("acceptCancellations", v)}
                  />
                  {bookingPolicy.acceptCancellations && (
                    <div className="border-t border-border/45 duration-200 animate-in fade-in slide-in-from-top-1">
                      <SettingsRow
                        title="Minimum cancellation notice"
                        description="Use 0 to allow cancellation any time before the appointment."
                      >
                        <SettingsNumberUnitField
                          value={bookingPolicy.cancellationMinNoticeHours}
                          unit="hours"
                          onChange={(v) => updateBookingPolicy("cancellationMinNoticeHours", v)}
                        />
                      </SettingsRow>
                      <div className="border-t border-border/45 px-4 py-4">
                        <div className="space-y-2">
                          <Label className="text-sm font-semibold">
                            Message when cancellation is unavailable
                          </Label>
                          <Textarea
                            rows={2}
                            value={bookingPolicy.cancellationDeclineMessage}
                            onChange={(e) => updateBookingPolicy("cancellationDeclineMessage", e.target.value)}
                            placeholder="Example: This booking is too close to the appointment time. Please contact us directly."
                          />
                          <p className="text-xs leading-relaxed text-muted-foreground">
                            Optional. Used by the WhatsApp assistant when a cancellation is declined.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </SettingsGroup>

                <SettingsGroup>
                  <SettingsToggleRow
                    title="Allow online reschedules"
                    description="Clients can move their appointment without contacting you first."
                    checked={bookingPolicy.acceptReschedules}
                    onCheckedChange={(v) => updateBookingPolicy("acceptReschedules", v)}
                  />
                  {bookingPolicy.acceptReschedules && (
                    <div className="border-t border-border/45 duration-200 animate-in fade-in slide-in-from-top-1">
                      <SettingsRow
                        title="Minimum reschedule notice"
                        description="Use 0 to allow rescheduling any time before the appointment."
                      >
                        <SettingsNumberUnitField
                          value={bookingPolicy.rescheduleMinNoticeHours}
                          unit="hours"
                          onChange={(v) => updateBookingPolicy("rescheduleMinNoticeHours", v)}
                        />
                      </SettingsRow>
                      <div className="border-t border-border/45 px-4 py-4">
                        <div className="space-y-2">
                          <Label className="text-sm font-semibold">
                            Message when rescheduling is unavailable
                          </Label>
                          <Textarea
                            rows={2}
                            value={bookingPolicy.rescheduleDeclineMessage}
                            onChange={(e) => updateBookingPolicy("rescheduleDeclineMessage", e.target.value)}
                            placeholder="Example: This booking can no longer be rescheduled online. Please contact us directly."
                          />
                          <p className="text-xs leading-relaxed text-muted-foreground">
                            Optional. Used by the WhatsApp assistant when a reschedule is declined.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </SettingsGroup>
              </CardContent>
            </SettingsPanel>
          </TabsContent>

          {/* Notifications */}
          <TabsContent value="notifications" className="m-0 space-y-6">
            <SettingsPanel>
              <CardHeader className="flex flex-row items-start gap-3 p-4 pb-2 md:p-5">
                <div className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/15 bg-primary/10 text-primary md:flex">
                  <Bell className="h-4 w-4" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-base md:text-lg">Client notifications</CardTitle>
                    {persisting === "notifications" && (
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
                    )}
                  </div>
                  <CardDescription className="text-sm">
                    Automatic messages to clients. WhatsApp reaches clients who&rsquo;ve messaged you;
                    email reaches clients with an email address. Changes save automatically.
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="p-4 pt-2 md:p-5 md:pt-0">
                <SettingsGroup>
                  {[
                    {
                      wa: "booking_confirmations" as const,
                      em: "booking_confirmations_email" as const,
                      label: "Booking confirmation",
                      description: "Send when an appointment is booked.",
                    },
                    {
                      wa: "reminder_24h" as const,
                      em: "reminder_24h_email" as const,
                      label: "24-hour reminder",
                      description: "Remind clients the day before their appointment.",
                    },
                    {
                      wa: "reminder_2h" as const,
                      em: "reminder_2h_email" as const,
                      label: "2-hour reminder",
                      description: "Send a short reminder close to the appointment time.",
                    },
                    {
                      wa: "review_requests" as const,
                      em: "review_requests_email" as const,
                      label: "Review request",
                      description: "Ask for feedback after the appointment.",
                    },
                    {
                      wa: "cancellation_notices" as const,
                      em: "cancellation_notices_email" as const,
                      label: "Cancellation notice",
                      description: "Tell clients when a booking is cancelled.",
                    },
                    {
                      wa: "rescheduling_alerts" as const,
                      em: "rescheduling_alerts_email" as const,
                      label: "Reschedule notice",
                      description: "Tell clients when their appointment moves.",
                    },
                  ].map((item) => (
                    <EventChannelRow
                      key={item.wa}
                      label={item.label}
                      description={item.description}
                      whatsapp={notifications[item.wa]}
                      email={notifications[item.em]}
                      defaultChannel="both"
                      disabled={persisting === "notifications"}
                      onChange={(c) => setEventChannel(item.wa, item.em, c)}
                    />
                  ))}
                </SettingsGroup>
              </CardContent>
            </SettingsPanel>

            <SettingsPanel>
              <CardHeader className="flex flex-row items-start gap-3 p-4 pb-2 md:p-5">
                <div className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/15 bg-primary/10 text-primary md:flex">
                  <Users className="h-4 w-4" />
                </div>
                <div>
                  <CardTitle className="text-base md:text-lg">Staff notifications</CardTitle>
                  <CardDescription className="text-sm">
                    Alerts to your team. Email is the reliable channel for staff; WhatsApp is optional.
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 p-4 pt-2 md:p-5 md:pt-0">
                <SettingsGroup>
                  {[
                    {
                      wa: "staff_new_booking" as const,
                      em: "staff_new_booking_email" as const,
                      label: "New booking",
                      description: "Notify the assigned staff member.",
                    },
                    {
                      wa: "staff_reschedule" as const,
                      em: "staff_reschedule_email" as const,
                      label: "Rescheduled booking",
                      description: "Notify staff when an appointment moves.",
                    },
                    {
                      wa: "staff_cancellation" as const,
                      em: "staff_cancellation_email" as const,
                      label: "Cancelled booking",
                      description: "Notify staff when a booking is cancelled.",
                    },
                    {
                      wa: "staff_daily_summary" as const,
                      em: "staff_daily_summary_email" as const,
                      label: "Daily schedule",
                      description: "Send each staff member their schedule summary.",
                    },
                  ].map((item) => (
                    <EventChannelRow
                      key={item.wa}
                      label={item.label}
                      description={item.description}
                      whatsapp={notifications[item.wa]}
                      email={notifications[item.em]}
                      defaultChannel="email"
                      disabled={persisting === "notifications"}
                      onChange={(c) => setEventChannel(item.wa, item.em, c)}
                    />
                  ))}
                </SettingsGroup>
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-400">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    WhatsApp alerts only reach a staff member once they&rsquo;ve messaged your WhatsApp
                    number first. Email works for any staff member with an email address on file.
                  </span>
                </div>
              </CardContent>
            </SettingsPanel>
          </TabsContent>

          {/* Payments */}
          <TabsContent value="payments" className="m-0 space-y-6">
            <SettingsPanel>
              <CardHeader className="flex flex-row items-start gap-3 p-4 pb-2 md:p-5">
                <div className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/15 bg-primary/10 text-primary md:flex">
                  <CreditCard className="h-4 w-4" />
                </div>
                <div className="flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="text-base md:text-lg">Deposit settings</CardTitle>
                    <Badge
                      variant={deposits.require_deposit ? "default" : "secondary"}
                      className="text-xs"
                    >
                      {deposits.require_deposit ? "Deposits enabled" : "Optional"}
                    </Badge>
                  </div>
                  <CardDescription className="text-sm">
                    Collect upfront deposits for online bookings.
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 p-4 pt-2 md:p-5 md:pt-0">
                <SettingsGroup>
                  <SettingsToggleRow
                    title="Require deposits"
                    description="Clients pay before their appointment is confirmed online."
                    checked={deposits.require_deposit}
                    onCheckedChange={(v) =>
                      updateSettings((p) => ({
                        ...p,
                        deposits: { ...p.deposits, require_deposit: v },
                      }))
                    }
                  />
                  <SettingsRow
                    title="Deposit type"
                    description={
                      deposits.deposit_type === "percentage"
                        ? "Best when service prices vary."
                        : "Best when every booking uses the same upfront amount."
                    }
                    className="border-t"
                  >
                    <Select
                      value={deposits.deposit_type}
                      onValueChange={(v: "percentage" | "fixed") =>
                        updateSettings((p) => ({
                          ...p,
                          deposits: { ...p.deposits, deposit_type: v },
                        }))
                      }
                    >
                      <SelectTrigger className="sm:w-56">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="percentage" className="text-sm">
                          Percentage
                        </SelectItem>
                        <SelectItem value="fixed" className="text-sm">
                          Fixed amount
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </SettingsRow>
                  <SettingsRow
                    title="Deposit amount"
                    description="Applied as the default deposit on new online bookings."
                    className="border-t"
                  >
                    <div className="relative sm:w-48">
                      {deposits.deposit_type === "fixed" && (
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                          R
                        </span>
                      )}
                      <Input
                        type="number"
                        min="0"
                        className={cn(
                          "w-full",
                          deposits.deposit_type === "fixed" ? "pl-7" : "pr-8",
                        )}
                        value={deposits.deposit_amount}
                        onChange={(e) =>
                          updateSettings((p) => ({
                            ...p,
                            deposits: {
                              ...p.deposits,
                              deposit_amount: Number(e.target.value),
                            },
                          }))
                        }
                      />
                      {deposits.deposit_type === "percentage" && (
                        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                          %
                        </span>
                      )}
                    </div>
                  </SettingsRow>
                </SettingsGroup>
              </CardContent>
            </SettingsPanel>

            <SettingsPanel>
              <CardHeader className="flex flex-row items-start gap-3 p-4 pb-2 md:p-5">
                <div className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/15 bg-primary/10 text-primary md:flex">
                  <CreditCard className="h-4 w-4" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-base md:text-lg">Payment providers</CardTitle>
                    {persisting === "payments" && (
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
                    )}
                  </div>
                  <CardDescription className="text-sm">
                    PayFast is available now. More payment methods are coming soon.
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="p-4 pt-2 md:p-5 md:pt-0">
                <SettingsGroup>
                  {PAYMENT_PROVIDERS.map((meta, index) => {
                    const p = getProviderSetting(
                      settings.paymentProviders,
                      meta.key,
                    );
                    if (!p) return null;
                    const isAvailable = meta.key === "payfast";
                    const paymentsBusy = persisting === "payments";
                    return (
                      <SettingsRow
                        key={meta.key}
                        title={meta.name}
                        description={meta.desc}
                        className={cn(index > 0 && "border-t")}
                      >
                        <div className="flex items-center gap-3">
                          {!isAvailable ? (
                            <Badge variant="secondary" className="rounded-full text-[10px]">
                              Soon
                            </Badge>
                          ) : p.connected ? (
                            <Badge className="rounded-full border border-primary/20 bg-primary/10 text-[10px] text-primary">
                              Connected
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="rounded-full text-[10px]">
                              Not set up
                            </Badge>
                          )}
                          <Switch
                            checked={isAvailable && p.enabled}
                            disabled={!isAvailable || paymentsBusy}
                            onCheckedChange={(v) =>
                              updateProvider(meta.key, {
                                enabled: v,
                                connected: v ? true : p.connected,
                              })
                            }
                            className="shrink-0"
                          />
                          {isAvailable && !p.connected && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={paymentsBusy}
                              onClick={() =>
                                updateProvider(meta.key, {
                                  connected: true,
                                  enabled: true,
                                })
                              }
                            >
                              Connect
                            </Button>
                          )}
                        </div>
                      </SettingsRow>
                    );
                  })}
                </SettingsGroup>
              </CardContent>
            </SettingsPanel>
          </TabsContent>

          {/* WhatsApp */}
          <TabsContent value="whatsapp" className="m-0 space-y-6">
            {loadingSubscription ? (
              <Card className="border-border/60 shadow-none">
                <CardHeader className="border-b border-border/60">
                  <Skeleton className="h-5 w-44" />
                  <Skeleton className="h-4 w-72 max-w-full" />
                </CardHeader>
                <CardContent className="space-y-5 p-5">
                  <div className="grid gap-3 md:grid-cols-3">
                    <Skeleton className="h-28 rounded-xl" />
                    <Skeleton className="h-28 rounded-xl" />
                    <Skeleton className="h-28 rounded-xl" />
                  </div>
                  <Skeleton className="h-10 w-44 rounded-md" />
                  <Skeleton className="h-[320px] rounded-xl" />
                </CardContent>
              </Card>
            ) : !whatsappEnabled ? (
              <Card className="relative mx-auto max-w-lg overflow-hidden border-border/60 shadow-none">
                <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-amber-500/10 to-transparent" />
                <CardContent className="relative p-8 text-center">
                  <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-amber-200 bg-amber-100">
                    <Lock className="h-8 w-8 text-amber-600" />
                  </div>
                  <Badge
                    variant="outline"
                    className="mb-3 rounded-full border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700"
                  >
                    <Lock className="mr-1 h-3 w-3" /> Premium feature
                  </Badge>
                  <h2 className="text-xl font-bold text-foreground">
                    WhatsApp automation is locked
                  </h2>
                  <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
                    WhatsApp automation and inbox isn't included in your current plan.
                    Upgrade to unlock automated confirmations, reminders, and a shared client inbox.
                  </p>
                  <Button className="mt-6" asChild>
                    <a href="/billing">
                      Upgrade plan <ArrowRight className="ml-2 h-4 w-4" />
                    </a>
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="min-w-0">
                <WhatsappConnectionManager />
              </div>
            )}
          </TabsContent>

          {/* Team — Coming soon */}
          <TabsContent value="team" className="m-0 space-y-6">
            <Card className="relative overflow-hidden border-border/60 shadow-none">
              <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-primary/10 to-transparent" />
              <CardContent className="relative p-6 sm:p-8">
                <div className="flex flex-col items-center text-center">
                  <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary">
                    <Users className="h-8 w-8" />
                  </div>
                  <Badge
                    variant="outline"
                    className="mb-3 rounded-full border-primary/20 bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary"
                  >
                    <Sparkles className="mr-1 h-3 w-3" /> Coming soon
                  </Badge>
                  <h2 className="text-2xl font-bold text-foreground">Team Management</h2>
                  <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                    Soon you'll be able to invite staff, assign roles, and control what each person can access.
                  </p>
                </div>

                <div className="mx-auto mt-6 grid max-w-lg grid-cols-1 gap-2 sm:grid-cols-2">
                  {[
                    "Staff logins",
                    "Manager and staff roles",
                    "Permission controls",
                    "Staff booking visibility",
                    "Team notifications",
                  ].map((feature) => (
                    <InfoTile key={feature} className="flex items-center gap-2 text-sm">
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
                      <span className="font-medium text-foreground">{feature}</span>
                    </InfoTile>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Security */}
          <TabsContent value="security" className="m-0 space-y-6">
            <SettingsPanel>
              <CardHeader className="flex flex-row items-start gap-3 p-4 pb-2 md:p-5">
                <div className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/15 bg-primary/10 text-primary md:flex">
                  <Shield className="h-4 w-4" />
                </div>
                <div>
                  <CardTitle className="text-base md:text-lg">Account</CardTitle>
                  <CardDescription className="text-sm">
                    Your login details from Supabase Auth.
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="p-4 pt-2 md:p-5 md:pt-0">
                <SettingsGroup>
                  <SettingsRow title="Email">
                    <span className="text-sm font-medium">{user?.email ?? "—"}</span>
                  </SettingsRow>
                  <SettingsRow title="Member since">
                    <span className="text-sm font-medium">
                      {user?.created_at
                        ? new Date(user.created_at).toLocaleDateString()
                        : "—"}
                    </span>
                  </SettingsRow>
                  <SettingsRow title="Last sign in">
                    <span className="text-sm font-medium">
                      {user?.last_sign_in_at
                        ? new Date(user.last_sign_in_at).toLocaleString()
                        : "—"}
                    </span>
                  </SettingsRow>
                </SettingsGroup>
              </CardContent>
            </SettingsPanel>

            <SettingsPanel>
              <CardHeader className="flex flex-row items-start gap-3 p-4 pb-2 md:p-5">
                <div className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/15 bg-primary/10 text-primary md:flex">
                  <KeyRound className="h-4 w-4" />
                </div>
                <div>
                  <CardTitle className="text-base md:text-lg">Change password</CardTitle>
                  <CardDescription className="text-sm">
                    Update your account password.
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 p-4 pt-2 md:p-5 md:pt-0">
                <div className="space-y-2">
                  <Label className="text-sm">Current password</Label>
                  <Input
                    type="password"
                    placeholder="••••••••••"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="text-sm">New password</Label>
                    <Input
                      type="password"
                      placeholder="Min 8 characters"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm">Confirm new password</Label>
                    <Input
                      type="password"
                      placeholder="••••••••••"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                    />
                  </div>
                </div>
                <Button
                  className="bg-primary hover:bg-primary/90 w-full sm:w-auto"
                  onClick={handlePasswordUpdate}
                  disabled={updatingPassword}
                >
                  {updatingPassword && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Update password
                </Button>
              </CardContent>
            </SettingsPanel>

            <SettingsPanel className="border-destructive/20 md:border-destructive/30">
              <CardHeader className="flex flex-row items-start gap-3 p-4 pb-2 md:p-5">
                <div className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-destructive/20 bg-destructive/10 text-destructive md:flex">
                  <AlertCircle className="h-4 w-4" />
                </div>
                <div>
                  <CardTitle className="text-base text-destructive md:text-lg">Danger zone</CardTitle>
                  <CardDescription className="text-sm">
                    Irreversible actions.
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 p-4 pt-2 md:p-5 md:pt-0">
                <div className="flex flex-col gap-3 rounded-xl border border-destructive/20 bg-destructive/5 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-0.5">
                    <Label className="text-sm font-semibold text-destructive">
                      Delete all data
                    </Label>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      Delete business profile and settings. Account remains.
                    </p>
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="w-full sm:w-auto"
                    onClick={handleDeleteData}
                  >
                    Delete data
                  </Button>
                </div>
                <div className="flex flex-col gap-3 rounded-xl border border-destructive/20 bg-destructive/5 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-0.5">
                    <Label className="text-sm font-semibold text-destructive">
                      Close account
                    </Label>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      Sign out and remove your business data.
                    </p>
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="w-full sm:w-auto"
                    onClick={handleCloseAccount}
                  >
                    Close account
                  </Button>
                </div>
              </CardContent>
            </SettingsPanel>
          </TabsContent>
        </div>
      </Tabs>

      {hasUnsavedChanges && (
        <div className="fixed inset-x-4 bottom-4 z-50 sm:inset-x-auto sm:bottom-6 sm:right-6">
          <Button
            className="h-14 w-full rounded-2xl bg-primary px-5 text-base text-white shadow-lg shadow-primary/20 duration-200 ease-out animate-in fade-in slide-in-from-bottom-2 hover:bg-primary/90 sm:h-11 sm:w-auto sm:rounded-full sm:text-sm"
            onClick={() => void handleSave()}
            disabled={saving}
          >
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                Save changes
              </>
            )}
          </Button>
        </div>
      )}

      {/* Invite dialog kept for future team management (not currently triggered) */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite team member</DialogTitle>
            <DialogDescription>
              Add a new member to your business dashboard.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
                placeholder="Full name"
              />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="email@business.com"
              />
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select
                value={inviteRole}
                onValueChange={(v: TeamMember["role"]) => setInviteRole(v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manager">Manager</SelectItem>
                  <SelectItem value="staff">Staff</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleInvite} disabled={inviting}>
              {inviting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Send Invite
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// A notification event row: a master on/off toggle + action sentence, and a
// WhatsApp / Email / Both single-select. Maps to the event's two
// boolean columns (off = both false, both = both true).
function EventChannelRow({
  label,
  description,
  whatsapp,
  email,
  defaultChannel = "both",
  disabled,
  onChange,
}: {
  label: string;
  description?: string;
  whatsapp: boolean;
  email: boolean;
  defaultChannel?: "whatsapp" | "email" | "both";
  disabled?: boolean;
  onChange: (channel: EventChannel) => void;
}) {
  const on = whatsapp || email;
  const selected: "whatsapp" | "email" | "both" =
    on ? (whatsapp && email ? "both" : email ? "email" : "whatsapp") : defaultChannel;
  const options: { value: "whatsapp" | "email" | "both"; label: string }[] = [
    { value: "whatsapp", label: "WhatsApp" },
    { value: "email", label: "Email" },
    { value: "both", label: "Both" },
  ];

  return (
    <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-3 border-t border-border/45 px-4 py-4 first:border-t-0 md:grid-cols-[auto_minmax(0,1fr)_auto] md:gap-4">
      <Switch
        checked={on}
        disabled={disabled}
        onCheckedChange={(v) => onChange(v ? defaultChannel : "off")}
        className="shrink-0"
      />
      <div className="min-w-0">
        <span className="block text-sm font-semibold leading-snug text-foreground">
          {label}
        </span>
        {description && (
          <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      <SettingsSegmentedControl
        value={selected}
        options={options}
        disabled={disabled || !on}
        onChange={onChange}
        className={cn(
          "col-span-2 mx-auto w-full max-w-72 transition-all duration-200 md:col-span-1 md:mx-0 md:w-auto md:max-w-none",
          on ? "max-h-12 opacity-100" : "max-h-0 overflow-hidden p-0 opacity-0 md:max-h-12 md:p-1 md:opacity-100",
        )}
      />
    </div>
  );
}

