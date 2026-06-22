import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  bookingPageKeys,
  bookingPageUrl,
  createPublicBooking,
  fetchBookingPageSettings,
  saveBookingPageSettings,
} from "@/lib/booking-page";
import { sameImageUrl } from "@/lib/booking-page-upload";
import { catalogKeys, fetchServices, fetchStaff } from "@/lib/catalog";
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
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Monitor,
  Smartphone,
  Link as LinkIcon,
  ExternalLink,
  Save,
  Loader2,
  Palette,
  Layout,
  Type,
} from "lucide-react";
import { cn } from "@/lib/utils";

export default function BookingPageBuilder() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<BookingPageSettings | null>(null);
  const [previewMode, setPreviewMode] = useState<"desktop" | "mobile">("desktop");

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

  useEffect(() => {
    if (saved && !form) setForm(saved);
  }, [saved, form]);

  const saveMutation = useMutation({
    mutationFn: saveBookingPageSettings,
    onSuccess: (data) => {
      setForm(data);
      queryClient.setQueryData(bookingPageKeys.settings, data);
      toast({ title: "Booking page saved", description: "Your changes are live in the preview." });
    },
  });

  const publicBookingMutation = useMutation({
    mutationFn: createPublicBooking,
  });

  const update = <K extends keyof BookingPageSettings>(key: K, value: BookingPageSettings[K]) => {
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
    if (sameImageUrl(form.logoUrl, form.coverImageUrl)) overrides.logoUrl = null;
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
      toast({ title: url, description: "Copy the link from your browser address bar." });
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
    return (
      <div className="h-[60vh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
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

  return (
    <div className="space-y-6 h-[calc(100vh-8rem)] flex flex-col">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 shrink-0">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Booking Page</h1>
          <p className="text-muted-foreground text-sm">Customize your public booking page.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" className="bg-card" onClick={handleCopyLink}>
            <LinkIcon className="w-4 h-4 mr-2" />
            Copy Link
          </Button>
          <Button variant="outline" className="bg-card" onClick={handleViewLive} disabled={saveMutation.isPending}>
            <ExternalLink className="w-4 h-4 mr-2" />
            View Live
          </Button>
          <Button className="bg-primary hover:bg-primary/90" onClick={() => void handleSave()} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
            Save Changes
          </Button>
        </div>
      </div>

      <div className="flex-1 flex flex-col lg:flex-row gap-6 min-h-0">
        <div className="w-full lg:w-[420px] shrink-0 overflow-y-auto pr-2 pb-4 space-y-4">
          <Tabs defaultValue="general">
            <TabsList className="w-full grid grid-cols-3 bg-card mb-4">
              <TabsTrigger value="general">General</TabsTrigger>
              <TabsTrigger value="design">Design</TabsTrigger>
              <TabsTrigger value="style">Style</TabsTrigger>
            </TabsList>

            <TabsContent value="general" className="space-y-4 m-0">
              <Card className="shadow-sm">
                <CardContent className="p-4 space-y-4">
                  <div className="space-y-2">
                    <Label>Page title</Label>
                    <Input value={form.pageTitle} onChange={(e) => update("pageTitle", e.target.value)} />
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
                      <span className="inline-flex items-center px-3 rounded-l-md border border-r-0 bg-muted text-muted-foreground text-sm shrink-0">
                        bookza.com/
                      </span>
                      <Input
                        className="rounded-l-none"
                        value={form.slug}
                        onChange={(e) => update("slug", slugify(e.target.value))}
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t">
                    <div>
                      <Label className="font-medium">Publish page</Label>
                      <p className="text-xs text-muted-foreground">Make your page visible at the public URL</p>
                    </div>
                    <Switch checked={form.isPublished} onCheckedChange={(v) => update("isPublished", v)} />
                  </div>
                </CardContent>
              </Card>

              <Card className="shadow-sm">
                <CardContent className="p-4 space-y-4">
                  <h3 className="font-medium text-sm">Booking preferences</h3>
                  <ToggleRow
                    label="Require deposit"
                    hint="Force payment before confirming"
                    checked={form.requireDeposit}
                    onChange={(v) => update("requireDeposit", v)}
                  />
                  <ToggleRow
                    label="Allow rescheduling"
                    hint="Clients can move appointments"
                    checked={form.allowRescheduling}
                    onChange={(v) => update("allowRescheduling", v)}
                  />
                  <ToggleRow
                    label="Show staff selection"
                    hint="Let clients pick a specific person"
                    checked={form.showStaffSelection}
                    onChange={(v) => update("showStaffSelection", v)}
                  />
                  <ToggleRow
                    label="Show prices"
                    hint="Display service prices on the page"
                    checked={form.showPrices}
                    onChange={(v) => update("showPrices", v)}
                  />
                  <ToggleRow
                    label="Show duration"
                    hint="Display service length"
                    checked={form.showDuration}
                    onChange={(v) => update("showDuration", v)}
                  />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="design" className="space-y-4 m-0">
              <Card className="shadow-sm">
                <CardContent className="p-4 space-y-4">
                  <div className="flex items-center gap-2">
                    <Layout className="w-4 h-4" />
                    <h3 className="font-medium text-sm">Layout</h3>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {LAYOUT_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        className={cn(
                          "text-left p-3 rounded-lg border transition-colors",
                          form.layout === opt.value
                            ? "border-primary bg-primary/5 ring-1 ring-primary"
                            : "hover:bg-muted/50",
                        )}
                        onClick={() => update("layout", opt.value)}
                      >
                        <p className="text-sm font-medium">{opt.label}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{opt.description}</p>
                      </button>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card className="shadow-sm">
                <CardContent className="p-4 space-y-4">
                  <div className="flex items-center gap-2">
                    <Type className="w-4 h-4" />
                    <h3 className="font-medium text-sm">Typography & header</h3>
                  </div>
                  <div className="space-y-2">
                    <Label>Font style</Label>
                    <Select value={form.fontFamily} onValueChange={(v) => update("fontFamily", v as BookingPageSettings["fontFamily"])}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {FONT_OPTIONS.map((f) => (
                          <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Header style</Label>
                    <Select value={form.headerStyle} onValueChange={(v) => update("headerStyle", v as BookingPageSettings["headerStyle"])}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {HEADER_OPTIONS.map((h) => (
                          <SelectItem key={h.value} value={h.value}>{h.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Corner radius</Label>
                    <Select value={form.borderRadius} onValueChange={(v) => update("borderRadius", v as BookingPageSettings["borderRadius"])}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {RADIUS_OPTIONS.map((r) => (
                          <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Button style</Label>
                    <Select value={form.buttonStyle} onValueChange={(v) => update("buttonStyle", v as BookingPageSettings["buttonStyle"])}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {BUTTON_OPTIONS.map((b) => (
                          <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>

              <Card className="shadow-sm">
                <CardContent className="p-4 space-y-6">
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
                    hint="Optional — uses your cover image if left empty"
                    kind="logo"
                    value={form.logoUrl}
                    fallbackPreviewUrl={form.coverImageUrl}
                    onChange={(url) => update("logoUrl", url)}
                    onUploaded={persistLogoImage}
                    onRemoved={removeLogoImage}
                    aspect="square"
                  />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="style" className="space-y-4 m-0">
              <Card className="shadow-sm">
                <CardContent className="p-4 space-y-4">
                  <div className="flex items-center gap-2">
                    <Palette className="w-4 h-4" />
                    <h3 className="font-medium text-sm">Theme colors</h3>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {COLOR_PRESETS.map((preset) => (
                      <button
                        key={preset.name}
                        type="button"
                        title={preset.name}
                        className={cn(
                          "h-10 rounded-md transition-transform hover:scale-105",
                          form.primaryColor === preset.primary && "ring-2 ring-offset-2 ring-primary",
                        )}
                        style={{ background: `linear-gradient(135deg, ${preset.primary}, ${preset.secondary})` }}
                        onClick={() =>
                          setForm((prev) =>
                            prev
                              ? { ...prev, primaryColor: preset.primary, secondaryColor: preset.secondary }
                              : prev,
                          )
                        }
                      />
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-3 pt-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Primary</Label>
                      <div className="flex gap-2">
                        <input
                          type="color"
                          value={form.primaryColor}
                          onChange={(e) => update("primaryColor", e.target.value)}
                          className="w-10 h-10 rounded cursor-pointer border-0 p-0"
                        />
                        <Input value={form.primaryColor} onChange={(e) => update("primaryColor", e.target.value)} />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Secondary</Label>
                      <div className="flex gap-2">
                        <input
                          type="color"
                          value={form.secondaryColor}
                          onChange={(e) => update("secondaryColor", e.target.value)}
                          className="w-10 h-10 rounded cursor-pointer border-0 p-0"
                        />
                        <Input value={form.secondaryColor} onChange={(e) => update("secondaryColor", e.target.value)} />
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="shadow-sm">
                <CardContent className="p-4 space-y-4">
                  <Label>Header background</Label>
                  <div className="grid grid-cols-3 gap-2">
                    {BACKGROUND_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        className={cn(
                          "py-2 px-3 rounded-lg border text-sm font-medium transition-colors",
                          form.backgroundStyle === opt.value
                            ? "border-primary bg-primary/5 text-primary"
                            : "hover:bg-muted/50",
                        )}
                        onClick={() => update("backgroundStyle", opt.value)}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  {form.backgroundStyle === "image" && !form.coverImageUrl && (
                    <p className="text-xs text-amber-600">Add a cover image URL in the Design tab.</p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        <div className="flex-1 bg-muted/50 rounded-xl border border-border/50 p-4 md:p-6 flex flex-col min-h-0">
          <div className="flex items-center justify-center gap-2 mb-4 shrink-0">
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

          <div className="flex-1 flex items-start justify-center min-h-0 overflow-y-auto">
            <BookingPagePreview
              settings={form}
              services={publicServices}
              staff={publicStaff}
              previewMode={previewMode}
              slug={form.slug}
              onSubmitBooking={async (payload) => {
                if (!form.isPublished) {
                  toast({
                    title: "Publish your page first",
                    description: "Turn on Publish page, save, then try booking from the public link.",
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

                toast({ title: "Booking created", description: "A pending booking was added to your calendar." });
                return res;
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="space-y-0.5 pr-4">
        <Label className="text-sm font-medium">{label}</Label>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
