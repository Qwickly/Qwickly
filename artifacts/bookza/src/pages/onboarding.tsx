import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Check, Copy, CopyCheck, ExternalLink, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { AppBootLoader } from "@/components/layout/AppBootLoader";
import { StateLine } from "@/components/ui/state-line";
import {
  ONBOARDING_STEPS,
  OnboardingLayout,
  OnboardingMark,
  OnboardingNext,
  OnboardingPanel,
  OnboardingScreenBody,
  OnboardingSkip,
  OnboardingTransition,
  type OnboardingScreen,
} from "@/components/onboarding/onboarding-ui";
import { onboardingKeys } from "@/components/auth/RequireOnboarding";
import { completeOnboarding, fetchOnboardingCompleted } from "@/lib/onboarding";
import {
  ensureBusiness,
  fetchBusinessBasics,
  fetchOperatingHours,
  saveBusinessBasics,
  saveOperatingHours,
  type BusinessBasics,
} from "@/lib/settings";
import {
  catalogKeys,
  createService,
  createStaff,
  fetchServices,
  fetchStaff,
  updateService,
} from "@/lib/catalog";
import {
  bookingPageUrl,
  fetchBookingPageSettings,
  saveBookingPageSettings,
} from "@/lib/booking-page";
import { fetchSubscription, startFreeTrial } from "@/lib/catalog-subscriptions";
import {
  GENERIC_SEED_SERVICES,
  seedServicesForIndustry,
  seedStaffRoleForIndustry,
  type SeedService,
} from "@/lib/onboarding-seeds";
import { INDUSTRY_SUGGESTIONS, WEEKDAY_LABELS, WEEKDAYS, type OperatingHour } from "@/types/settings";
import { cn } from "@/lib/utils";

/**
 * First-run setup, start to finish, on its own screen.
 *
 * What it replaces was a checklist inside the app shell: nine cards, each one a
 * link that threw a brand-new user onto Settings, Services, Staff, WhatsApp or
 * the booking page editor with a tour overlay on top of a UI they had never
 * seen, and a "back to checklist" link to find their way home. The user did all
 * the navigating, through a mostly-locked sidebar, having been asked for a card
 * before they were asked their business name.
 *
 * This asks one thing at a time, seeds as much of it as it can from the first
 * answer, and ends on the finished booking page rather than a dashboard with
 * nothing in it. The WhatsApp bot, the branded email domain and campaigns are
 * all deliberately absent: they belong to first-run flows on their own pages,
 * not to the fifteen minutes after signup.
 */

/**
 * Every suggestion is a pill, with "Other" last.
 *
 * The typed field used to sit under the pills permanently, which asked a
 * question the pills had already answered. It now appears only behind "Other",
 * so the common case is one tap and the uncommon one is still open-ended —
 * the industry is free text either way, since a mobile nail tech and a
 * physiotherapist both have to be able to answer.
 */
const OTHER_INDUSTRY = "Other";

const DEFAULT_OPEN_DAYS = new Set<string>(["monday", "tuesday", "wednesday", "thursday", "friday"]);

/** Where back goes from each screen. Absent = no way back from here. */
const PREVIOUS: Partial<Record<OnboardingScreen, OnboardingScreen>> = {
  team: "industry",
  business: "team",
  services: "business",
  staff: "services",
  hours: "staff",
  trial: "hours",
};

/**
 * How many people take bookings.
 *
 * Asked as a count rather than as "just you or a team", because the answer is
 * the number of bookable seats — and a business that says four needs to be told
 * what three extra seats cost before it finds out on the staff step.
 */
const TEAM_SIZES = ["Just me", "2", "3", "4", "5", "6+"] as const;

type DraftService = SeedService & {
  /** Local list key. Not the database id. */
  id: string;
  /** Present once this row exists in `services`; absent while it is a draft. */
  existingId?: string;
  selected: boolean;
};

let draftId = 0;
const nextDraftId = () => `draft-${(draftId += 1)}`;

const toDraft = (service: SeedService, selected = true): DraftService => ({
  ...service,
  id: nextDraftId(),
  selected,
});

/** The field shell shared by every text input in the flow. */
const FIELD_CLASS = "rounded-2xl bg-card/80 shadow-sm backdrop-blur";

export default function OnboardingPage() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // `null` while the resume point is being worked out. Rendering a step before
  // that is known would flash the wrong question at someone coming back.
  const [screen, setScreen] = useState<OnboardingScreen | null>(null);
  // Which way the next transition travels. Set by every move, so going back
  // animates backwards instead of replaying the forward slide.
  const [direction, setDirection] = useState<1 | -1>(1);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const ownerName = String(user?.user_metadata?.full_name ?? "").trim();

  const go = (next: OnboardingScreen) => {
    setDirection(1);
    setScreen(next);
  };
  const back = () => {
    const previous = screen ? PREVIOUS[screen] : undefined;
    if (!previous) return;
    setDirection(-1);
    setScreen(previous);
  };

  // ── Step state ────────────────────────────────────────────────────────────
  const [industry, setIndustry] = useState("");
  // Set when "Other" is picked, so the typed value can be held separately from
  // the pill selection and neither clobbers the other.
  const [industryIsOther, setIndustryIsOther] = useState(false);
  const [teamSize, setTeamSize] = useState<string | null>(null);
  const [basics, setBasics] = useState<BusinessBasics | null>(null);
  const [services, setServices] = useState<DraftService[]>([]);
  const [staffName, setStaffName] = useState("");
  const [staffRole, setStaffRole] = useState("");
  const [hours, setHours] = useState<OperatingHour[]>([]);
  const [bookingUrl, setBookingUrl] = useState<string | null>(null);
  const [published, setPublished] = useState(false);

  // ── Resume ────────────────────────────────────────────────────────────────
  // Where to start is read from what the account actually has, the same way the
  // rest of the app decides anything: a reload lands where the work stopped
  // instead of at the top of a form that would overwrite it.
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current) return;
    resumed.current = true;

    (async () => {
      try {
        // Nothing guards this route — it cannot be, or the redirect out of the
        // shell would land on a page that bounces straight back. So a business
        // that has already finished setup and typed the URL is sent on rather
        // than walked through it a second time.
        if (await fetchOnboardingCompleted()) {
          setLocation("/dashboard");
          return;
        }

        const id = await ensureBusiness();
        setBusinessId(id);

        const [existingBasics, existingServices, existingStaff, existingHours, subscription] =
          await Promise.all([
            fetchBusinessBasics(id),
            fetchServices().catch(() => []),
            fetchStaff().catch(() => []),
            fetchOperatingHours().catch(() => [] as OperatingHour[]),
            fetchSubscription().catch(() => null),
          ]);

        setBasics(existingBasics);

        // Anything already saved becomes the list, and the seeds stand down:
        // re-seeding over real services is how the duplicates happened, and it
        // would also throw away prices the business had already corrected.
        if (existingServices.length > 0) {
          seedTouched.current = true;
          setServices(
            existingServices.map((service) => ({
              id: nextDraftId(),
              existingId: service.id,
              name: service.name,
              duration: service.duration,
              price: service.price,
              selected: service.isActive,
            })),
          );
        }

        const savedIndustry = existingBasics.industry === "other" ? "" : existingBasics.industry;
        setIndustry(savedIndustry);
        setIndustryIsOther(
          Boolean(savedIndustry) && !INDUSTRY_SUGGESTIONS.includes(savedIndustry as never),
        );
        setStaffName(existingStaff[0]?.name ?? ownerName);
        setStaffRole(existingStaff[0]?.position ?? "");
        setHours(
          existingHours.length > 0
            ? existingHours
            : // Only ever empty if the seed function never ran; the step still
              // has to render something rather than an empty week.
              WEEKDAYS.map((day) => ({
                id: "",
                business_id: id,
                day_name: day,
                is_open: DEFAULT_OPEN_DAYS.has(day),
                open_time: "09:00",
                close_time: "17:00",
              })),
        );

        const hasIndustry = Boolean(existingBasics.industry) && existingBasics.industry !== "other";
        const hasProfile = Boolean(existingBasics.business_name.trim() && existingBasics.phone.trim());
        const paying = subscription?.status === "active" || subscription?.status === "trialing";

        if (!hasIndustry) setScreen("industry");
        else if (!hasProfile) setScreen("business");
        else if (existingServices.length === 0) setScreen("services");
        else if (existingStaff.length === 0) setScreen("staff");
        else if (!existingHours.some((hour) => hour.is_open)) setScreen("hours");
        // A plan already exists — an interrupted flow, or an account that
        // subscribed from Billing before setup was finished. Asking it to start
        // a trial it is already on is the one thing the last step must not do.
        else if (!paying) setScreen("trial");
        else setScreen("finishing");
      } catch (err) {
        toast.error("Couldn't load your account", {
          description: err instanceof Error ? err.message : "Please refresh and try again.",
        });
        setScreen("industry");
      }
    })();
  }, [ownerName, setLocation]);

  // Seeds follow the industry until the user edits the list — after that their
  // edits are the list, and re-seeding would throw the work away.
  const seedTouched = useRef(false);
  useEffect(() => {
    if (seedTouched.current) return;
    setServices(seedServicesForIndustry(industry).map((service) => toDraft(service)));
    setStaffRole((current) => current || seedStaffRoleForIndustry(industry));
  }, [industry]);

  const setDay = (day: OperatingHour["day_name"], patch: Partial<OperatingHour>) =>
    setHours((prev) => prev.map((row) => (row.day_name === day ? { ...row, ...patch } : row)));

  /**
   * Copies one day's times onto every other day that is open.
   *
   * Deliberately not onto the closed ones: "apply to all" is about the times,
   * and a business that has just marked Sunday closed does not want it opened
   * again by a button on the Monday row.
   */
  const applyToAll = (source: OperatingHour) => {
    setHours((prev) =>
      prev.map((row) =>
        row.is_open ? { ...row, open_time: source.open_time, close_time: source.close_time } : row,
      ),
    );
    toast(`Applied ${source.open_time}–${source.close_time} to every open day`);
  };

  const selectedServices = useMemo(
    () => services.filter((service) => service.selected && service.name.trim()),
    [services],
  );

  // ── Finishing ─────────────────────────────────────────────────────────────
  const finish = async () => {
    if (!businessId) return;
    setSaving(true);
    try {
      // Auto-publish, but only a page someone could actually book. The last
      // screen's whole argument is "this is already live", and landing on an
      // unpublished page with a button on it would make the user do the one
      // piece of work the flow just earned the right to do for them — but a
      // page with no services or no open days is a public dead end, and
      // publishing that is worse than not publishing at all.
      const [page, currentServices, currentHours] = await Promise.all([
        fetchBookingPageSettings(),
        fetchServices().catch(() => []),
        fetchOperatingHours().catch(() => [] as OperatingHour[]),
      ]);
      const bookable = currentServices.length > 0 && currentHours.some((hour) => hour.is_open);

      const saved =
        bookable && !page.isPublished
          ? await saveBookingPageSettings({ ...page, isPublished: true })
          : page;
      setBookingUrl(bookable || saved.isPublished ? bookingPageUrl(saved.slug) : null);
      setPublished(bookable || saved.isPublished);

      await completeOnboarding(businessId);
      queryClient.setQueryData(onboardingKeys.completed, true);
      queryClient.invalidateQueries({ queryKey: catalogKeys.services });
      queryClient.invalidateQueries({ queryKey: catalogKeys.staff });
      go("done");
    } catch (err) {
      toast.error("Couldn't finish setting up", {
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setSaving(false);
    }
  };

  // ── Step handlers ─────────────────────────────────────────────────────────
  const handleBusiness = async () => {
    if (!businessId || !basics) return;
    if (!basics.business_name.trim() || !basics.phone.trim()) {
      toast.error("Business name and phone are required");
      return;
    }
    setSaving(true);
    try {
      await saveBusinessBasics(businessId, { ...basics, industry: industry.trim() });
      go("services");
    } catch (err) {
      toast.error("Couldn't save your business details", {
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleServices = async () => {
    setSaving(true);
    try {
      // Sequential, not Promise.all: these are the first rows the account has,
      // and a partial failure halfway through a batch is much harder to explain
      // than one that stops at the service it choked on.
      for (const service of services) {
        const name = service.name.trim();

        if (service.existingId) {
          // Already saved. Unticking archives it rather than deleting it —
          // the business may have taken a booking against it already, and a
          // setup screen is the wrong place to destroy history.
          await updateService(service.existingId, {
            name: name || "Untitled service",
            duration: service.duration,
            price: service.price,
            isActive: service.selected,
          });
          continue;
        }

        if (service.selected && name) {
          const created = await createService({
            name,
            duration: service.duration,
            price: service.price,
          });
          // Remember the id, so coming back to this step edits the row instead
          // of adding another one beside it.
          setServices((prev) =>
            prev.map((row) => (row.id === service.id ? { ...row, existingId: created.id } : row)),
          );
        }
      }

      // Saved rows now exist, so the seeds must never overwrite this list
      // again — going back to change the industry after this point would
      // otherwise drop the ids and insert the whole seed list a second time.
      seedTouched.current = true;

      go("staff");
    } catch (err) {
      toast.error("Couldn't save that", {
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleStaff = async () => {
    if (!staffName.trim()) {
      toast.error("Add a name for the person taking bookings");
      return;
    }
    setSaving(true);
    try {
      // The plan includes one seat, so this only ever creates the first one —
      // a resumed flow that already has staff must not add a duplicate.
      const existingStaff = await fetchStaff().catch(() => []);
      if (existingStaff.length === 0) {
        await createStaff({
          name: staffName.trim(),
          position: staffRole.trim() || "Owner",
          email: user?.email ?? null,
        });
      }
      go("hours");
    } catch (err) {
      toast.error("Couldn't save that", {
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleHours = async () => {
    setSaving(true);
    try {
      // Rows without an id predate the seed function and have nothing to
      // update; skipping them is better than failing the whole step.
      await saveOperatingHours(hours.filter((hour) => hour.id));
      go("trial");
    } catch (err) {
      toast.error("Couldn't save your hours", {
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleStartTrial = async () => {
    setSaving(true);
    try {
      const result = await startFreeTrial("Starter");

      if (result.ok) {
        finish();
        return;
      }

      // Already trialling or already paying: they have what this step exists to
      // give them, so carry on rather than blocking the end of setup on it.
      if (result.reason === "already_subscribed") {
        finish();
        return;
      }

      setSaving(false);

      if (result.reason === "trial_already_used") {
        toast.error("You've already used your free trial", {
          description: "Choose a plan in Billing to keep going.",
        });
        return;
      }

      toast.error("Couldn't start your trial", {
        description: "Please try again in a moment.",
      });
    } catch (err) {
      setSaving(false);
      toast.error("Couldn't start your trial", {
        description: err instanceof Error ? err.message : "Please try again.",
      });
    }
  };

  if (screen === null) {
    return <AppBootLoader label="Loading your setup" />;
  }

  const stepIndex = ONBOARDING_STEPS.findIndex((step) => step.id === screen);
  const progress = stepIndex >= 0 ? (stepIndex + 1) / ONBOARDING_STEPS.length : undefined;

  return (
    <OnboardingLayout onBack={PREVIOUS[screen] ? back : undefined} progress={progress}>
      <OnboardingTransition screenKey={screen} direction={direction}>
        {screen === "industry" ? (
          <OnboardingScreenBody
            title="What kind of business do you run?"
            description="We'll use this to set up your services, your booking page and your reminders — so most of what comes next arrives already filled in."
            actions={<OnboardingNext onClick={() => go("team")} disabled={!industry.trim()} />}
          >
            <div className="space-y-4">
              <div className="flex flex-wrap justify-center gap-2">
                {INDUSTRY_SUGGESTIONS.map((suggestion) => (
                  <PillButton
                    key={suggestion}
                    selected={!industryIsOther && industry === suggestion}
                    onClick={() => {
                      setIndustryIsOther(false);
                      setIndustry(suggestion);
                    }}
                  >
                    {suggestion}
                  </PillButton>
                ))}
                <PillButton
                  selected={industryIsOther}
                  onClick={() => {
                    setIndustryIsOther(true);
                    setIndustry("");
                  }}
                >
                  {OTHER_INDUSTRY}
                </PillButton>
              </div>

              {industryIsOther ? (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                  className="overflow-hidden"
                >
                  <Label htmlFor="industry" className="sr-only">
                    What kind of business
                  </Label>
                  <Input
                    id="industry"
                    autoFocus
                    className={cn("h-14 text-center text-base", FIELD_CLASS)}
                    placeholder="Mobile nail tech, physio, dog groomer…"
                    value={industry}
                    onChange={(event) => setIndustry(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && industry.trim()) go("team");
                    }}
                  />
                </motion.div>
              ) : null}
            </div>
          </OnboardingScreenBody>
        ) : null}

        {screen === "team" ? (
          <OnboardingScreenBody
            title="How many people take bookings?"
            description="Including you. This is how many separate calendars your clients can book against."
            actions={<OnboardingNext onClick={() => go("business")} disabled={!teamSize} />}
          >
            <div className="space-y-4">
              <div className="flex flex-wrap justify-center gap-2">
                {TEAM_SIZES.map((size) => (
                  <PillButton key={size} selected={teamSize === size} onClick={() => setTeamSize(size)}>
                    {size}
                  </PillButton>
                ))}
              </div>

              {/* Said here, once, rather than discovered on the staff step or
                  three days later on a seat limit nobody mentioned. */}
              {teamSize && teamSize !== "Just me" ? (
                <motion.p
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-center text-sm leading-6 text-muted-foreground"
                >
                  Every calendar is free for your whole trial — add as many people as you like in
                  Settings once you are set up. They only start costing anything if you subscribe.
                  Setup will get the first person going.
                </motion.p>
              ) : null}
            </div>
          </OnboardingScreenBody>
        ) : null}

        {screen === "business" && basics ? (
          <OnboardingScreenBody
            title="Tell us about your business"
            description="This is the name and number your clients see on your booking page and on every message you send them."
            actions={<OnboardingNext onClick={handleBusiness} pending={saving} />}
          >
            <div className="space-y-4">
              <Field label="Business name" htmlFor="business-name">
                <Input
                  id="business-name"
                  className={cn("h-14 text-base", FIELD_CLASS)}
                  value={basics.business_name}
                  placeholder="Glow Beauty Studio"
                  onChange={(event) => setBasics({ ...basics, business_name: event.target.value })}
                />
              </Field>
              <Field
                label="Business phone"
                htmlFor="business-phone"
                hint="Clients see this on your booking page and on their confirmations."
              >
                <Input
                  id="business-phone"
                  type="tel"
                  className={cn("h-14 text-base", FIELD_CLASS)}
                  value={basics.phone}
                  placeholder="071 234 5678"
                  onChange={(event) => setBasics({ ...basics, phone: event.target.value })}
                />
              </Field>
            </div>
          </OnboardingScreenBody>
        ) : null}

        {screen === "services" ? (
          <OnboardingScreenBody
            width="wide"
            title="What do you offer?"
            description={
              industry.trim()
                ? "We've filled in what a business like yours usually offers. Change anything, untick what you don't do — no pressure to get it perfect, you can edit all of this later."
                : "Add what clients can book. No pressure to get the prices exactly right — you can change any of this later from Services."
            }
            actions={
              <>
                <OnboardingNext onClick={handleServices} pending={saving} />
                <OnboardingSkip onClick={() => go("staff")} />
              </>
            }
          >
            <div className="space-y-2">
                {services.map((service) => (
                  <ServiceRow
                    key={service.id}
                    service={service}
                    onChange={(next) => {
                      seedTouched.current = true;
                      setServices((prev) => prev.map((row) => (row.id === service.id ? next : row)));
                    }}
                    onRemove={() => {
                      seedTouched.current = true;
                      setServices((prev) => prev.filter((row) => row.id !== service.id));
                    }}
                  />
                ))}

                <Button
                  variant="outline"
                  className="h-12 w-full rounded-2xl border-dashed bg-card/50"
                  onClick={() => {
                    seedTouched.current = true;
                    setServices((prev) => [
                      ...prev,
                      toDraft({ name: "", duration: GENERIC_SEED_SERVICES[0].duration, price: 0 }),
                    ]);
                  }}
                >
                  <Plus className="h-4 w-4" />
                  Add another service
                </Button>
            </div>
          </OnboardingScreenBody>
        ) : null}

        {screen === "staff" ? (
          <OnboardingScreenBody
            title="Who takes the bookings?"
            description="This is the name your clients pick when they book, and the calendar the appointment lands on."
            actions={
              <>
                <OnboardingNext onClick={handleStaff} pending={saving} disabled={!staffName.trim()} />
                <OnboardingSkip onClick={() => go("hours")} />
              </>
            }
          >
            <div className="space-y-4">
              <Field label="Name" htmlFor="staff-name">
                <Input
                  id="staff-name"
                  className={cn("h-14 text-base", FIELD_CLASS)}
                  value={staffName}
                  placeholder="Your name"
                  onChange={(event) => setStaffName(event.target.value)}
                />
              </Field>
              <Field
                label="Role"
                htmlFor="staff-role"
                hint={
                  teamSize && teamSize !== "Just me"
                    ? "One calendar is included. You can buy more from Billing whenever you need them."
                    : "Shown on your booking page next to their name."
                }
              >
                <Input
                  id="staff-role"
                  className={cn("h-14 text-base", FIELD_CLASS)}
                  value={staffRole}
                  placeholder="Owner"
                  onChange={(event) => setStaffRole(event.target.value)}
                />
              </Field>
            </div>
          </OnboardingScreenBody>
        ) : null}

        {screen === "hours" ? (
          <OnboardingScreenBody
            width="wide"
            title="When are you open?"
            description="Your booking page only offers times inside these hours, so this is what decides when clients can book you."
            actions={
              <>
                <OnboardingNext onClick={handleHours} pending={saving} />
                <OnboardingSkip onClick={() => go("trial")} />
              </>
            }
          >
            <OnboardingPanel padded={false}>
              {hours.map((hour, index) => (
                <div
                  key={hour.day_name}
                  className={cn(
                    "group/day flex flex-wrap items-center gap-3 px-4 py-3 transition-colors",
                    index > 0 && "border-t border-border/40",
                    hour.is_open ? "hover:bg-primary/[0.04]" : "bg-muted/20",
                  )}
                >
                  <Switch
                    checked={hour.is_open}
                    onCheckedChange={(checked) => setDay(hour.day_name, { is_open: checked })}
                    aria-label={WEEKDAY_LABELS[hour.day_name]}
                  />
                  <span
                    className={cn(
                      "w-24 text-sm font-medium",
                      hour.is_open ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {WEEKDAY_LABELS[hour.day_name]}
                  </span>

                  {hour.is_open ? (
                    <>
                      <div className="flex items-center gap-2">
                        <Input
                          type="time"
                          className="bg-background/80"
                          value={hour.open_time}
                          onChange={(event) => setDay(hour.day_name, { open_time: event.target.value })}
                        />
                        <span className="text-sm text-muted-foreground">to</span>
                        <Input
                          type="time"
                          className="bg-background/80"
                          value={hour.close_time}
                          onChange={(event) => setDay(hour.day_name, { close_time: event.target.value })}
                        />
                      </div>

                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => applyToAll(hour)}
                        className={cn(
                          "ml-auto h-8 shrink-0 text-xs text-muted-foreground opacity-0 transition-opacity",
                          "hover:text-foreground focus-visible:opacity-100 group-hover/day:opacity-100",
                        )}
                      >
                        <CopyCheck className="h-3.5 w-3.5" />
                        Apply to all
                      </Button>
                    </>
                  ) : (
                    <span className="text-sm text-muted-foreground">Closed</span>
                  )}
                </div>
              ))}
            </OnboardingPanel>
          </OnboardingScreenBody>
        ) : null}

        {screen === "trial" ? (
          <TrialScreen
            businessName={basics?.business_name ?? ""}
            serviceCount={selectedServices.length}
            saving={saving}
            onStart={handleStartTrial}
          />
        ) : null}

        {screen === "finishing" ? <FinishingScreen onRun={finish} /> : null}

        {screen === "done" ? (
          <DoneScreen
            bookingUrl={bookingUrl}
            published={published}
            businessName={basics?.business_name ?? ""}
            onEnter={() => setLocation("/dashboard")}
          />
        ) : null}
      </OnboardingTransition>
    </OnboardingLayout>
  );
}

/** A selectable pill — the same object for industries and for the team answer. */
function PillButton({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-4 py-2 text-sm font-medium transition-all",
        selected
          ? "border-primary bg-primary text-primary-foreground shadow-sm shadow-primary/25"
          : "border-border/60 bg-card/70 text-foreground backdrop-blur hover:border-primary/40 hover:bg-card",
      )}
    >
      {children}
    </button>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor} className="px-1 text-sm text-muted-foreground">
        {label}
      </Label>
      {children}
      {hint ? <p className="px-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function ServiceRow({
  service,
  onChange,
  onRemove,
}: {
  service: DraftService;
  onChange: (next: DraftService) => void;
  onRemove: () => void;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-2xl border p-2.5 shadow-sm backdrop-blur transition-colors sm:flex-nowrap",
        service.selected ? "border-primary/40 bg-primary/[0.06]" : "border-border/50 bg-card/70",
      )}
    >
      <Checkbox
        checked={service.selected}
        onCheckedChange={(checked) => onChange({ ...service, selected: checked === true })}
        aria-label={service.name ? `Include ${service.name}` : "Include this service"}
        className="ml-1"
      />
      <Input
        value={service.name}
        placeholder="Service name"
        className="min-w-0 flex-1 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0 dark:bg-transparent"
        onChange={(event) => onChange({ ...service, name: event.target.value })}
      />
      <div className="flex shrink-0 items-center gap-1.5">
        <Input
          type="number"
          min={5}
          step={5}
          value={service.duration}
          className="w-[4.5rem] bg-background/70 tabular-nums"
          onChange={(event) => onChange({ ...service, duration: Number(event.target.value) })}
        />
        <span className="text-xs text-muted-foreground">min</span>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <span className="text-xs text-muted-foreground">R</span>
        <Input
          type="number"
          min={0}
          value={service.price}
          className="w-[5.5rem] bg-background/70 tabular-nums"
          onChange={(event) => onChange({ ...service, price: Number(event.target.value) })}
        />
      </div>
      {service.existingId ? (
        // Saved already — the tick box turns it on and off, and there is
        // nothing here to throw away that was not already written down.
        <span className="w-9 shrink-0" aria-hidden />
      ) : (
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 text-muted-foreground hover:text-destructive"
          onClick={onRemove}
        >
          <Trash2 className="h-4 w-4" />
          <span className="sr-only">Remove {service.name || "service"}</span>
        </Button>
      )}
    </div>
  );
}

/**
 * The last step, and no longer a payment step.
 *
 * This used to hand the customer to PayFast to capture a card for a zero-amount
 * subscription — an off-domain form POST, a return trip carrying `?payfast=…`
 * that only proved they came back rather than that anything succeeded, and a
 * poll here waiting for the ITN to land. All of that existed to collect a card
 * we had promised not to charge.
 *
 * The trial takes no card, so starting one is a single call that has either
 * happened or not by the time it returns. Nothing to leave for, nothing to come
 * back from, nothing to poll.
 */
function TrialScreen({
  businessName,
  serviceCount,
  saving,
  onStart,
}: {
  businessName: string;
  serviceCount: number;
  saving: boolean;
  onStart: () => void;
}) {
  return (
    <OnboardingScreenBody
      title="You're all ready to go"
      description="One last step: start your free trial. Fourteen days to set things up and take real bookings — no card, no payment details, nothing to cancel."
      actions={
        <>
          <OnboardingNext onClick={onStart} pending={saving} label="Start free trial" />
          <p className="max-w-sm text-xs leading-5 text-muted-foreground">
            No card required. We&apos;ll only ask for payment details if you decide to stay.
          </p>
        </>
      }
    >
      <OnboardingPanel tone="primary" padded={false} className="text-left">
        {/*
          A hairline that fades out from the left edge — the one piece of
          ornament on this card, and it earns its place by reading as a switch
          being thrown. Everything below it is now live.
        */}
        <div className="h-px w-full bg-gradient-to-r from-primary via-primary/40 to-transparent" />

        <div className="p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
            <div>
              <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Starter
              </p>
              {/* The offer is the time, not the price. */}
              <p className="mt-1.5 text-4xl font-semibold leading-none tracking-tight tabular-nums text-foreground">
                14
                <span className="ml-2 text-lg font-medium tracking-normal text-muted-foreground">
                  days free
                </span>
              </p>
            </div>

            <span className="rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
              R0 today
            </span>
          </div>

          <p className="mt-3 text-xs leading-6 text-muted-foreground">
            Then R129 a month if you keep it. No card until you decide.
          </p>

          <div className="mt-5 border-t border-border/50 pt-1">
            <StateLine
              state="live"
              label={businessName ? `${businessName}'s booking page` : "Your booking page"}
              value="live on its own link"
            />
            <StateLine
              state="live"
              label={
                serviceCount > 0
                  ? `${serviceCount} service${serviceCount > 1 ? "s" : ""}`
                  : "Your services"
              }
              value="ready to book"
            />
            <StateLine state="live" label="Booking reminders" value="email and WhatsApp" />
            <StateLine
              state="live"
              label="Assistant, analytics, branded email"
              value="free for the trial"
            />
          </div>
        </div>
      </OnboardingPanel>
    </OnboardingScreenBody>
  );
}

/**
 * Publishes the booking page and writes the completion flag, then hands over.
 *
 * A screen rather than a branch inside the resume effect: the same work has to
 * happen whether the user finished the trial step just now or came back to a
 * plan they had already bought, and one owner for it is what stops the flag
 * being written twice from two places.
 */
function FinishingScreen({ onRun }: { onRun: () => void }) {
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    onRun();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <OnboardingScreenBody
      title="Setting up your booking page"
      description="Putting your services and hours on it, and getting your link ready."
      actions={
        <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Just a moment…
        </div>
      }
    />
  );
}

/**
 * The last screen shows the thing setup built, not a summary of an account that
 * has not done anything yet.
 */
function DoneScreen({
  bookingUrl,
  published,
  businessName,
  onEnter,
}: {
  bookingUrl: string | null;
  /** False when setup was skipped past the services or hours it needed. */
  published: boolean;
  businessName: string;
  onEnter: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!bookingUrl) return;
    try {
      await navigator.clipboard.writeText(bookingUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy the link", { description: "Select it and copy manually." });
    }
  };

  return (
    <div className="flex w-full max-w-xl flex-col items-center pt-4 text-center sm:pt-10">
      <div className="relative">
        <OnboardingMark />
        <motion.span
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.25, type: "spring", stiffness: 400, damping: 20 }}
          className="absolute -bottom-1 -right-1 grid h-8 w-8 place-items-center rounded-full border-2 border-background bg-primary text-primary-foreground"
        >
          <Check className="h-4 w-4" strokeWidth={3} />
        </motion.span>
      </div>

      <h1 className="mt-8 text-balance text-3xl font-semibold leading-tight tracking-tight text-foreground sm:text-[2.75rem] sm:leading-[1.1]">
        {published ? (businessName ? `${businessName} is live` : "You're live") : "You're all set"}
      </h1>
      <p className="mx-auto mt-4 max-w-md text-[0.9375rem] leading-7 text-muted-foreground">
        {published
          ? "Your booking page is published with your services and hours on it. Share this link and clients can book you straight away."
          : "Your account is ready. Add a service and set your opening hours and we'll publish your booking page — it takes a minute from Services and Settings."}
      </p>

      {published && bookingUrl ? (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="mt-8 flex w-full flex-col gap-2 rounded-2xl border border-border/50 bg-card/70 p-3 shadow-sm backdrop-blur sm:flex-row sm:items-center"
        >
          <span className="min-w-0 flex-1 truncate px-2 text-left text-sm font-medium text-foreground">
            {bookingUrl}
          </span>
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" size="sm" onClick={copy}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href={bookingUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4" />
                View
              </a>
            </Button>
          </div>
        </motion.div>
      ) : null}

      <Button size="lg" className="mt-8 min-w-[16rem]" onClick={onEnter}>
        Go to your dashboard
      </Button>

      <p className="mt-5 text-xs leading-5 text-muted-foreground">
        WhatsApp, campaigns and your own email domain are set up from their own pages, whenever
        you&apos;re ready for them.
      </p>
    </div>
  );
}
