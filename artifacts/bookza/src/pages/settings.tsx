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
  ChevronLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
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
import {
  INDUSTRIES,
  PAYMENT_PROVIDERS,
  WEEKDAY_LABELS,
  WEEKDAYS,
  type PaymentProviderKey,
  type NotificationSettings,
  type TeamMember,
  type Weekday,
  type WhatsappSettings,
} from "@/types/settings";

type NotificationToggleKey = Exclude<keyof NotificationSettings, "business_id">;
const BUSINESS_DESCRIPTION_MAX_LENGTH = 500;

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

  // Check if WhatsApp is enabled in subscription
  const whatsappEnabled = Boolean(
    (subscription as any)?.metadata?.whatsappEnabled ||
    (subscription as any)?.plans?.metadata?.whatsappEnabled,
  );
  // Email reminders are a plan entitlement (metadata.emailReminders), gated the
  // same way as WhatsApp. Hides the toggle unless the plan includes it.
  const emailRemindersEnabled = Boolean(
    (subscription as any)?.metadata?.emailReminders ||
    (subscription as any)?.plans?.metadata?.emailReminders,
  );
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

  const updateNotification = (key: NotificationToggleKey, value: boolean) => {
    updateSettings((prev) => {
      const notifications = { ...prev.notifications, [key]: value };
      void persist("notifications", () =>
        saveNotificationSettings(notifications),
      );
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

  const { business, operatingHours, notifications, deposits } = settings;

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
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          {isOnboarding ? (
            <div className="space-y-3">
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
              <div className="flex items-center gap-3 max-w-md">
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-300"
                    style={{ width: `${onboardingPercent}%` }}
                  />
                </div>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {onboardingPercent}%
                </span>
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
                Settings
              </h1>
              <p className="text-sm text-muted-foreground">
                Manage your business profile, automation, payments, team access, and security.
              </p>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {isOnboarding && nextTab && !onboardingComplete && (
            <Button onClick={handleNextOnboardingTab} variant="outline">
              Next: {ONBOARDING_TAB_LABELS[nextTab]}
              <ChevronRight className="ml-1.5 h-4 w-4" />
            </Button>
          )}
          {isOnboarding && (
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
          )}
        </div>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={handleTabChange}
        className="flex flex-col gap-4 md:grid md:gap-6 md:grid-cols-[240px_minmax(0,1fr)]"
      >
        {/* Mobile section menu (below md) */}
        {!mobileSectionOpen && (
          <div className="divide-y divide-border/60 md:hidden">
            {settingsTabs.map(({ value, icon: Icon }) => {
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
                  className="flex w-full items-center gap-3 px-1 py-4 text-left transition-colors hover:bg-muted/40"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-primary">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">
                        {meta.title}
                      </span>
                      {isTeam ? (
                        <Badge variant="secondary" className="text-[10px] font-medium">
                          Coming soon
                        </Badge>
                      ) : isOnboarding && visited ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
                      ) : null}
                    </div>
                    <p className="truncate text-sm text-muted-foreground">
                      {meta.description}
                    </p>
                  </div>
                  <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
                </button>
              );
            })}
          </div>
        )}

        {/* Mobile section header (below md, when a section is open) */}
        {mobileSectionOpen && (
          <div className="duration-200 ease-out animate-in fade-in slide-in-from-left-2 md:hidden">
            <button
              type="button"
              onClick={() => setMobileSectionOpen(false)}
              className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <ChevronLeft className="h-4 w-4" />
              Settings
            </button>
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-primary">
                <ActiveSectionIcon className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-foreground">
                  {activeSectionMeta.title}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {activeSectionMeta.description}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Desktop settings navigation (md and up) */}
        <aside className="hidden md:sticky md:top-6 md:block md:self-start">
          <TabsList className="flex h-auto w-full flex-col items-stretch justify-start gap-1 bg-transparent p-0">
            {settingsTabs.map(({ value, icon: Icon }) => {
              const visited = tabsVisited.includes(value);
              const isTeam = value === "team";
              return (
                <TabsTrigger
                  key={value}
                  value={value}
                  className="group w-full justify-start gap-2.5 whitespace-nowrap rounded-lg border border-transparent px-3 py-2.5 text-sm font-medium transition-colors hover:bg-muted/60 data-[state=active]:border-border/60 data-[state=active]:bg-muted data-[state=active]:shadow-sm"
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
            <Card className="border-0 bg-transparent shadow-none md:border-border/60 md:bg-card md:shadow-sm">
              <CardHeader className="flex flex-row items-start gap-3 p-0 pb-4 md:p-5">
                <div className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/15 bg-primary/10 text-primary md:flex">
                  <Building2 className="h-4 w-4" />
                </div>
                <div>
                  <CardTitle className="text-lg">Business details</CardTitle>
                  <CardDescription className="text-sm">
                    Core information about your business.
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 p-0 md:p-5 md:pt-0">
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
            </Card>

            <Card className="border-0 bg-transparent shadow-none md:border-border/60 md:bg-card md:shadow-sm">
              <CardHeader className="flex flex-row items-start gap-3 p-0 pb-4 md:p-5">
                <div className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/15 bg-primary/10 text-primary md:flex">
                  <Globe className="h-4 w-4" />
                </div>
                <div>
                  <CardTitle className="text-lg">Public information</CardTitle>
                  <CardDescription className="text-sm">
                    Details shown to clients on your public pages.
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="p-0 md:p-5 md:pt-0">
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
            </Card>

            <Card className="border-0 bg-transparent shadow-none md:border-border/60 md:bg-card md:shadow-sm">
              <CardHeader className="flex flex-row items-start gap-3 p-0 pb-4 md:p-5">
                <div className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/15 bg-primary/10 text-primary md:flex">
                  <Clock className="h-4 w-4" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-lg">Operating hours</CardTitle>
                    {persisting === "hours" && (
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
                    )}
                  </div>
                  <CardDescription className="text-sm">
                    Your standard weekly availability. Changes save automatically.
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-2 p-0 md:p-5 md:pt-0">
                {WEEKDAYS.map((day) => {
                  const hour = operatingHours.find((h) => h.day_name === day);
                  if (!hour) return null;
                  const hoursBusy = persisting === "hours";
                  return (
                    <div
                      key={day}
                      className="flex flex-col gap-3 rounded-lg border border-border/60 p-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex items-center gap-3">
                        <Switch
                          checked={hour.is_open}
                          disabled={hoursBusy}
                          onCheckedChange={(v) => updateHour(day, { is_open: v })}
                        />
                        <Label className="text-sm font-medium">
                          {WEEKDAY_LABELS[day]}
                        </Label>
                      </div>
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
                  );
                })}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Notifications */}
          <TabsContent value="notifications" className="m-0 space-y-6">
            <Card className="border-0 bg-transparent shadow-none md:border-border/60 md:bg-card md:shadow-sm">
              <CardHeader className="flex flex-row items-start gap-3 p-0 pb-4 md:p-5">
                <div className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/15 bg-primary/10 text-primary md:flex">
                  <Bell className="h-4 w-4" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-lg">Client notifications</CardTitle>
                    {persisting === "notifications" && (
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
                    )}
                  </div>
                  <CardDescription className="text-sm">
                    Messages sent to clients automatically. Changes save automatically.
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-2 p-0 md:p-5 md:pt-0">
                {emailRemindersEnabled && (
                  <div className="flex items-center justify-between gap-4 rounded-lg border border-primary/30 bg-primary/5 p-4">
                    <div className="min-w-0 space-y-0.5">
                      <Label className="text-sm font-semibold">Also send by email</Label>
                      <p className="text-sm leading-relaxed text-muted-foreground">
                        Send the notifications below by email too (to clients with an email address), alongside WhatsApp.
                      </p>
                    </div>
                    <Switch
                      checked={notifications.email_enabled}
                      disabled={persisting === "notifications"}
                      onCheckedChange={(v) => updateNotification("email_enabled", v)}
                      className="shrink-0"
                    />
                  </div>
                )}
                {[
                  {
                    key: "booking_confirmations" as const,
                    label: "Booking confirmations",
                    desc: "Send immediately when an appointment is booked.",
                  },
                  {
                    key: "reminder_24h" as const,
                    label: "24-hour reminders",
                    desc: "Send a WhatsApp reminder 24 hours before the appointment.",
                  },
                  {
                    key: "reminder_2h" as const,
                    label: "2-hour reminders",
                    desc: "Send a final reminder 2 hours before.",
                  },
                  {
                    key: "review_requests" as const,
                    label: "Review requests",
                    desc: "Ask for a Google review 2 hours after completion.",
                  },
                  {
                    key: "cancellation_notices" as const,
                    label: "Cancellation notices",
                    desc: "Notify client when their booking is cancelled.",
                  },
                  {
                    key: "rescheduling_alerts" as const,
                    label: "Rescheduling alerts",
                    desc: "Alert the client when their time is changed.",
                  },
                ].map((item) => (
                  <div
                    key={item.key}
                    className="flex items-center justify-between gap-4 rounded-lg border border-border/60 p-4"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <Label className="text-sm font-semibold">{item.label}</Label>
                      <p className="text-sm leading-relaxed text-muted-foreground">
                        {item.desc}
                      </p>
                    </div>
                    <Switch
                      checked={notifications[item.key]}
                      disabled={persisting === "notifications"}
                      onCheckedChange={(v) => updateNotification(item.key, v)}
                      className="shrink-0"
                    />
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="border-0 bg-transparent shadow-none md:border-border/60 md:bg-card md:shadow-sm">
              <CardHeader className="flex flex-row items-start gap-3 p-0 pb-4 md:p-5">
                <div className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/15 bg-primary/10 text-primary md:flex">
                  <Users className="h-4 w-4" />
                </div>
                <div>
                  <CardTitle className="text-lg">Staff notifications</CardTitle>
                  <CardDescription className="text-sm">
                    Alerts sent to your team members.
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-2 p-0 md:p-5 md:pt-0">
                {[
                  {
                    key: "staff_new_booking" as const,
                    label: "New booking assigned",
                    desc: "Notify staff when a booking is assigned to them.",
                  },
                  {
                    key: "staff_reschedule" as const,
                    label: "Booking rescheduled",
                    desc: "Alert staff when one of their bookings is moved to a new time.",
                  },
                  {
                    key: "staff_cancellation" as const,
                    label: "Booking cancellations",
                    desc: "Alert staff when a client cancels.",
                  },
                  {
                    key: "staff_daily_summary" as const,
                    label: "Daily schedule summary",
                    desc: "Send each staff member their day's schedule at 7 AM.",
                  },
                ].map((item) => (
                  <div
                    key={item.key}
                    className="flex items-center justify-between gap-4 rounded-lg border border-border/60 p-4"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <Label className="text-sm font-semibold">{item.label}</Label>
                      <p className="text-sm leading-relaxed text-muted-foreground">
                        {item.desc}
                      </p>
                    </div>
                    <Switch
                      checked={notifications[item.key]}
                      onCheckedChange={(v) => updateNotification(item.key, v)}
                      className="shrink-0"
                    />
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Payments */}
          <TabsContent value="payments" className="m-0 space-y-6">
            <Card className="border-0 bg-transparent shadow-none md:border-border/60 md:bg-card md:shadow-sm">
              <CardHeader className="flex flex-row items-start gap-3 p-0 pb-4 md:p-5">
                <div className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/15 bg-primary/10 text-primary md:flex">
                  <CreditCard className="h-4 w-4" />
                </div>
                <div className="flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="text-lg">Deposit settings</CardTitle>
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
              <CardContent className="space-y-4 p-0 md:p-5 md:pt-0">
                <div className="flex flex-col gap-3 rounded-xl border border-border/60 bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-0.5">
                    <Label className="text-sm font-semibold">
                      Require deposits for all bookings
                    </Label>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      Clients pay before their appointment is confirmed online.
                    </p>
                  </div>
                  <Switch
                    checked={deposits.require_deposit}
                    onCheckedChange={(v) =>
                      updateSettings((p) => ({
                        ...p,
                        deposits: { ...p.deposits, require_deposit: v },
                      }))
                    }
                    className="shrink-0"
                  />
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2 rounded-xl border border-border/60 p-4">
                    <Label className="text-sm">Default deposit type</Label>
                    <Select
                      value={deposits.deposit_type}
                      onValueChange={(v: "percentage" | "fixed") =>
                        updateSettings((p) => ({
                          ...p,
                          deposits: { ...p.deposits, deposit_type: v },
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="percentage" className="text-sm">
                          Percentage of booking
                        </SelectItem>
                        <SelectItem value="fixed" className="text-sm">
                          Fixed rand amount
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      {deposits.deposit_type === "percentage"
                        ? "Use this when service prices vary."
                        : "Use this when every booking needs the same deposit."}
                    </p>
                  </div>
                  <div className="space-y-2 rounded-xl border border-border/60 p-4">
                    <Label className="text-sm">Deposit amount</Label>
                    <div className="relative">
                      {deposits.deposit_type === "fixed" && (
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                          R
                        </span>
                      )}
                      <Input
                        type="number"
                        min="0"
                        className={deposits.deposit_type === "fixed" ? "pl-7" : "pr-8"}
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
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      This amount is applied as the default deposit on new online bookings.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-0 bg-transparent shadow-none md:border-border/60 md:bg-card md:shadow-sm">
              <CardHeader className="flex flex-row items-start gap-3 p-0 pb-4 md:p-5">
                <div className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/15 bg-primary/10 text-primary md:flex">
                  <CreditCard className="h-4 w-4" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-lg">Payment providers</CardTitle>
                    {persisting === "payments" && (
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
                    )}
                  </div>
                  <CardDescription className="text-sm">
                    PayFast is available now. More payment methods are coming soon.
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 p-0 md:p-5 md:pt-0">
                {PAYMENT_PROVIDERS.map((meta) => {
                  const p = getProviderSetting(
                    settings.paymentProviders,
                    meta.key,
                  );
                  if (!p) return null;
                  const isAvailable = meta.key === "payfast";
                  const paymentsBusy = persisting === "payments";
                  return (
                    <div
                      key={meta.key}
                      className="flex flex-col gap-3 rounded-xl border border-border/60 p-4 sm:flex-row sm:items-center"
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <CreditCard className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold">{meta.name}</span>
                          {!isAvailable ? (
                            <Badge variant="secondary" className="text-[10px]">
                              Coming soon
                            </Badge>
                          ) : p.connected ? (
                            <Badge className="border border-emerald-200 bg-emerald-100 text-[10px] text-emerald-700">
                              Connected
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px]">
                              Not set up
                            </Badge>
                          )}
                        </div>
                        <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
                          {meta.desc}
                        </p>
                      </div>
                      <div className="flex items-center gap-3 sm:justify-end">
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
                    </div>
                  );
                })}
              </CardContent>
            </Card>
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
              <Card className="relative mx-auto max-w-lg overflow-hidden border-border/60 shadow-sm">
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
            <Card className="relative overflow-hidden border-border/60 shadow-sm">
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
                    <div
                      key={feature}
                      className="flex items-center gap-2 rounded-lg border border-border/60 bg-card p-3 text-sm"
                    >
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
                      <span className="font-medium text-foreground">{feature}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Security */}
          <TabsContent value="security" className="m-0 space-y-6">
            <Card className="border-0 bg-transparent shadow-none md:border-border/60 md:bg-card md:shadow-sm">
              <CardHeader className="flex flex-row items-start gap-3 p-0 pb-4 md:p-5">
                <div className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/15 bg-primary/10 text-primary md:flex">
                  <Shield className="h-4 w-4" />
                </div>
                <div>
                  <CardTitle className="text-lg">Account</CardTitle>
                  <CardDescription className="text-sm">
                    Your login details from Supabase Auth.
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-2 p-0 text-sm md:p-5 md:pt-0">
                <div className="flex justify-between rounded-lg border border-border/60 p-3">
                  <span className="text-muted-foreground">Email</span>
                  <span className="font-medium">{user?.email ?? "—"}</span>
                </div>
                <div className="flex justify-between rounded-lg border border-border/60 p-3">
                  <span className="text-muted-foreground">Member since</span>
                  <span className="font-medium">
                    {user?.created_at
                      ? new Date(user.created_at).toLocaleDateString()
                      : "—"}
                  </span>
                </div>
                <div className="flex justify-between rounded-lg border border-border/60 p-3">
                  <span className="text-muted-foreground">Last sign in</span>
                  <span className="font-medium">
                    {user?.last_sign_in_at
                      ? new Date(user.last_sign_in_at).toLocaleString()
                      : "—"}
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card className="border-0 bg-transparent shadow-none md:border-border/60 md:bg-card md:shadow-sm">
              <CardHeader className="flex flex-row items-start gap-3 p-0 pb-4 md:p-5">
                <div className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/15 bg-primary/10 text-primary md:flex">
                  <KeyRound className="h-4 w-4" />
                </div>
                <div>
                  <CardTitle className="text-lg">Change password</CardTitle>
                  <CardDescription className="text-sm">
                    Update your account password.
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 p-0 md:p-5 md:pt-0">
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
            </Card>

            <Card className="border-0 bg-transparent shadow-none md:border-destructive/30 md:bg-card md:shadow-sm">
              <CardHeader className="flex flex-row items-start gap-3 p-0 pb-4 md:p-5">
                <div className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-destructive/20 bg-destructive/10 text-destructive md:flex">
                  <AlertCircle className="h-4 w-4" />
                </div>
                <div>
                  <CardTitle className="text-lg text-destructive">Danger zone</CardTitle>
                  <CardDescription className="text-sm">
                    Irreversible actions.
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 p-0 md:p-5 md:pt-0">
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
            </Card>
          </TabsContent>
        </div>
      </Tabs>

      {hasUnsavedChanges && (
        <div className="fixed bottom-5 right-5 z-50 sm:bottom-6 sm:right-6">
          <Button
            className="h-11 rounded-full bg-primary px-5 text-white shadow-lg shadow-primary/20 duration-200 ease-out animate-in fade-in slide-in-from-bottom-2 hover:bg-primary/90"
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
