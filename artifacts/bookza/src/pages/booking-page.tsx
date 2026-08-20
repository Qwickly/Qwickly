import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import QRCode from "qrcode";
import { TourOverlay, type TourStep } from "@/components/tour/TourOverlay";
import { BackToHelpLink } from "@/components/tour/BackToHelpLink";
import { BOOKING_PAGE_STEP_COPY } from "@/lib/tour-steps";
import {
  bookingPageKeys,
  bookingPageUrl,
  createPublicBooking,
  fetchBookingPage,
  fetchPublishedBookingPage,
  fetchPublicBookingSlots,
  saveBookingPageSettings,
} from "@/lib/booking-page";
import { catalogKeys, fetchServices, fetchStaff } from "@/lib/catalog";
import { fetchOpenDays } from "@/lib/settings";
import type { BookingPageSettings, BookingPageStylePreset } from "@/types/booking-page";
import {
  BACKGROUND_OPTIONS,
  BUTTON_OPTIONS,
  COLOR_PRESETS,
  FONT_OPTIONS,
  HEADER_OPTIONS,
  LAYOUT_OPTIONS,
  LOGO_STYLE_OPTIONS,
  PAGE_WIDTH_OPTIONS,
  PROGRESS_OPTIONS,
  RADIUS_OPTIONS,
  STYLE_PRESETS,
  THEME_MODE_OPTIONS,
  matchStylePreset,
  slugify,
} from "@/types/booking-page";
import { BookingPageView, BookingPagePreviewFrame } from "@/components/booking/BookingPageView";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { PageHeader, PageOverflowMenu } from "@/components/layout/page-ui";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePageChrome } from "@/components/layout/page-chrome";
import { MetricCard } from "@/components/dashboard/metric-card";
import { SettingsToggleRow } from "@/components/settings/settings-ui";
import {
  ChevronDown,
  Eye,
  Monitor,
  Smartphone,
  Link as LinkIcon,
  ExternalLink,
  Download,
  Loader2,
  Palette,
  Layout,
  Image as ImageIcon,
  Settings2,
  Users,
  Scissors,
  Globe2,
  QrCode,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { FormPageSkeleton } from "@/components/skeletons/page-skeletons";

type BuilderStep = "details" | "branding" | "services" | "options" | "share";

const BUILDER_STEPS: Array<{
  id: BuilderStep;
  label: string;
  description: string;
}> = [
  { id: "details", label: "Content", description: "Title, description, and the page's web address" },
  { id: "branding", label: "Look", description: "Cover, logo, colours, and page style" },
  { id: "services", label: "Services", description: "What clients can see and choose from" },
  { id: "options", label: "Options", description: "Deposits, rescheduling, and what to ask for" },
  { id: "share", label: "Share", description: "Your link and QR code" },
];

export default function BookingPageBuilder({ id }: { id: string }) {
  const { resolvedTheme } = useTheme();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [form, setForm] = useState<BookingPageSettings | null>(null);
  const [previewMode, setPreviewMode] = useState<"desktop" | "mobile">(
    "desktop",
  );
  const [selectedStep, setSelectedStep] = useState<BuilderStep>("details");
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [openContactLinks, setOpenContactLinks] = useState({
    contactPhone: false,
    whatsappNumber: false,
    contactEmail: false,
    websiteUrl: false,
    instagramUrl: false,
    facebookUrl: false,
  });
  // Static content — safe to build once. The last nav step's onAdvance
  // switches the builder into its own "publish" panel so the final step can
  // spotlight the real "Publish page" button, the same onAdvance pattern
  // billing.tsx uses to open its add-ons dialog mid-tour.
  const bookingPageTourSteps = useMemo<TourStep[]>(() => {
    const navIds: BuilderStep[] = ["details", "branding", "services", "options"];
    const navSteps: TourStep[] = navIds.map((id) => ({
      targetId: `builder-step-${id}`,
      ...BOOKING_PAGE_STEP_COPY[id],
    }));
    return [
      ...navSteps,
      {
        targetId: "builder-step-share",
        ...BOOKING_PAGE_STEP_COPY.share,
        onAdvance: () => setSelectedStep("share"),
      },
      {
        targetId: "publish-page-button",
        ...BOOKING_PAGE_STEP_COPY.publishAction,
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const settingsTopRef = useRef<HTMLDivElement | null>(null);
  const [advancedStyleOpen, setAdvancedStyleOpen] = useState(false);
  const builderStepItems = useMemo(
    () =>
      BUILDER_STEPS.map((step) => ({
        value: step.id,
        label: step.label,
        dataTourId: `builder-step-${step.id}`,
      })),
    [],
  );

  const { data: saved, isLoading } = useQuery({
    queryKey: bookingPageKeys.page(id),
    queryFn: () => fetchBookingPage(id),
    enabled: Boolean(id),
  });

  const pageChrome = useMemo(
    () => ({
      breadcrumbs: [
        { label: "Booking Pages", href: "/booking-page" },
        { label: saved?.pageTitle || "Booking page", href: `/booking-page/${id}/preview` },
        { label: "Edit" },
      ],
      internalNav: {
        items: builderStepItems,
        active: selectedStep,
        onChange: (value: string) => setSelectedStep(value as BuilderStep),
        ariaLabel: "Builder steps",
      },
    }),
    [builderStepItems, selectedStep, saved?.pageTitle, id],
  );
  usePageChrome(pageChrome);

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

  // A page saved on a custom combination opens with the controls showing, so the
  // "custom" note has something to point at. Once only — reopening it after every
  // save would fight anyone who deliberately collapsed it.
  const advancedDefaultApplied = useRef(false);
  useEffect(() => {
    if (!saved || advancedDefaultApplied.current) return;
    advancedDefaultApplied.current = true;
    if (!matchStylePreset(saved)) setAdvancedStyleOpen(true);
  }, [saved]);


  useEffect(() => {
    if (!form) return;
    setOpenContactLinks((current) => ({
      contactPhone: current.contactPhone || Boolean(form.contactPhone.trim()),
      whatsappNumber: current.whatsappNumber || Boolean(form.whatsappNumber.trim()),
      contactEmail: current.contactEmail || Boolean(form.contactEmail.trim()),
      websiteUrl: current.websiteUrl || Boolean(form.websiteUrl.trim()),
      instagramUrl: current.instagramUrl || Boolean(form.instagramUrl.trim()),
      facebookUrl: current.facebookUrl || Boolean(form.facebookUrl.trim()),
    }));
  }, [form]);

  const saveMutation = useMutation({
    mutationFn: saveBookingPageSettings,
    onSuccess: (data) => {
      setForm(data);
      queryClient.setQueryData(bookingPageKeys.settings, data);
      toast("Booking page saved", { description: "Your changes are live in the preview." });
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
      toast.error("Page title is required");
      return null;
    }
    try {
      const saved = await saveMutation.mutateAsync(payload);
      setForm(saved);
      return saved;
    } catch (err) {
      toast.error("Could not save", { description: err instanceof Error ? err.message : "Please try again" });
      return null;
    }
  };

  const persistCoverImage = (url: string) => {
    const overrides: Partial<BookingPageSettings> = {
      coverImageUrl: url,
      backgroundStyle: "image",
    };
    setForm((prev) => (prev ? { ...prev, ...overrides } : prev));
    void handleSave(overrides);
  };

  const persistLogoImage = (url: string) => {
    update("logoUrl", url);
    void handleSave({ logoUrl: url });
  };

  const removeCoverImage = () => {
    if (!form) return;
    // Cover uploads flip the background to "image"; removing one has to put it
    // back, or the page keeps asking for a cover that is no longer there.
    const overrides: Partial<BookingPageSettings> = { coverImageUrl: null, backgroundStyle: "gradient" };
    setForm((prev) => (prev ? { ...prev, ...overrides } : prev));
    void handleSave(overrides);
  };

  const removeLogoImage = () => {
    update("logoUrl", null);
    void handleSave({ logoUrl: null });
  };

  const draftPublicUrl = form ? bookingPageUrl(form.slug) : "";
  const savedPublishedUrl = saved?.isPublished ? bookingPageUrl(saved.slug) : "";
  const shareUrl = savedPublishedUrl || draftPublicUrl;
  const qrFileName = `qwickly-booking-${slugify(saved?.slug ?? form?.slug ?? "page")}`;

  useEffect(() => {
    let cancelled = false;

    if (!savedPublishedUrl) {
      setQrDataUrl(null);
      return;
    }

    QRCode.toDataURL(savedPublishedUrl, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 640,
      color: {
        dark: "#0f172a",
        light: "#ffffff",
      },
    })
      .then((url: string) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl(null);
      });

    return () => {
      cancelled = true;
    };
  }, [savedPublishedUrl]);

  const handleCopyLink = async () => {
    const url = shareUrl;
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast("Link copied", { description: url });
    } catch {
      toast(url, { description: "Copy the link from your browser address bar." });
    }
  };

  const downloadFile = (url: string, filename: string) => {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const handleDownloadQrPng = () => {
    if (!qrDataUrl) return;
    downloadFile(qrDataUrl, `${qrFileName}.png`);
  };

  const handleDownloadQrSvg = async () => {
    if (!savedPublishedUrl) return;
    try {
      const svg = await QRCode.toString(savedPublishedUrl, {
        type: "svg",
        errorCorrectionLevel: "M",
        margin: 2,
        color: {
          dark: "#0f172a",
          light: "#ffffff",
        },
      });
      const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
      downloadFile(url, `${qrFileName}.svg`);
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Could not download QR code", { description: "Please try again." });
    }
  };

  const handleViewLive = async () => {
    if (!form) return;
    const liveWindow = window.open("about:blank", "_blank");
    if (liveWindow) liveWindow.opener = null;

    if (!saved?.isPublished) {
      liveWindow?.close();
      toast.error("Booking page is not published", { description: "Publish the page before opening the live client link." });
      return;
    }

    const latest = await handleSave({ isPublished: true });
    if (!latest) {
      liveWindow?.close();
      return;
    }

    const url = bookingPageUrl(latest.slug);
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
      depositRequired: s.depositRequired,
      depositAmount: s.depositAmount,
    }));

  const publicStaff = (staff ?? [])
    .filter((s) => s.isActive)
    .map((s) => ({ id: s.id, name: s.name, position: s.position }));

  const activeStylePreset = form ? matchStylePreset(form) : null;

  const applyStylePreset = (preset: BookingPageStylePreset) => {
    setForm((current) => (current ? { ...current, ...preset.values } : current));
  };

  const selectedStepIndex = BUILDER_STEPS.findIndex(
    (step) => step.id === selectedStep,
  );
  const selectedStepMeta = BUILDER_STEPS[selectedStepIndex] ?? BUILDER_STEPS[0];
  const liveIsPublished = Boolean(saved?.isPublished);
  // Which fields differ from what the public page is serving.
  const unsavedFieldCount =
    saved && form
      ? (Object.keys(form) as Array<keyof BookingPageSettings>).filter(
          (key) => JSON.stringify(form[key]) !== JSON.stringify(saved[key]),
        ).length
      : 0;

  const handlePublishChange = async (isPublished: boolean) => {
    // Only one page can be online. Publishing while another is live is refused
    // with the reason rather than silently taking its place — the database
    // enforces the same rule, this is just the half that can explain itself.
    if (isPublished) {
      const live = await fetchPublishedBookingPage();
      if (live && live.id !== id) {
        toast.error("Another page is already live", {
          description: `Take "${live.pageTitle || live.slug}" down first — only one booking page can be online at a time.`,
        });
        return;
      }
    }

    setForm((prev) => (prev ? { ...prev, isPublished } : prev));
    void handleSave({ isPublished });
  };

  const renderSettingsPanel = () => {
    switch (selectedStep) {
      case "details":
        return (
          <>
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
                  qwickly.co.za/book/
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

          <SettingsSection
            icon={<LinkIcon className="h-4 w-4" />}
            title="Contact links"
            description="Optional footer icons. Use only the contact methods you want clients to use."
          >
            <div className="divide-y divide-border/60">
                <ContactLinkToggle
                  title="Phone call"
                  description="Adds a tap-to-call button. Skip this if WhatsApp is your main contact channel."
                  checked={openContactLinks.contactPhone || Boolean(form.contactPhone.trim())}
                  onCheckedChange={(checked) => {
                    setOpenContactLinks((current) => ({ ...current, contactPhone: checked }));
                    if (!checked) update("contactPhone", "");
                  }}
                >
                  <Input
                    value={form.contactPhone}
                    onChange={(e) => update("contactPhone", e.target.value)}
                    placeholder="021 123 4567"
                  />
                </ContactLinkToggle>
                <ContactLinkToggle
                  title="WhatsApp"
                  description="Adds a chat button. Enter the number with country code for the best result."
                  checked={openContactLinks.whatsappNumber || Boolean(form.whatsappNumber.trim())}
                  onCheckedChange={(checked) => {
                    setOpenContactLinks((current) => ({ ...current, whatsappNumber: checked }));
                    if (!checked) update("whatsappNumber", "");
                  }}
                >
                  <Input
                    value={form.whatsappNumber}
                    onChange={(e) => update("whatsappNumber", e.target.value)}
                    placeholder="+27 71 234 5678"
                  />
                </ContactLinkToggle>
                <ContactLinkToggle
                  title="Email"
                  description="Adds an email button for clients who prefer written enquiries."
                  checked={openContactLinks.contactEmail || Boolean(form.contactEmail.trim())}
                  onCheckedChange={(checked) => {
                    setOpenContactLinks((current) => ({ ...current, contactEmail: checked }));
                    if (!checked) update("contactEmail", "");
                  }}
                >
                  <Input
                    value={form.contactEmail}
                    onChange={(e) => update("contactEmail", e.target.value)}
                    placeholder="hello@example.com"
                  />
                </ContactLinkToggle>
                <ContactLinkToggle
                  title="Website"
                  description="Paste the website URL. We’ll add https:// if it is missing."
                  checked={openContactLinks.websiteUrl || Boolean(form.websiteUrl.trim())}
                  onCheckedChange={(checked) => {
                    setOpenContactLinks((current) => ({ ...current, websiteUrl: checked }));
                    if (!checked) update("websiteUrl", "");
                  }}
                >
                  <Input
                    value={form.websiteUrl}
                    onChange={(e) => update("websiteUrl", e.target.value)}
                    placeholder="example.com"
                  />
                </ContactLinkToggle>
                <ContactLinkToggle
                  title="Instagram"
                  description="Paste the full URL, @handle, or just the username."
                  checked={openContactLinks.instagramUrl || Boolean(form.instagramUrl.trim())}
                  onCheckedChange={(checked) => {
                    setOpenContactLinks((current) => ({ ...current, instagramUrl: checked }));
                    if (!checked) update("instagramUrl", "");
                  }}
                >
                  <Input
                    value={form.instagramUrl}
                    onChange={(e) => update("instagramUrl", e.target.value)}
                    placeholder="@yourbusiness"
                  />
                </ContactLinkToggle>
                <ContactLinkToggle
                  title="Facebook"
                  description="Paste the page URL, @page, or just the page name."
                  checked={openContactLinks.facebookUrl || Boolean(form.facebookUrl.trim())}
                  onCheckedChange={(checked) => {
                    setOpenContactLinks((current) => ({ ...current, facebookUrl: checked }));
                    if (!checked) update("facebookUrl", "");
                  }}
                >
                  <Input
                    value={form.facebookUrl}
                    onChange={(e) => update("facebookUrl", e.target.value)}
                    placeholder="yourbusiness"
                  />
                </ContactLinkToggle>
            </div>
          </SettingsSection>
        </>
        );

      case "branding":
        return (
          <>
            <SettingsSection
              icon={<ImageIcon className="h-4 w-4" />}
              title="Images & branding"
              description="Add the visual assets that make the page feel like your business."
            >
              <ImageUploadField
                label="Cover image"
                hint="Used in the booking page header"
                kind="cover"
                aspect="cover"
                value={form.coverImageUrl}
                onChange={(url) => {
                  update("coverImageUrl", url);
                  if (url) update("backgroundStyle", "image");
                }}
                onUploaded={persistCoverImage}
                onRemoved={removeCoverImage}
              />
              <ImageUploadField
                label="Logo"
                hint="Optional. Shown as the business logo on the booking page."
                kind="logo"
                value={form.logoUrl}
                onChange={(url) => update("logoUrl", url)}
                onUploaded={persistLogoImage}
                onRemoved={removeLogoImage}
                aspect="square"
              />
              <div className="space-y-3">
                <Label>Logo background</Label>
                <div className="grid gap-3 sm:grid-cols-2">
                  {LOGO_STYLE_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      className={cn(
                        "rounded-lg border p-4 text-left transition-all",
                        form.logoStyle === opt.value
                          ? "border-primary bg-primary/5 shadow-none ring-1 ring-primary/20"
                          : "border-border/70 bg-card hover:border-primary/60 hover:bg-primary/5",
                      )}
                      onClick={() => update("logoStyle", opt.value)}
                    >
                      <div
                        className={cn(
                          "mb-3 flex h-12 w-12 items-center justify-center rounded-xl text-sm font-bold",
                          opt.value === "glass" && "border border-white/55 bg-white/25 shadow-sm backdrop-blur-md",
                          opt.value === "dark" && "border border-zinc-700 bg-zinc-950 text-white",
                          opt.value === "transparent" && "bg-transparent text-foreground",
                          opt.value === "solid" && "border border-border/70 bg-white text-zinc-950 shadow-sm",
                        )}
                      >
                        Aa
                      </div>
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
            </SettingsSection>
            <SettingsSection
              icon={<Palette className="h-4 w-4" />}
              title="Theme style"
              description="Colours, light or dark, and the overall page style."
            >
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-foreground">
                  Theme colors
                </h3>
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
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
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">
                      Primary color
                    </Label>
                    <div className="flex gap-2">
                      <input
                        type="color"
                        value={form.primaryColor}
                        onChange={(e) => update("primaryColor", e.target.value)}
                        className="h-10 w-12 cursor-pointer rounded-lg border border-border/70 bg-background p-1 shadow-[0_1px_2px_hsl(var(--foreground)/0.04)]"
                      />
                      <Input
                        value={form.primaryColor}
                        onChange={(e) => update("primaryColor", e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">
                      Secondary color
                    </Label>
                    <div className="flex gap-2">
                      <input
                        type="color"
                        value={form.secondaryColor}
                        onChange={(e) => update("secondaryColor", e.target.value)}
                        className="h-10 w-12 cursor-pointer rounded-lg border border-border/70 bg-background p-1 shadow-[0_1px_2px_hsl(var(--foreground)/0.04)]"
                      />
                      <Input
                        value={form.secondaryColor}
                        onChange={(e) => update("secondaryColor", e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-foreground">
                  Client theme
                </h3>
                <div className="grid gap-3 sm:grid-cols-3">
                  {THEME_MODE_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      className={cn(
                        "rounded-lg border p-4 text-left transition-all",
                        form.themeMode === opt.value
                          ? "border-primary bg-primary/5 shadow-none ring-1 ring-primary/20"
                          : "border-border/70 bg-card hover:border-primary/60 hover:bg-primary/5",
                      )}
                      onClick={() => update("themeMode", opt.value)}
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
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-foreground">Page style</h3>
                  <p className="text-xs leading-5 text-muted-foreground">
                    Each style sets the layout, header, background, width, type, corners, buttons and
                    step indicator together. Your colours and logo are applied on top.
                  </p>
                </div>

                <div className="grid gap-3">
                  {STYLE_PRESETS.map((preset) => {
                    const selected = activeStylePreset?.id === preset.id;

                    return (
                      <button
                        key={preset.id}
                        type="button"
                        className={cn(
                          "rounded-lg border p-4 text-left transition-all",
                          selected
                            ? "border-primary bg-primary/5 shadow-none ring-1 ring-primary/20"
                            : "border-border/70 bg-card hover:border-primary/60 hover:bg-primary/5",
                        )}
                        onClick={() => applyStylePreset(preset)}
                      >
                        <p className="text-sm font-semibold text-foreground">{preset.label}</p>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">{preset.description}</p>
                      </button>
                    );
                  })}
                </div>

                {activeStylePreset ? null : (
                  <p className="text-xs leading-5 text-muted-foreground">
                    This page uses a custom combination. It keeps rendering as it is — picking a
                    style above replaces it.
                  </p>
                )}

                <Collapsible open={advancedStyleOpen} onOpenChange={setAdvancedStyleOpen}>
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm" className="-ml-2 gap-1.5 text-muted-foreground">
                      <ChevronDown
                        className={cn(
                          "h-4 w-4 transition-transform duration-200",
                          advancedStyleOpen && "rotate-180",
                        )}
                      />
                      {advancedStyleOpen ? "Hide advanced options" : "Advanced options"}
                    </Button>
                  </CollapsibleTrigger>

                  <CollapsibleContent className="pt-3">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <StyleSelect
                        label="Layout"
                        value={form.layout}
                        options={LAYOUT_OPTIONS}
                        onChange={(value) => update("layout", value as BookingPageSettings["layout"])}
                      />
                      <StyleSelect
                        label="Header"
                        value={form.headerStyle}
                        options={HEADER_OPTIONS}
                        onChange={(value) => update("headerStyle", value as BookingPageSettings["headerStyle"])}
                      />
                      <StyleSelect
                        label="Desktop width"
                        value={form.pageWidth}
                        options={PAGE_WIDTH_OPTIONS}
                        onChange={(value) => update("pageWidth", value as BookingPageSettings["pageWidth"])}
                      />
                      <StyleSelect
                        label="Font"
                        value={form.fontFamily}
                        options={FONT_OPTIONS}
                        onChange={(value) => update("fontFamily", value as BookingPageSettings["fontFamily"])}
                      />
                      <StyleSelect
                        label="Corners"
                        value={form.borderRadius}
                        options={RADIUS_OPTIONS}
                        onChange={(value) => update("borderRadius", value as BookingPageSettings["borderRadius"])}
                      />
                      <StyleSelect
                        label="Buttons"
                        value={form.buttonStyle}
                        options={BUTTON_OPTIONS}
                        onChange={(value) => update("buttonStyle", value as BookingPageSettings["buttonStyle"])}
                      />
                      <StyleSelect
                        label="Step indicator"
                        value={form.progressStyle}
                        options={PROGRESS_OPTIONS}
                        onChange={(value) => update("progressStyle", value as BookingPageSettings["progressStyle"])}
                      />
                      <StyleSelect
                        label="Background"
                        value={form.backgroundStyle}
                        options={BACKGROUND_OPTIONS}
                        onChange={(value) =>
                          update("backgroundStyle", value as BookingPageSettings["backgroundStyle"])
                        }
                      />
                    </div>

                    {form.backgroundStyle === "image" && !form.coverImageUrl ? (
                      <p className="pt-3 text-xs text-amber-600 dark:text-amber-500">
                        Add a cover image above for the image background to show.
                      </p>
                    ) : null}
                  </CollapsibleContent>
                </Collapsible>
              </div>

            </SettingsSection>
          </>
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
            <SettingsToggleRow
              title="Show notes field"
              description="Let clients add extra booking details"
              checked={form.showNotes}
              onCheckedChange={(v) => update("showNotes", v)}
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

      case "share":
        return (
          <SettingsSection
            icon={<Globe2 className="h-4 w-4" />}
            title="Share"
            description="Your public link and a QR code for posters, counters, and social posts."
          >
            <div className="space-y-2">
              <Label>Public booking URL</Label>
              <div className="flex gap-2">
                <Input readOnly value={shareUrl} className="bg-muted/50" />
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

            <div className={cn("pt-1", liveIsPublished ? "" : "opacity-75")}>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <div className="flex h-36 w-36 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-white p-3">
                  {liveIsPublished && qrDataUrl ? (
                    <img src={qrDataUrl} alt="Booking page QR code" className="h-full w-full" />
                  ) : (
                    <QrCode className="h-14 w-14 text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0 flex-1 space-y-3">
                  <div className="space-y-1">
                    <h3 className="text-sm font-semibold text-foreground">
                      Booking QR code
                    </h3>
                    <p className="text-xs leading-5 text-muted-foreground">
                      {liveIsPublished
                        ? "This QR uses the currently published booking link. If you change the custom URL later, download a fresh QR before printing."
                        : "Publish the page to generate a QR code for posters, counters, flyers, and social posts."}
                    </p>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        className="bg-card"
                        disabled={!liveIsPublished || !qrDataUrl}
                      >
                        <Download className="mr-2 h-4 w-4" />
                        Download
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-44">
                      <DropdownMenuItem onClick={handleDownloadQrPng}>
                        PNG image
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => void handleDownloadQrSvg()}>
                        SVG vector
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </div>

            <Button
              variant="outline"
              className="w-full bg-card"
              onClick={handleViewLive}
              disabled={saveMutation.isPending || !liveIsPublished}
            >
              <ExternalLink className="mr-2 h-4 w-4" />
              View live page
            </Button>
          </SettingsSection>
        );

      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      <TourOverlay
        tourId="booking-page"
        steps={bookingPageTourSteps}
        onFinish={() => setLocation("/help")}
      />
      <BackToHelpLink />
      <PageHeader
        title="Booking Page"
        description="Customize your public booking page."
        primaryAction={
          <Button onClick={() => setLocation(`/booking-page/${id}/preview`)}>
            <Eye className="h-4 w-4 sm:mr-2" />
            <span className="sr-only sm:hidden">Preview</span>
            <span className="hidden sm:inline">Preview</span>
          </Button>
        }
        overflowActions={
          <PageOverflowMenu label="Booking page actions">
            <DropdownMenuItem onClick={handleCopyLink}>
              <LinkIcon className="mr-2 h-4 w-4" />
              Copy booking link
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleDownloadQrPng} disabled={!liveIsPublished || !qrDataUrl}>
              <Download className="mr-2 h-4 w-4" />
              Download QR code
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setSelectedStep("share")}>
              <Globe2 className="mr-2 h-4 w-4" />
              Sharing options
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleViewLive} disabled={!liveIsPublished}>
              <ExternalLink className="mr-2 h-4 w-4" />
              Open live page
            </DropdownMenuItem>
          </PageOverflowMenu>
        }
      />

      <Card className="sticky top-0 z-30 border-border/70 shadow-sm">
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "inline-flex h-2 w-2 shrink-0 rounded-full",
                  liveIsPublished ? "bg-primary" : "bg-amber-500",
                )}
              />
              <p className="text-sm font-semibold text-foreground">
                {liveIsPublished ? "Live" : "Draft"}
              </p>
              {unsavedFieldCount > 0 ? (
                <Badge variant="secondary" className="rounded-full text-[11px] font-medium">
                  {unsavedFieldCount} unsaved {unsavedFieldCount === 1 ? "change" : "changes"}
                </Badge>
              ) : null}
            </div>
            <p className="text-xs leading-5 text-muted-foreground">
              {liveIsPublished
                ? unsavedFieldCount > 0
                  ? "Clients are seeing the last saved version. Saving puts these changes live."
                  : "Clients are seeing exactly what is in the preview."
                : "Only you can see this page. Publish it when you are ready for clients."}
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 rounded-md border border-input bg-card px-3 py-1.5 dark:bg-input/30">
              <Label htmlFor="publish-page" className="text-xs font-medium">
                Published
              </Label>
              <Switch
                id="publish-page"
                data-tour-id="publish-page-button"
                checked={form.isPublished}
                onCheckedChange={handlePublishChange}
                disabled={saveMutation.isPending}
              />
            </div>
            <Button
              onClick={() => void handleSave()}
              disabled={saveMutation.isPending || unsavedFieldCount === 0}
            >
              {saveMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {liveIsPublished ? "Save & publish" : "Save changes"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-6 lg:flex-row lg:items-stretch">
        <div
          className={cn(
            "w-full space-y-4 pb-4 lg:shrink-0 lg:grow-0",
            "lg:transition-[flex-basis] lg:duration-300 lg:ease-out",
            previewMode === "mobile" ? "lg:basis-1/2" : "lg:basis-[440px]",
          )}
        >
          <div ref={settingsTopRef} className="space-y-4">{renderSettingsPanel()}</div>

        </div>

        <div
          className={cn(
            "flex-1 flex-col rounded-xl border border-border/50 bg-muted/50 p-4 md:p-6",
            "lg:shrink-0 lg:grow-0 lg:transition-[flex-basis] lg:duration-300 lg:ease-out",
            previewMode === "mobile" ? "lg:basis-1/2" : "lg:basis-[calc(100%-440px-1.5rem)]",
            // Desktop only: on a phone the preview is its own page.
            "hidden lg:flex",
          )}
        >
          <div className="flex min-w-0 flex-1 flex-col lg:sticky lg:top-4 lg:max-h-[calc(100vh-9rem)]">
          <div className="mb-4 hidden shrink-0 items-center justify-center lg:flex">
            <ToggleGroup
              type="single"
              value={previewMode}
              onValueChange={(value) => {
                if (value === "desktop" || value === "mobile") setPreviewMode(value);
              }}
              variant="outline"
              aria-label="Preview size"
            >
              <ToggleGroupItem value="desktop">
                <Monitor className="h-4 w-4" />
                Desktop
              </ToggleGroupItem>
              <ToggleGroupItem value="mobile">
                <Smartphone className="h-4 w-4" />
                Mobile
              </ToggleGroupItem>
            </ToggleGroup>
          </div>

          <div className="flex min-h-0 flex-1 justify-center">
            <BookingPagePreviewFrame
              mode={previewMode}
              slug={form.slug}
            >
            <BookingPageView
              settings={form}
              services={publicServices}
              staff={publicStaff}
              openDays={openDays}
              darkOverride={resolvedTheme === "dark"}
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
                if (!liveIsPublished) {
                  toast.error("Publish your page first", { description: "Turn on Publish page, save, then try booking from the public link." });
                  throw new Error("Booking page is not published.");
                }

                const res = await publicBookingMutation.mutateAsync({
                  slug: form.slug,
                  serviceId: payload.serviceId,
                  staffId: payload.staffId,
                  clientName: payload.clientName,
                  clientPhone: payload.clientPhone,
                  clientEmail: payload.clientEmail,
                  startTime: payload.startTime,
                  notes: payload.notes,
                });

                toast("Booking created", { description: "A pending booking was added to your calendar." });
                return res;
              }}
            />
            </BookingPagePreviewFrame>
          </div>
          </div>
        </div>
      </div>

    </div>
  );
}

function StyleSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
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
      <CardContent className="space-y-5">
        {/* `flex` is load-bearing, not redundant with `flex-row`: stock
            CardHeader is a grid, so a bare `flex-row` is inert on it and the
            icon stacked above the title. `p-0` stays because this header is
            nested inside a CardContent that already supplies px-6. */}
        <CardHeader className="flex flex-row items-start gap-3 border-b border-border/60 p-0">
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

function ContactLinkToggle({
  title,
  description,
  checked,
  onCheckedChange,
  children,
}: {
  title: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  children: ReactNode;
}) {
  return (
    <div className="space-y-3 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-0.5">
          <Label className="text-sm font-semibold text-foreground">{title}</Label>
          <p className="text-xs leading-5 text-muted-foreground">{description}</p>
        </div>
        <Switch checked={checked} onCheckedChange={onCheckedChange} className="shrink-0" />
      </div>
      {checked ? <div>{children}</div> : null}
    </div>
  );
}

function TypePreviewIcon() {
  return (
    <span className="flex h-4 w-4 items-center justify-center rounded border border-primary/20 text-[10px] font-bold leading-none text-primary">
      Aa
    </span>
  );
}
