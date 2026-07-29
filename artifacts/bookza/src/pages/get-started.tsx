import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  CalendarDays,
  CreditCard,
  Globe,
  Lock,
  Mail,
  MessageSquareText,
  MonitorSmartphone,
  RotateCcw,
  Scissors,
  ShieldCheck,
  Users,
} from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/layout/page-ui";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  dismissGettingStartedStep,
  fetchGettingStartedStatus,
  type GettingStartedStepId,
} from "@/lib/getting-started";
import { fetchBusinessBasics, saveBusinessBasics, type BusinessBasics } from "@/lib/settings";
import { INDUSTRIES } from "@/types/settings";

const STEP_ICONS: Record<GettingStartedStepId, typeof ShieldCheck> = {
  trial: ShieldCheck,
  business_details: Globe,
  first_service: Scissors,
  first_staff: Users,
  staff_topup: Users,
  whatsapp_bot: MessageSquareText,
  custom_email: Mail,
  booking_page: MonitorSmartphone,
  calendar: CalendarDays,
};

function ProgressDots({ completed, total }: { completed: number; total: number }) {
  return (
    <div className="flex gap-1.5">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={
            i < completed
              ? "h-1.5 flex-1 rounded-full bg-primary"
              : "h-1.5 flex-1 rounded-full bg-muted"
          }
        />
      ))}
    </div>
  );
}

function BusinessDetailsForm({ onSaved }: { onSaved: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState<BusinessBasics | null>(null);
  const [saving, setSaving] = useState(false);

  const { data: businessId } = useQuery({
    queryKey: ["getting-started", "business-id"],
    queryFn: async () => (await fetchGettingStartedStatus()).businessId,
  });

  useEffect(() => {
    if (!businessId) return;
    fetchBusinessBasics(businessId).then(setForm).catch(() => {
      toast({ title: "Couldn't load business details", variant: "destructive" });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId]);

  if (!form) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  const handleSave = async () => {
    if (!businessId) return;
    if (!form.business_name.trim() || !form.industry || !form.phone.trim()) {
      toast({ title: "Business name, industry, and phone are required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await saveBusinessBasics(businessId, form);
      toast({ title: "Business details saved" });
      onSaved();
    } catch (err) {
      toast({
        title: "Couldn't save business details",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label className="text-sm font-semibold">What's your business called?</Label>
        <Input
          value={form.business_name}
          onChange={(e) => setForm({ ...form, business_name: e.target.value })}
          placeholder="Glow Beauty Studio"
          className="h-12 text-base"
        />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <Label className="text-sm font-semibold">What kind of business is it?</Label>
          <Select value={form.industry} onValueChange={(v) => setForm({ ...form, industry: v })}>
            <SelectTrigger className="h-12 text-base">
              <SelectValue placeholder="Choose an industry" />
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

        <div className="space-y-2">
          <Label className="text-sm font-semibold">Best phone number for clients</Label>
          <Input
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            placeholder="082 123 4567"
            className="h-12 text-base"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-sm font-semibold">Tell clients a bit about your business</Label>
        <Textarea
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          placeholder="A short, friendly line clients see on your booking page."
          className="min-h-24 text-base"
        />
      </div>

      <Button className="h-11 w-full sm:w-auto" onClick={handleSave} disabled={saving}>
        {saving ? "Saving…" : "Save details"}
      </Button>
    </div>
  );
}

export default function GetStartedPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: status, isLoading } = useQuery({
    queryKey: ["getting-started"],
    queryFn: fetchGettingStartedStatus,
  });

  const dismissMutation = useMutation({
    mutationFn: (stepId: GettingStartedStepId) => {
      if (!status) throw new Error("Not ready");
      return dismissGettingStartedStep(status.businessId, stepId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["getting-started"] });
    },
    onError: (err) => {
      toast({
        title: "Couldn't update checklist",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  if (isLoading || !status) {
    return (
      <div className="space-y-6">
        <PageHeader title="Getting started" description="Loading your checklist…" />
      </div>
    );
  }

  const trialActive = Boolean(status.steps.find((step) => step.id === "trial")?.complete);
  const defaultOpenStep = trialActive ? status.steps.find((s) => !s.complete)?.id : "trial";

  return (
    <div className="mx-auto max-w-2xl space-y-6 pb-12">
      <PageHeader
        title="Getting started"
        description={
          trialActive
            ? "A few quick steps to get Qwickly working the way your business needs."
            : "Start your free trial first, then we’ll unlock the setup steps in order."
        }
      />

      <ProgressDots completed={status.completedCount} total={status.total} />

      <Accordion type="single" collapsible defaultValue={defaultOpenStep}>
        {status.steps.map((step) => {
          const Icon = STEP_ICONS[step.id];
          const locked = !trialActive && step.id !== "trial";
          return (
            <AccordionItem
              key={step.id}
              value={step.id}
              disabled={locked}
              className={cn(
                "border-border/60",
                locked && "pointer-events-none opacity-45",
              )}
            >
              <AccordionTrigger
                className={cn(
                  "hover:no-underline",
                  locked && "cursor-not-allowed hover:no-underline",
                )}
              >
                <div className="flex min-w-0 flex-1 items-center gap-3 pr-2">
                  {step.complete ? (
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" />
                  ) : locked ? (
                    <Lock className="h-5 w-5 shrink-0 text-muted-foreground/50" />
                  ) : (
                    <Icon className="h-5 w-5 shrink-0 text-muted-foreground" />
                  )}
                  <span className="min-w-0 truncate text-base font-semibold text-foreground">
                    {step.title}
                  </span>
                  {locked ? (
                    <Badge variant="secondary" className="hidden shrink-0 text-[10px] sm:inline-flex">
                      Locked
                    </Badge>
                  ) : step.optional && !step.complete ? (
                    <Badge variant="secondary" className="shrink-0 text-[10px]">
                      Optional
                    </Badge>
                  ) : null}
                </div>
              </AccordionTrigger>
              <AccordionContent className="space-y-4 pl-8">
                <p className="text-sm leading-relaxed text-muted-foreground">{step.description}</p>

                {step.id === "trial" && (
                  <Button variant={step.complete ? "outline" : "default"} asChild>
                    <Link href="/billing">
                      {step.complete ? "View your plan" : "Start free trial"}
                    </Link>
                  </Button>
                )}

                {step.id === "business_details" && !step.complete && (
                  <BusinessDetailsForm
                    onSaved={() => queryClient.invalidateQueries({ queryKey: ["getting-started"] })}
                  />
                )}

                {step.id === "business_details" && (
                  <Button variant={step.complete ? "outline" : "ghost"} asChild>
                    <Link href="/settings?tab=profile&tour=settings-tour">
                      {step.complete ? (
                        <RotateCcw className="mr-2 h-4 w-4" />
                      ) : (
                        <Globe className="mr-2 h-4 w-4" />
                      )}
                      {step.complete ? "Replay tour" : "Take a tour of Settings"}
                    </Link>
                  </Button>
                )}

                {step.id === "first_service" && (
                  <Button variant={step.complete ? "outline" : "default"} asChild>
                    <Link href="/services?tour=add-service">
                      {step.complete ? (
                        <RotateCcw className="mr-2 h-4 w-4" />
                      ) : (
                        <Scissors className="mr-2 h-4 w-4" />
                      )}
                      {step.complete ? "Replay tour" : "Add a service"}
                    </Link>
                  </Button>
                )}

                {step.id === "first_staff" && (
                  <Button variant={step.complete ? "outline" : "default"} asChild>
                    <Link href="/staff?tour=add-staff">
                      {step.complete ? (
                        <RotateCcw className="mr-2 h-4 w-4" />
                      ) : (
                        <Users className="mr-2 h-4 w-4" />
                      )}
                      {step.complete ? "Replay tour" : "Add a staff member"}
                    </Link>
                  </Button>
                )}

                {step.id === "staff_topup" && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant={step.complete ? "outline" : "default"} asChild>
                      <Link href="/billing?tour=billing">
                        {step.complete ? (
                          <RotateCcw className="mr-2 h-4 w-4" />
                        ) : (
                          <CreditCard className="mr-2 h-4 w-4" />
                        )}
                        {step.complete ? "Replay tour" : "Manage seats"}
                      </Link>
                    </Button>
                    {!step.complete && (
                      <Button
                        variant="ghost"
                        onClick={() => dismissMutation.mutate("staff_topup")}
                        disabled={dismissMutation.isPending}
                      >
                        Not right now
                      </Button>
                    )}
                  </div>
                )}

                {step.id === "whatsapp_bot" && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant={step.complete ? "outline" : "default"} asChild>
                      <Link href="/whatsapp/bot?tour=whatsapp-bot">
                        {step.complete ? (
                          <RotateCcw className="mr-2 h-4 w-4" />
                        ) : (
                          <MessageSquareText className="mr-2 h-4 w-4" />
                        )}
                        {step.complete ? "Replay tour" : "Set up WhatsApp"}
                      </Link>
                    </Button>
                    {!step.complete && (
                      <Button
                        variant="ghost"
                        onClick={() => dismissMutation.mutate("whatsapp_bot")}
                        disabled={dismissMutation.isPending}
                      >
                        I'll do this later
                      </Button>
                    )}
                  </div>
                )}

                {step.id === "custom_email" && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant={step.complete ? "outline" : "default"} asChild>
                      <Link href="/settings?tab=profile&tour=custom-email">
                        {step.complete ? (
                          <RotateCcw className="mr-2 h-4 w-4" />
                        ) : (
                          <Mail className="mr-2 h-4 w-4" />
                        )}
                        {step.complete ? "Replay tour" : "Set up email"}
                      </Link>
                    </Button>
                    {!step.complete && (
                      <Button
                        variant="ghost"
                        onClick={() => dismissMutation.mutate("custom_email")}
                        disabled={dismissMutation.isPending}
                      >
                        I'll do this later
                      </Button>
                    )}
                  </div>
                )}

                {step.id === "booking_page" && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant={step.complete ? "outline" : "default"} asChild>
                      <Link href="/booking-page?tour=booking-page">
                        {step.complete ? (
                          <RotateCcw className="mr-2 h-4 w-4" />
                        ) : (
                          <MonitorSmartphone className="mr-2 h-4 w-4" />
                        )}
                        {step.complete ? "Replay tour" : "Customize booking page"}
                      </Link>
                    </Button>
                    {!step.complete && (
                      <Button
                        variant="ghost"
                        onClick={() => dismissMutation.mutate("booking_page")}
                        disabled={dismissMutation.isPending}
                      >
                        I'll do this later
                      </Button>
                    )}
                  </div>
                )}

                {step.id === "calendar" && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant={step.complete ? "outline" : "default"} asChild>
                      <Link href="/calendar?tour=calendar">
                        {step.complete ? (
                          <RotateCcw className="mr-2 h-4 w-4" />
                        ) : (
                          <CalendarDays className="mr-2 h-4 w-4" />
                        )}
                        {step.complete ? "Replay tour" : "Tour the calendar"}
                      </Link>
                    </Button>
                    {!step.complete && (
                      <Button
                        variant="ghost"
                        onClick={() => dismissMutation.mutate("calendar")}
                        disabled={dismissMutation.isPending}
                      >
                        I'll do this later
                      </Button>
                    )}
                  </div>
                )}
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>
    </div>
  );
}
