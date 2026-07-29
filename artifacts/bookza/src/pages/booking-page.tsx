import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  bookingPageKeys,
  bookingPageUrl,
  createPublicBooking,
  fetchBookingPageSettings,
  fetchPublicBookingSlots,
  saveBookingPageSettings,
} from "@/lib/booking-page";
import { sameImageUrl } from "@/lib/booking-page-upload";
import { catalogKeys, fetchServices, fetchStaff } from "@/lib/catalog";
import { fetchOpenDays } from "@/lib/settings";
import type { BookingPageSettings } from "@/types/booking-page";
import {
  BACKGROUND_OPTIONS,
  BUTTON_OPTIONS,
  COLOR_PRESETS,
  FONT_OPTIONS,
  HEADER_OPTIONS,
  LAYOUT_OPTIONS,
  RADIUS_OPTIONS,
  slugify,
} from "@/types/booking-page";
import { BookingPagePreview } from "@/components/booking/BookingPagePreview";
import { ImageUploadField } from "@/components/booking/ImageUploadField";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/layout/page-ui";
import { MetricCard } from "@/components/dashboard/metric-card";
import { SettingsToggleRow } from "@/components/settings/settings-ui";
import {
  Monitor,
  Smartphone,
  Link as LinkIcon,
  ExternalLink,
  Save,
  Loader2,
  Palette,
  Layout,
  Image as ImageIcon,
  Settings2,
  Users,
  Scissors,
  Globe2,
  ArrowLeft,
  ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { FormPageSkeleton } from "@/components/skeletons/page-skeletons";

type BuilderStep =
  | "details"
  | "branding"
  | "services"
  | "options"
  | "theme"
  | "publish";

const BUILDER_STEPS: Array<{
  id: BuilderStep;
  label: string;
  description: string;
}> = [
  { id: "details", label: "Page details", description: "Copy, title, and URL" },
  {
    id: "branding",
    label: "Images & branding",
    description: "Cover image and logo",
  },
  {
    id: "services",
    label: "Services & staff",
    description: "What clients can see",
  },
  {
    id: "options",
    label: "Booking options",
    description: "Deposits and changes",
  },
  {
    id: "theme",
    label: "Theme style",
    description: "Layout, colors, and controls",
  },
  {
    id: "publish",
    label: "Publish & link",
    description: "Visibility and sharing",
  },
];

export default function BookingPageBuilder() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<BookingPageSettings | null>(null);
  const [previewMode, setPreviewMode] = useState<"desktop" | "mobile">(
    "desktop",
  );
  const [selectedStep, setSelectedStep] = useState<BuilderStep>("details");
  const [mobileView, setMobileView] = useState<"edit" | "preview">("preview");
  const [isDesktopViewport, setIsDesktopViewport] = useState(true);
  const settingsTopRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const sync = () => setIsDesktopViewport(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const { data: saved, isLoading } = useQuery({
    queryKey: bookingPageKeys.settings,
    queryFn: fetchBookingPageSettings,
  });

  const { data: services } = useQuery({
    queryKey: catalogKeys.services,
    queryFn: fetchServices,
  });

  const { data: staff } = useQuery({
    queryKey: catalogKeys.staff,
    queryFn: fetchStaff,
  });

  const { data: openDays } = useQuery({
    queryKey: ["booking-page", "open-days"],
    queryFn: fetchOpenDays,
  });

  useEffect(() => {
    if (saved && !form) setForm(saved);
  }, [saved, form]);

  const saveMutation = useMutation({
    mutationFn: saveBookingPageSettings,
    onSuccess: (data) => {
      setForm(data);
      queryClient.setQueryData(bookingPageKeys.settings, data);
      toast({
        title: "Booking page saved",
        description: "Your changes are live in the preview.",
      });
    },
  });

  const publicBookingMutation = useMutation({
    mutationFn: createPublicBooking,
  });

  const update = <K extends keyof BookingPageSettings>(
    key: K,
    value: BookingPageSettings[K],
  ) => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const handleSave = async (overrides?: Partial<BookingPageSettings>) => {
    const payload = form ? { ...form, ...overrides } : null;
    if (!payload) return null;
    if (!payload.pageTitle.trim()) {
      toast({ title: "Page title is required", variant: "destructive" });
      return null;
    }
    try {
      const saved = await saveMutation.mutateAsync(payload);
      setForm(saved);
      return saved;
    } catch (err) {
      toast({
        title: "Could not save",
        description: err instanceof Error ? err.message : "Please try again",
        variant: "destructive",
      });
      return null;
    }
  };

  const persistCoverImage = (url: string) => {
    const overrides: Partial<BookingPageSettings> = { coverImageUrl: url };
    if (!form?.logoUrl) overrides.logoUrl = url;
    setForm((prev) => (prev ? { ...prev, ...overrides } : prev));
    void handleSave(overrides);
  };

  const persistLogoImage = (url: string) => {
    update("logoUrl", url);
    void handleSave({ logoUrl: url });
  };

  const removeCoverImage = () => {
    if (!form) return;
    const overrides: Partial<BookingPageSettings> = { coverImageUrl: null };
    if (sameImageUrl(form.logoUrl, form.coverImageUrl))
      overrides.logoUrl = null;
    setForm((prev) => (prev ? { ...prev, ...overrides } : prev));
    void handleSave(overrides);
  };

  const removeLogoImage = () => {
    update("logoUrl", null);
    void handleSave({ logoUrl: null });
  };

  const handleCopyLink = async () => {
    if (!form) return;
    const url = bookingPageUrl(form.slug);
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Link copied", description: url });
    } catch {
      toast({
        title: url,
        description: "Copy the link from your browser address bar.",
      });
    }
  };

  const handleViewLive = async () => {
    if (!form) return;
    const liveWindow = window.open("about:blank", "_blank");
    if (liveWindow) liveWindow.opener = null;

    const saved = await handleSave({ isPublished: true });
    if (!saved) {
      liveWindow?.close();
      return;
    }

    const url = bookingPageUrl(saved.slug);
    if (liveWindow) {
      liveWindow.location.href = url;
      return;
    }

    window.open(url, "_blank", "noopener,noreferrer");
  };

  if (isLoading || !form) {
    return <FormPageSkeleton />;
  }

  const publicServices = (services ?? [])
    .filter((s) => s.isActive)
    .map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      price: s.price,
      duration: s.duration,
    }));

  const publicStaff = (staff ?? [])
    .filter((s) => s.isActive)
    .map((s) => ({ id: s.id, name: s.name, position: s.position }));

  const selectedStepMeta =
    BUILDER_STEPS.find((step) => step.id === selectedStep) ?? BUILDER_STEPS[0];
  const selectedStepIndex = BUILDER_STEPS.findIndex(
    (step) => step.id === selectedStep,
  );
  const isFirstStep = selectedStepIndex <= 0;
  const isLastStep = selectedStepIndex === BUILDER_STEPS.length - 1;
  const publicUrl = bookingPageUrl(form.slug);
  const hasUnsavedBookingPageSettings =
    Boolean(saved && form) && JSON.stringify(form) !== JSON.stringify(saved);

  const goToStep = (index: number) => {
    const nextStep = BUILDER_STEPS[index];
    if (!nextStep) return;

    setSelectedStep(nextStep.id);

    if (window.matchMedia("(max-width: 1023px)").matches) {
      window.requestAnimationFrame(() => {
        settingsTopRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });
    }
  };

  const handlePublish = () => {
    void handleSave({ isPublished: true });
  };

  const handleUnpublish = () => {
    void handleSave({ isPublished: false });
  };

  const renderSettingsPanel = () => {
    switch (selectedStep) {
      case "details":
        return (
          <SettingsSection
            icon={<Globe2 className="h-4 w-4" />}
            title="Page details"
            description="Set the core copy and public URL for your booking page."
          >
            <div className="space-y-2">
              <Label>Page title</Label>
              <Input
                value={form.pageTitle}
                onChange={(e) => update("pageTitle", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                className="resize-none"
                rows={3}
                value={form.description}
                onChange={(e) => update("description", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Welcome message</Label>
              <Textarea
                className="resize-none"
                rows={2}
                placeholder="Optional note shown above services"
                value={form.welcomeMessage}
                onChange={(e) => update("welcomeMessage", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Custom URL</Label>
              <div className="flex">
                <span className="inline-flex shrink-0 items-center rounded-l-md border border-r-0 bg-muted px-3 text-sm text-muted-foreground">
                  qwickly.com/
                </span>
                <Input
                  className="rounded-l-none"
                  value={form.slug}
                  onChange={(e) => update("slug", slugify(e.target.value))}
                />
              </div>
              <p className="text-xs leading-5 text-muted-foreground">
                If another business already uses this URL, Qwickly will add a
                number when you save so every booking link stays unique.
              </p>
            </div>
          </SettingsSection>
        );

      case "branding":
        return (
          <SettingsSection
            icon={<ImageIcon className="h-4 w-4" />}
            title="Images & branding"
            description="Add the visual assets that make the page feel like your business."
          >
            <ImageUploadField
              label="Cover image"
              hint="Used in the header and as your logo when no separate logo is uploaded"
              kind="cover"
              aspect="cover"
              value={form.coverImageUrl}
              onChange={(url) => {
                update("coverImageUrl", url);
                if (url && !form.logoUrl) update("logoUrl", url);
              }}
              onUploaded={persistCoverImage}
              onRemoved={removeCoverImage}
            />
            <ImageUploadField
              label="Logo"
              hint="Optional. Uses your cover image if left empty."
              kind="logo"
              value={form.logoUrl}
              fallbackPreviewUrl={form.coverImageUrl}
              onChange={(url) => update("logoUrl", url)}
              onUploaded={persistLogoImage}
              onRemoved={removeLogoImage}
              aspect="square"
            />
          </SettingsSection>
        );

      case "services":
        return (
          <SettingsSection
            icon={<Users className="h-4 w-4" />}
            title="Services & staff"
            description="Control what service and staff information appears during booking."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <MetricCard
                title="Active services"
                numericValue={publicServices.length}
                formatValue={(v) => v.toLocaleString()}
                icon={Scissors}
                detail=""
                loading={false}
              />
              <MetricCard
                title="Active staff"
                numericValue={publicStaff.length}
                formatValue={(v) => v.toLocaleString()}
                icon={Users}
                detail=""
                loading={false}
              />
            </div>
            <div className="rounded-lg border border-primary/15 bg-primary/5 p-4">
              <div className="flex flex-col gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">
                    Manage availability shown to clients
                  </h3>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    Active services and staff are pulled from your existing
                    management pages.
                  </p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button variant="outline" className="bg-card" asChild>
                    <a href="/services">Manage services</a>
                  </Button>
                  <Button variant="outline" className="bg-card" asChild>
                    <a href="/staff">Manage staff</a>
                  </Button>
                </div>
              </div>
            </div>
            <SettingsToggleRow
              title="Show staff selection"
              description="Let clients pick a specific person"
              checked={form.showStaffSelection}
              onCheckedChange={(v) => update("showStaffSelection", v)}
            />
            <SettingsToggleRow
              title="Show prices"
              description="Display service prices on the page"
              checked={form.showPrices}
              onCheckedChange={(v) => update("showPrices", v)}
            />
            <SettingsToggleRow
              title="Show duration"
              description="Display service length"
              checked={form.showDuration}
              onCheckedChange={(v) => update("showDuration", v)}
            />
          </SettingsSection>
        );

      case "options":
        return (
          <SettingsSection
            icon={<Settings2 className="h-4 w-4" />}
            title="Booking options"
            description="Set the rules clients follow when creating or changing bookings."
          >
            <SettingsToggleRow
              title="Require deposit"
              description="Force payment before confirming"
              checked={form.requireDeposit}
              onCheckedChange={(v) => update("requireDeposit", v)}
            />
            <SettingsToggleRow
              title="Allow rescheduling"
              description="Clients can move appointments"
              checked={form.allowRescheduling}
              onCheckedChange={(v) => update("allowRescheduling", v)}
            />
          </SettingsSection>
        );

      case "theme":
        return (
          <SettingsSection
            icon={<Palette className="h-4 w-4" />}
            title="Theme style"
            description="Tune the layout, typography, buttons, and colors."
          >
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Layout className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">
                  Layout
                </h3>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {LAYOUT_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={cn(
                      "rounded-lg border p-4 text-left transition-all",
                      form.layout === opt.value
                        ? "border-primary bg-primary/5 shadow-none ring-1 ring-primary/20"
                        : "border-border/70 bg-card hover:border-primary/60 hover:bg-primary/5",
                    )}
                    onClick={() => update("layout", opt.value)}
                  >
                    <p className="text-sm font-semibold text-foreground">
                      {opt.label}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {opt.description}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <TypePreviewIcon />
                <h3 className="text-sm font-semibold text-foreground">
                  Font style
                </h3>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {FONT_OPTIONS.map((font) => (
                  <button
                    key={font.value}
                    type="button"
                    className={cn(
                      "rounded-lg border p-4 text-left transition-all",
                      form.fontFamily === font.value
                        ? "border-primary bg-primary/5 shadow-none ring-1 ring-primary/20"
                        : "border-border/70 bg-card hover:border-primary/60 hover:bg-primary/5",
                    )}
                    style={{ fontFamily: font.css }}
                    onClick={() =>
                      update(
                        "fontFamily",
                        font.value as BookingPageSettings["fontFamily"],
                      )
                    }
                  >
                    <p className="text-lg font-semibold text-foreground">
                      {font.label}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      The quick brown fox
                    </p>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground">
                Header style
              </h3>
              <div className="grid gap-3 sm:grid-cols-3">
                {HEADER_OPTIONS.map((header) => (
                  <button
                    key={header.value}
                    type="button"
                    className={cn(
                      "rounded-lg border p-3 text-left transition-all",
                      form.headerStyle === header.value
                        ? "border-primary bg-primary/5 shadow-none ring-1 ring-primary/20"
                        : "border-border/70 bg-card hover:border-primary/60 hover:bg-primary/5",
                    )}
                    onClick={() =>
                      update(
                        "headerStyle",
                        header.value as BookingPageSettings["headerStyle"],
                      )
                    }
                  >
                    <div className="overflow-hidden rounded-md border border-border/60 bg-white">
                      {header.value === "banner" ? (
                        <>
                          <div
                            className="h-10"
                            style={{
                              background: `linear-gradient(135deg, ${form.primaryColor}, ${form.secondaryColor})`,
                            }}
                          />
                          <div className="space-y-1 p-2">
                            <div className="h-2 w-16 rounded bg-zinc-300" />
                            <div className="h-1.5 w-24 rounded bg-zinc-200" />
                          </div>
                        </>
                      ) : header.value === "centered" ? (
                        <div
                          className="space-y-2 p-3 text-center"
                          style={{
                            background: `linear-gradient(135deg, ${form.primaryColor}, ${form.secondaryColor})`,
                          }}
                        >
                          <div className="mx-auto h-6 w-6 rounded-full bg-white/80" />
                          <div className="mx-auto h-2 w-16 rounded bg-white/80" />
                          <div className="mx-auto h-1.5 w-24 rounded bg-white/50" />
                        </div>
                      ) : (
                        <div
                          className="flex items-center gap-2 p-3"
                          style={{ background: form.primaryColor }}
                        >
                          <div className="h-6 w-6 rounded bg-white/80" />
                          <div className="h-2 w-20 rounded bg-white/80" />
                        </div>
                      )}
                    </div>
                    <p className="mt-2 text-sm font-semibold text-foreground">
                      {header.label}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground">
                Corner radius
              </h3>
              <div className="grid gap-3 sm:grid-cols-3">
                {RADIUS_OPTIONS.map((radius) => (
                  <button
                    key={radius.value}
                    type="button"
                    className={cn(
                      "rounded-lg border p-4 text-left transition-all",
                      form.borderRadius === radius.value
                        ? "border-primary bg-primary/5 shadow-none ring-1 ring-primary/20"
                        : "border-border/70 bg-card hover:border-primary/60 hover:bg-primary/5",
                    )}
                    onClick={() =>
                      update(
                        "borderRadius",
                        radius.value as BookingPageSettings["borderRadius"],
                      )
                    }
                  >
                    <div
                      className="h-12 border border-primary/30 bg-primary/10"
                      style={{ borderRadius: radius.css }}
                    />
                    <p className="mt-2 text-sm font-semibold text-foreground">
                      {radius.label}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground">
                Button style
              </h3>
              <div className="grid gap-3 sm:grid-cols-3">
                {BUTTON_OPTIONS.map((button) => (
                  <button
                    key={button.value}
                    type="button"
                    className={cn(
                      "rounded-lg border p-4 text-left transition-all",
                      form.buttonStyle === button.value
                        ? "border-primary bg-primary/5 shadow-none ring-1 ring-primary/20"
                        : "border-border/70 bg-card hover:border-primary/60 hover:bg-primary/5",
                    )}
                    onClick={() =>
                      update(
                        "buttonStyle",
                        button.value as BookingPageSettings["buttonStyle"],
                      )
                    }
                  >
                    <div
                      className={cn(
                        "flex h-10 items-center justify-center px-3 text-sm font-semibold",
                        button.value === "outline" && "border-2 bg-transparent",
                        button.value === "soft" && "border-0",
                        button.value === "filled" && "border-0 text-white",
                      )}
                      style={{
                        borderColor: form.primaryColor,
                        backgroundColor:
                          button.value === "filled"
                            ? form.primaryColor
                            : button.value === "soft"
                              ? `${form.primaryColor}22`
                              : "transparent",
                        color:
                          button.value === "filled"
                            ? "white"
                            : form.primaryColor,
                        borderRadius:
                          RADIUS_OPTIONS.find(
                            (radius) => radius.value === form.borderRadius,
                          )?.css ?? "0.5rem",
                      }}
                    >
                      Book now
                    </div>
                    <p className="mt-2 text-sm font-semibold text-foreground">
                      {button.label}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground">
                Theme color presets
              </h3>
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                {COLOR_PRESETS.map((preset) => (
                  <button
                    key={preset.name}
                    type="button"
                    title={preset.name}
                    className={cn(
                      "h-12 rounded-lg border border-border/50 transition-transform hover:scale-[1.03]",
                      form.primaryColor === preset.primary &&
                        "ring-2 ring-primary ring-offset-2",
                    )}
                    style={{
                      background: `linear-gradient(135deg, ${preset.primary}, ${preset.secondary})`,
                    }}
                    onClick={() =>
                      setForm((prev) =>
                        prev
                          ? {
                              ...prev,
                              primaryColor: preset.primary,
                              secondaryColor: preset.secondary,
                            }
                          : prev,
                      )
                    }
                  />
                ))}
              </div>
            </div>

            <details className="group rounded-lg border border-border/70 bg-card p-4">
              <summary className="cursor-pointer text-sm font-semibold text-foreground">
                Advanced color controls
              </summary>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">
                    Primary
                  </Label>
                  <div className="flex gap-2">
                    <input
                      type="color"
                      value={form.primaryColor}
                      onChange={(e) => update("primaryColor", e.target.value)}
                      className="h-10 w-10 cursor-pointer rounded-lg border border-border/70 bg-background p-1 shadow-[0_1px_2px_hsl(var(--foreground)/0.04)]"
                    />
                    <Input
                      value={form.primaryColor}
                      onChange={(e) => update("primaryColor", e.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">
                    Secondary
                  </Label>
                  <div className="flex gap-2">
                    <input
                      type="color"
                      value={form.secondaryColor}
                      onChange={(e) => update("secondaryColor", e.target.value)}
                      className="h-10 w-10 cursor-pointer rounded-lg border border-border/70 bg-background p-1 shadow-[0_1px_2px_hsl(var(--foreground)/0.04)]"
                    />
                    <Input
                      value={form.secondaryColor}
                      onChange={(e) => update("secondaryColor", e.target.value)}
                    />
                  </div>
                </div>
              </div>
            </details>

            <div className="space-y-3">
              <Label>Header background</Label>
              <div className="grid grid-cols-3 gap-2">
                {BACKGROUND_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={cn(
                      "rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                      form.backgroundStyle === opt.value
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-border/70 hover:bg-muted/50",
                    )}
                    onClick={() => update("backgroundStyle", opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {form.backgroundStyle === "image" && !form.coverImageUrl && (
                <p className="text-xs text-amber-600 dark:text-amber-500">
                  Add a cover image in Images & branding.
                </p>
              )}
            </div>
          </SettingsSection>
        );

      case "publish":
        return (
          <SettingsSection
            icon={<Globe2 className="h-4 w-4" />}
            title="Publish & link"
            description="Control whether the page is live and share the booking link."
          >
            <Card className="border-border/70 shadow-none">
              <CardContent className="flex items-center justify-between p-4">
                <div className="space-y-1 pr-4">
                  <Label className="font-medium">Publish page</Label>
                  <p className="text-xs leading-5 text-muted-foreground">
                    {form.isPublished
                      ? "Your page is live. Save changes to update what clients see."
                      : "Draft pages are hidden from clients until published and saved."}
                  </p>
                </div>
                <Switch
                  checked={form.isPublished}
                  onCheckedChange={(v) => update("isPublished", v)}
                />
              </CardContent>
            </Card>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                onClick={handlePublish}
                disabled={saveMutation.isPending}
              >
                {saveMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Publish page
              </Button>
              {form.isPublished ? (
                <Button
                  variant="outline"
                  className="bg-card"
                  onClick={handleUnpublish}
                  disabled={saveMutation.isPending}
                >
                  Unpublish
                </Button>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label>Public booking URL</Label>
              <div className="flex gap-2">
                <Input readOnly value={publicUrl} className="bg-muted/50" />
                <Button
                  variant="outline"
                  className="shrink-0 bg-card"
                  onClick={handleCopyLink}
                >
                  <LinkIcon className="mr-2 h-4 w-4" />
                  Copy
                </Button>
              </div>
            </div>
            <div className="rounded-lg border border-primary/15 bg-primary/5 p-4">
              <h3 className="text-sm font-semibold text-foreground">
                {form.isPublished ? "Published page" : "Draft page"}
              </h3>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {form.isPublished
                  ? "Clients can use this link to choose services, staff, and available times."
                  : "Use the preview to finish setup, then publish when you are ready to accept bookings."}
              </p>
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <Button
                  variant="outline"
                  className="bg-card"
                  onClick={handleCopyLink}
                >
                  <LinkIcon className="mr-2 h-4 w-4" />
                  Copy Link
                </Button>
                <Button
                  variant="outline"
                  className="bg-card"
                  onClick={handleViewLive}
                  disabled={saveMutation.isPending}
                >
                  <ExternalLink className="mr-2 h-4 w-4" />
                  View Live
                </Button>
              </div>
            </div>
          </SettingsSection>
        );

      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Booking Page"
        description="Customize your public booking page."
        actions={
          <>
            <Badge
              variant="outline"
              className={cn(
                "rounded-full px-2.5 py-1 text-xs font-semibold",
                form.isPublished
                  ? "border-primary/20 bg-primary/10 text-primary"
                  : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-400",
              )}
            >
              {form.isPublished ? "Published" : "Unpublished"}
            </Badge>
            <Button variant="outline" className="bg-card" onClick={handleCopyLink}>
              <LinkIcon className="w-4 h-4 mr-2" />
              Copy Link
            </Button>
            <Button
              variant="outline"
              className="bg-card"
              onClick={handleViewLive}
              disabled={saveMutation.isPending}
            >
              <ExternalLink className="w-4 h-4 mr-2" />
              View Live
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-2 shrink-0 lg:hidden">
        <Button
          variant={mobileView === "edit" ? "default" : "outline"}
          onClick={() => setMobileView("edit")}
        >
          Edit
        </Button>
        <Button
          variant={mobileView === "preview" ? "default" : "outline"}
          onClick={() => setMobileView("preview")}
        >
          Preview
        </Button>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div
          className={cn(
            "w-full flex-1 min-h-0 overflow-y-auto pr-2 pb-4 space-y-4 lg:w-[440px] lg:flex-none",
            mobileView === "preview" && "hidden lg:block",
          )}
        >
          <Card className="border-border/60 shadow-none">
            <CardContent className="p-3">
              <div className="mb-3 hidden px-2 lg:block">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Builder steps
                </p>
              </div>
              <nav className="grid grid-cols-3 gap-2">
                {BUILDER_STEPS.map((step, index) => (
                  <button
                    key={step.id}
                    type="button"
                    onClick={() => setSelectedStep(step.id)}
                    className={cn(
                      "min-w-0 rounded-lg border p-2 text-center transition-colors lg:p-3",
                      selectedStep === step.id
                        ? "border-primary bg-primary/5 text-primary shadow-none"
                        : "border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                    )}
                  >
                    <div className="flex items-center justify-center gap-2">
                      <span
                        className={cn(
                          "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                          selectedStep === step.id
                            ? "bg-primary text-white"
                            : "bg-muted text-muted-foreground",
                        )}
                      >
                        {index + 1}
                      </span>
                    </div>
                  </button>
                ))}
              </nav>
            </CardContent>
          </Card>

          <Card
            ref={settingsTopRef}
            className="border-border/60 bg-card/75 shadow-none"
          >
            <CardContent className="p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-primary">
                Step {selectedStepIndex + 1} of {BUILDER_STEPS.length}
              </p>
              <h2 className="mt-1 text-xl font-semibold text-foreground">
                {selectedStepMeta.label}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {selectedStepMeta.description}
              </p>
            </CardContent>
          </Card>

          {renderSettingsPanel()}

          <Card className="border-border/60 bg-card/75 shadow-none">
            <CardContent className="flex flex-col-reverse gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
              <Button
                variant="outline"
                className="bg-card"
                onClick={() => goToStep(selectedStepIndex - 1)}
                disabled={isFirstStep}
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back
              </Button>

              {isLastStep ? (
                <div className="flex flex-col gap-2 sm:flex-row">
                  {form.isPublished ? (
                    <Button
                      variant="outline"
                      className="bg-card"
                      onClick={handleUnpublish}
                      disabled={saveMutation.isPending}
                    >
                      Unpublish
                    </Button>
                  ) : null}
                  <Button
                    onClick={handlePublish}
                    disabled={saveMutation.isPending}
                  >
                    {saveMutation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : null}
                    Publish page
                  </Button>
                </div>
              ) : (
                <Button onClick={() => goToStep(selectedStepIndex + 1)}>
                  Next
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              )}
            </CardContent>
          </Card>
        </div>

        <div
          className={cn(
            "flex-1 bg-muted/50 rounded-xl border border-border/50 p-4 md:p-6 flex-col min-h-0",
            mobileView === "edit" ? "hidden lg:flex" : "flex",
          )}
        >
          <div className="hidden items-center justify-center gap-2 mb-4 shrink-0 lg:flex">
            <div className="bg-card border rounded-md p-1 flex">
              <Button
                variant={previewMode === "desktop" ? "secondary" : "ghost"}
                size="sm"
                className="h-8"
                onClick={() => setPreviewMode("desktop")}
              >
                <Monitor className="w-4 h-4 mr-2" /> Desktop
              </Button>
              <Button
                variant={previewMode === "mobile" ? "secondary" : "ghost"}
                size="sm"
                className="h-8"
                onClick={() => setPreviewMode("mobile")}
              >
                <Smartphone className="w-4 h-4 mr-2" /> Mobile
              </Button>
            </div>
          </div>

          <div className="flex-1 flex justify-center min-h-0 overflow-y-auto">
            <BookingPagePreview
              settings={form}
              services={publicServices}
              staff={publicStaff}
              openDays={openDays}
              previewMode={isDesktopViewport ? previewMode : "mobile"}
              slug={form.slug}
              onFetchSlots={(input) =>
                fetchPublicBookingSlots({
                  slug: form.slug,
                  serviceId: input.serviceId,
                  staffId: input.staffId,
                  date: input.date,
                })
              }
              onSubmitBooking={async (payload) => {
                if (!form.isPublished) {
                  toast({
                    title: "Publish your page first",
                    description:
                      "Turn on Publish page, save, then try booking from the public link.",
                    variant: "destructive",
                  });
                  throw new Error("Booking page is not published.");
                }

                const res = await publicBookingMutation.mutateAsync({
                  slug: form.slug,
                  serviceId: payload.serviceId,
                  staffId: payload.staffId,
                  clientName: payload.clientName,
                  clientPhone: payload.clientPhone,
                  startTime: payload.startTime,
                  notes: payload.notes,
                });

                toast({
                  title: "Booking created",
                  description: "A pending booking was added to your calendar.",
                });
                return res;
              }}
            />
          </div>
        </div>
      </div>

      {hasUnsavedBookingPageSettings && (
        <div className="fixed bottom-5 right-5 z-50 sm:bottom-6 sm:right-6">
          <Button
            className="h-11 rounded-full px-5 shadow-lg shadow-primary/20 duration-200 ease-out animate-in fade-in slide-in-from-bottom-2"
            onClick={() => void handleSave()}
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? (
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
    </div>
  );
}

function SettingsSection({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Card className="border-border/60 shadow-none">
      <CardContent className="space-y-5 p-5">
        <CardHeader className="flex-row items-start gap-3 space-y-0 border-b border-border/60 p-0 pb-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/15 bg-primary/10 text-primary">
            {icon}
          </div>
          <div className="space-y-1">
            <CardTitle className="text-base">{title}</CardTitle>
            <CardDescription className="leading-6">{description}</CardDescription>
          </div>
        </CardHeader>
        {children}
      </CardContent>
    </Card>
  );
}

function TypePreviewIcon() {
  return (
    <span className="flex h-4 w-4 items-center justify-center rounded border border-primary/20 text-[10px] font-bold leading-none text-primary">
      Aa
    </span>
  );
}
