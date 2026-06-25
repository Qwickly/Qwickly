import { useEffect, useState } from "react";
import { useLocation } from "wouter";
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
  Trash2,
  UserPlus,
  Sparkles,
  ChevronRight,
  Circle,
} from "lucide-react";
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

export default function SettingsPage() {
  const { user, signOut } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { settings, updateSettings, loading, saving, error, save, reload } =
    useSettings();
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
        <div className="flex gap-8">
          <Skeleton className="h-96 w-64" />
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

  const {
    business,
    operatingHours,
    notifications,
    deposits,
    whatsapp,
    teamMembers,
  } = settings;

  const onboardingProgress = tabsVisited.length;
  const onboardingComplete = allOnboardingTabsVisited(tabsVisited);
  const nextTab = nextOnboardingTab(tabsVisited);

  const settingsTabs = [
    { value: "profile" as const, icon: Building2 },
    { value: "notifications" as const, icon: Bell },
    { value: "payments" as const, icon: CreditCard },
    { value: "whatsapp" as const, icon: MessageSquare },
    { value: "team" as const, icon: Users },
    { value: "security" as const, icon: Shield },
  ];

  const onboardingPercent = Math.round(
    (onboardingProgress / ONBOARDING_TABS.length) * 100,
  );

  return (
    <div className="flex flex-col gap-4 h-[calc(100dvh-7rem)] max-h-[calc(100dvh-7rem)] overflow-hidden">
      <div className="shrink-0 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          {isOnboarding ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <div className="flex items-center gap-2 min-w-0">
                  <Sparkles className="w-5 h-5 text-primary shrink-0" />
                  <h1 className="text-2xl font-bold tracking-tight text-foreground">
                    Set up your business
                  </h1>
                </div>
                <Badge variant="secondary" className="shrink-0 font-normal">
                  {onboardingProgress} of {ONBOARDING_TABS.length} reviewed
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                Open each section in the sidebar and save your preferences.
              </p>
              <div className="flex items-center gap-3 max-w-md">
                <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-300"
                    style={{ width: `${onboardingPercent}%` }}
                  />
                </div>
                <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                  {onboardingPercent}%
                </span>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <h1 className="text-3xl font-bold tracking-tight text-foreground">
                Settings
              </h1>
              <p className="text-muted-foreground text-sm">
                Manage your business profile and preferences.
              </p>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {isOnboarding && nextTab && !onboardingComplete && (
            <Button
              onClick={handleNextOnboardingTab}
              variant="outline"
              size="sm"
            >
              Next: {ONBOARDING_TAB_LABELS[nextTab]}
              <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          )}
          {isOnboarding && (
            <Button
              onClick={handleCompleteOnboarding}
              disabled={!onboardingComplete || completingOnboarding}
              size="sm"
              className="bg-primary hover:bg-primary/90"
            >
              {completingOnboarding && (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              )}
              Finish setup
            </Button>
          )}
          <Button
            className="bg-primary hover:bg-primary/90"
            size="sm"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Save className="w-4 h-4 mr-2" />
            )}
            Save Changes
          </Button>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col md:flex-row gap-6">
        <Tabs
          value={activeTab}
          onValueChange={handleTabChange}
          className="flex-1 flex min-h-0 flex-col md:flex-row gap-6"
        >
          <div className="flex flex-col w-full md:w-64 shrink-0 md:self-stretch md:min-h-0">
            <TabsList className="flex flex-col w-full h-auto bg-transparent space-y-1 items-start justify-start p-0 shrink-0">
              {settingsTabs.map(({ value, icon: Icon }) => {
                const visited = tabsVisited.includes(value);
                return (
                  <TabsTrigger
                    key={value}
                    value={value}
                    className="w-full justify-start px-4 py-2.5 data-[state=active]:bg-muted/80 data-[state=active]:shadow-none rounded-lg"
                  >
                    <Icon className="w-4 h-4 mr-2 shrink-0" />
                    <span className="flex-1 text-left">
                      {ONBOARDING_TAB_LABELS[value]}
                    </span>
                    {isOnboarding &&
                      (visited ? (
                        <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />
                      ) : (
                        <Circle className="w-4 h-4 text-muted-foreground shrink-0" />
                      ))}
                  </TabsTrigger>
                );
              })}
            </TabsList>
            {isOnboarding && (
              <div className="hidden md:flex mt-auto pt-4 flex-col gap-2 border-t border-border/60">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {onboardingComplete
                    ? "All sections reviewed. Finish setup to open your dashboard."
                    : `${ONBOARDING_TABS.length - onboardingProgress} section${ONBOARDING_TABS.length - onboardingProgress === 1 ? "" : "s"} left — use Next or pick a tab with an empty circle.`}
                </p>
              </div>
            )}
          </div>

          <div className="flex-1 min-h-0 min-w-0 overflow-y-auto overscroll-contain pr-1">
            {/* Business Profile */}
            <TabsContent value="profile" className="m-0 space-y-6">
              <Card className="shadow-sm border-border/50">
                <CardHeader>
                  <CardTitle>Business Details</CardTitle>
                  <CardDescription>
                    Your public-facing business information.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Business Name</Label>
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
                      <Label>Industry</Label>
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
                            <SelectItem key={i.value} value={i.value}>
                              {i.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Phone Number</Label>
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
                      <Label>Email Address</Label>
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
                    <Label>Business Description</Label>
                    <Textarea
                      rows={4}
                      value={business.description}
                      onChange={(e) =>
                        updateSettings((p) => ({
                          ...p,
                          business: {
                            ...p.business,
                            description: e.target.value,
                          },
                        }))
                      }
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Physical Address</Label>
                      <Input
                        value={business.address}
                        onChange={(e) =>
                          updateSettings((p) => ({
                            ...p,
                            business: {
                              ...p.business,
                              address: e.target.value,
                            },
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Website URL</Label>
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

              <Card className="shadow-sm border-border/50">
                <CardHeader>
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <CardTitle>Operating Hours</CardTitle>
                      <CardDescription>
                        Your standard weekly availability. Changes save
                        automatically.
                      </CardDescription>
                    </div>
                    {persisting === "hours" && (
                      <Loader2 className="w-4 h-4 animate-spin text-primary shrink-0" />
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {WEEKDAYS.map((day) => {
                    const hour = operatingHours.find((h) => h.day_name === day);
                    if (!hour) return null;
                    const hoursBusy = persisting === "hours";
                    return (
                      <div
                        key={day}
                        className="flex items-center justify-between py-2 border-b last:border-0"
                      >
                        <div className="flex items-center gap-4 w-40">
                          <Switch
                            checked={hour.is_open}
                            disabled={hoursBusy}
                            onCheckedChange={(v) =>
                              updateHour(day, { is_open: v })
                            }
                          />
                          <Label className="font-medium">
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
                              className="w-28 bg-muted/50"
                            />
                            <span className="text-muted-foreground">–</span>
                            <Input
                              type="time"
                              value={hour.close_time}
                              disabled={hoursBusy}
                              onChange={(e) =>
                                updateHour(day, { close_time: e.target.value })
                              }
                              className="w-28 bg-muted/50"
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
                </CardContent>
              </Card>
            </TabsContent>

            {/* Notifications */}
            <TabsContent value="notifications" className="m-0 space-y-6">
              <Card className="shadow-sm border-border/50">
                <CardHeader>
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <CardTitle>Client Notifications</CardTitle>
                      <CardDescription>
                        Messages sent to clients automatically. Changes save
                        automatically.
                      </CardDescription>
                    </div>
                    {persisting === "notifications" && (
                      <Loader2 className="w-4 h-4 animate-spin text-primary shrink-0" />
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {[
                    {
                      key: "booking_confirmations" as const,
                      label: "Booking Confirmations",
                      desc: "Send immediately when an appointment is booked.",
                    },
                    {
                      key: "reminder_24h" as const,
                      label: "24-Hour Reminders",
                      desc: "Send a WhatsApp reminder 24 hours before the appointment.",
                    },
                    {
                      key: "reminder_2h" as const,
                      label: "2-Hour Reminders",
                      desc: "Send a final reminder 2 hours before.",
                    },
                    {
                      key: "review_requests" as const,
                      label: "Review Requests",
                      desc: "Ask for a Google review 2 hours after completion.",
                    },
                    {
                      key: "cancellation_notices" as const,
                      label: "Cancellation Notices",
                      desc: "Notify client when their booking is cancelled.",
                    },
                    {
                      key: "rescheduling_alerts" as const,
                      label: "Rescheduling Alerts",
                      desc: "Alert the client when their time is changed.",
                    },
                  ].map((item) => (
                    <div
                      key={item.key}
                      className="flex items-center justify-between p-4 border rounded-lg"
                    >
                      <div className="space-y-0.5">
                        <Label className="text-base font-semibold">
                          {item.label}
                        </Label>
                        <p className="text-sm text-muted-foreground">
                          {item.desc}
                        </p>
                      </div>
                      <Switch
                        checked={notifications[item.key]}
                        disabled={persisting === "notifications"}
                        onCheckedChange={(v) => updateNotification(item.key, v)}
                      />
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card className="shadow-sm border-border/50">
                <CardHeader>
                  <CardTitle>Staff Notifications</CardTitle>
                  <CardDescription>
                    Alerts sent to your team members.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {[
                    {
                      key: "staff_new_booking" as const,
                      label: "New Booking Assigned",
                      desc: "Notify staff when a booking is assigned to them.",
                    },
                    {
                      key: "staff_cancellation" as const,
                      label: "Booking Cancellations",
                      desc: "Alert staff when a client cancels.",
                    },
                    {
                      key: "staff_daily_summary" as const,
                      label: "Daily Schedule Summary",
                      desc: "Send each staff member their day's schedule at 7 AM.",
                    },
                  ].map((item) => (
                    <div
                      key={item.key}
                      className="flex items-center justify-between p-4 border rounded-lg"
                    >
                      <div className="space-y-0.5">
                        <Label className="text-base font-semibold">
                          {item.label}
                        </Label>
                        <p className="text-sm text-muted-foreground">
                          {item.desc}
                        </p>
                      </div>
                      <Switch
                        checked={notifications[item.key]}
                        onCheckedChange={(v) => updateNotification(item.key, v)}
                      />
                    </div>
                  ))}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Payments */}
            <TabsContent value="payments" className="m-0 space-y-6">
              <Card className="shadow-sm border-border/50">
                <CardHeader>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <CardTitle>Deposit Settings</CardTitle>
                      <CardDescription>
                        Collect upfront deposits for online bookings.
                      </CardDescription>
                    </div>
                    <Badge
                      variant={
                        deposits.require_deposit ? "default" : "secondary"
                      }
                      className="w-fit"
                    >
                      {deposits.require_deposit
                        ? "Deposits enabled"
                        : "Optional"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="flex flex-col gap-4 rounded-lg border bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="space-y-1">
                      <Label className="text-base font-semibold">
                        Require deposits for all bookings
                      </Label>
                      <p className="text-sm text-muted-foreground">
                        Clients pay before their appointment is confirmed
                        online.
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
                    />
                  </div>

                  <div className="grid gap-4 md:grid-cols-[1fr_1fr]">
                    <div className="space-y-2 rounded-lg border p-4">
                      <Label>Default deposit type</Label>
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
                          <SelectItem value="percentage">
                            Percentage of booking
                          </SelectItem>
                          <SelectItem value="fixed">
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
                    <div className="space-y-2 rounded-lg border p-4">
                      <Label>Deposit amount</Label>
                      <div className="relative">
                        {deposits.deposit_type === "fixed" && (
                          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                            R
                          </span>
                        )}
                        <Input
                          type="number"
                          min="0"
                          className={
                            deposits.deposit_type === "fixed" ? "pl-7" : "pr-8"
                          }
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
                      <p className="text-xs text-muted-foreground">
                        This amount is applied as the default deposit on new
                        online bookings.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="shadow-sm border-border/50">
                <CardHeader>
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <CardTitle>Payment Providers</CardTitle>
                      <CardDescription>
                        PayFast is available now. More payment methods are
                        coming soon.
                      </CardDescription>
                    </div>
                    {persisting === "payments" && (
                      <Loader2 className="w-4 h-4 animate-spin text-primary shrink-0" />
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
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
                        className="flex items-center gap-4 p-4 border rounded-lg"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold">{meta.name}</span>
                            {!isAvailable ? (
                              <Badge variant="secondary" className="text-xs">
                                Coming soon
                              </Badge>
                            ) : p.connected ? (
                              <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 border text-xs">
                                Connected
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-xs">
                                Not set up
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground mt-0.5">
                            {meta.desc}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <Switch
                            checked={isAvailable && p.enabled}
                            disabled={!isAvailable || paymentsBusy}
                            onCheckedChange={(v) =>
                              updateProvider(meta.key, {
                                enabled: v,
                                connected: v ? true : p.connected,
                              })
                            }
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
              <WhatsappConnectionManager />
            </TabsContent>

            {/* Team */}
            <TabsContent value="team" className="m-0 space-y-6">
              <Card className="shadow-sm border-border/50">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle>Team Access Control</CardTitle>
                      <CardDescription>
                        Manage what each team member can access.
                      </CardDescription>
                    </div>
                    <Button
                      size="sm"
                      className="bg-primary hover:bg-primary/90"
                      onClick={() => setInviteOpen(true)}
                    >
                      <UserPlus className="w-4 h-4 mr-1" /> Invite Member
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {teamMembers.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      No team members yet.
                    </p>
                  ) : (
                    <div className="space-y-4">
                      {teamMembers.map((member) => (
                        <div
                          key={member.id}
                          className="border rounded-lg overflow-hidden"
                        >
                          <div className="flex items-center gap-4 p-4 bg-muted/30">
                            <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold text-sm">
                              {member.name.substring(0, 2).toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-sm">
                                  {member.name}
                                </span>
                                <Badge
                                  variant="outline"
                                  className={
                                    member.role === "owner"
                                      ? "border-primary text-primary"
                                      : ""
                                  }
                                >
                                  {member.role.charAt(0).toUpperCase() +
                                    member.role.slice(1)}
                                </Badge>
                              </div>
                              <span className="text-xs text-muted-foreground">
                                {member.email}
                              </span>
                            </div>
                            {member.role !== "owner" && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-destructive hover:text-destructive"
                                onClick={() => handleRemoveMember(member)}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            )}
                          </div>
                          <div className="p-4 flex flex-wrap gap-4">
                            {(
                              [
                                "bookings",
                                "clients",
                                "payments",
                                "analytics",
                                "settings",
                              ] as const
                            ).map((perm) => {
                              const key = `perm_${perm}` as keyof TeamMember;
                              return (
                                <div
                                  key={perm}
                                  className="flex items-center gap-2"
                                >
                                  <Switch
                                    checked={member[key] as boolean}
                                    disabled={member.role === "owner"}
                                    className="scale-90"
                                    onCheckedChange={(v) =>
                                      updateTeamMemberLocal(member.id, {
                                        [key]: v,
                                      })
                                    }
                                  />
                                  <Label className="capitalize text-sm text-muted-foreground">
                                    {perm}
                                  </Label>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="shadow-sm border-border/50">
                <CardHeader>
                  <CardTitle>Role Descriptions</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {[
                    {
                      role: "Owner",
                      desc: "Full access to all settings, billing, and data.",
                      color: "text-primary",
                    },
                    {
                      role: "Manager",
                      desc: "Can manage bookings, clients, payments, and analytics.",
                      color: "text-blue-600",
                    },
                    {
                      role: "Staff",
                      desc: "Can view and manage their own bookings only.",
                      color: "text-muted-foreground",
                    },
                  ].map((r) => (
                    <div
                      key={r.role}
                      className="flex gap-3 p-3 border rounded-lg"
                    >
                      <span
                        className={`font-semibold text-sm w-20 shrink-0 ${r.color}`}
                      >
                        {r.role}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {r.desc}
                      </span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Security */}
            <TabsContent value="security" className="m-0 space-y-6">
              <Card className="shadow-sm border-border/50">
                <CardHeader>
                  <CardTitle>Account</CardTitle>
                  <CardDescription>
                    Your login details from Supabase Auth.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="flex justify-between p-3 border rounded-lg">
                    <span className="text-muted-foreground">Email</span>
                    <span className="font-medium">{user?.email ?? "—"}</span>
                  </div>
                  <div className="flex justify-between p-3 border rounded-lg">
                    <span className="text-muted-foreground">Member since</span>
                    <span className="font-medium">
                      {user?.created_at
                        ? new Date(user.created_at).toLocaleDateString()
                        : "—"}
                    </span>
                  </div>
                  <div className="flex justify-between p-3 border rounded-lg">
                    <span className="text-muted-foreground">Last sign in</span>
                    <span className="font-medium">
                      {user?.last_sign_in_at
                        ? new Date(user.last_sign_in_at).toLocaleString()
                        : "—"}
                    </span>
                  </div>
                </CardContent>
              </Card>

              <Card className="shadow-sm border-border/50">
                <CardHeader>
                  <CardTitle>Change Password</CardTitle>
                  <CardDescription>
                    Update your account password.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>Current Password</Label>
                    <Input
                      type="password"
                      placeholder="••••••••••"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>New Password</Label>
                      <Input
                        type="password"
                        placeholder="Min 8 characters"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Confirm New Password</Label>
                      <Input
                        type="password"
                        placeholder="••••••••••"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                      />
                    </div>
                  </div>
                  <Button
                    className="bg-primary hover:bg-primary/90"
                    onClick={handlePasswordUpdate}
                    disabled={updatingPassword}
                  >
                    {updatingPassword && (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    )}
                    Update Password
                  </Button>
                </CardContent>
              </Card>

              <Card className="shadow-sm border-border/50 border-destructive/30">
                <CardHeader>
                  <CardTitle className="text-destructive flex items-center gap-2">
                    <AlertCircle className="w-5 h-5" /> Danger Zone
                  </CardTitle>
                  <CardDescription>Irreversible actions.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between p-4 border border-destructive/20 rounded-lg bg-destructive/5">
                    <div>
                      <Label className="text-base font-semibold text-destructive">
                        Delete All Data
                      </Label>
                      <p className="text-sm text-muted-foreground">
                        Delete business profile and settings. Account remains.
                      </p>
                    </div>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={handleDeleteData}
                    >
                      Delete Data
                    </Button>
                  </div>
                  <div className="flex items-center justify-between p-4 border border-destructive/20 rounded-lg bg-destructive/5">
                    <div>
                      <Label className="text-base font-semibold text-destructive">
                        Close Account
                      </Label>
                      <p className="text-sm text-muted-foreground">
                        Sign out and remove your business data.
                      </p>
                    </div>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={handleCloseAccount}
                    >
                      Close Account
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </div>
        </Tabs>
      </div>

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
