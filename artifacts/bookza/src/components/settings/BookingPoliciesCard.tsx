import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { CalendarX, Loader2, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  DEFAULT_BOOKING_POLICY,
  fetchBookingPolicy,
  saveBookingPolicy,
  type BookingPolicy,
} from "@/lib/booking-policies";

/**
 * Core cancellation & reschedule rules (migration 046). Applies everywhere a
 * customer changes a booking — the booking page's "manage" links AND the WhatsApp
 * bot. Moved here from Bot Setup because it's a base booking feature, not a bot one.
 */
export function BookingPoliciesCard() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery({
    queryKey: ["booking-policy"],
    queryFn: fetchBookingPolicy,
  });

  const [form, setForm] = useState<BookingPolicy>(DEFAULT_BOOKING_POLICY);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  function set<K extends keyof BookingPolicy>(key: K, value: BookingPolicy[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      await saveBookingPolicy(form);
      toast({ title: "Booking rules saved", description: "Cancellation & reschedule rules updated." });
    } catch (err) {
      toast({
        title: "Could not save",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="border-0 bg-transparent shadow-none md:border-border/60 md:bg-card md:shadow-sm">
      <CardHeader className="flex flex-row items-start gap-3 p-0 pb-4 md:p-5">
        <div className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/15 bg-primary/10 text-primary md:flex">
          <CalendarX className="h-4 w-4" />
        </div>
        <div className="flex-1">
          <CardTitle className="text-lg">Cancellation &amp; reschedule rules</CardTitle>
          <CardDescription className="text-sm">
            How long before an appointment a client can cancel or reschedule online. Applies to the
            booking page and the WhatsApp assistant.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-0 md:p-5 md:pt-0">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <>
            <PolicyBlock
              enabledLabel="Allow clients to cancel online"
              description="Let clients cancel their booking themselves from the booking page and the assistant."
              enabled={form.acceptCancellations}
              onToggle={(v) => set("acceptCancellations", v)}
              noticeHours={form.cancellationMinNoticeHours}
              onNotice={(v) => set("cancellationMinNoticeHours", v)}
              declineMessage={form.cancellationDeclineMessage}
              onDecline={(v) => set("cancellationDeclineMessage", v)}
              action="cancel"
            />

            <PolicyBlock
              enabledLabel="Allow clients to reschedule online"
              description="Let clients move their booking to a new time themselves, without contacting you."
              enabled={form.acceptReschedules}
              onToggle={(v) => set("acceptReschedules", v)}
              noticeHours={form.rescheduleMinNoticeHours}
              onNotice={(v) => set("rescheduleMinNoticeHours", v)}
              declineMessage={form.rescheduleDeclineMessage}
              onDecline={(v) => set("rescheduleDeclineMessage", v)}
              action="reschedule"
            />

            <Button
              onClick={handleSave}
              disabled={saving}
              className="h-11 rounded-full bg-primary px-5 text-white shadow-lg shadow-primary/20 duration-200 ease-out hover:bg-primary/90"
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
          </>
        )}
      </CardContent>
    </Card>
  );
}

function PolicyBlock(props: {
  enabledLabel: string;
  description: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  noticeHours: number;
  onNotice: (v: number) => void;
  declineMessage: string;
  onDecline: (v: string) => void;
  action: "cancel" | "reschedule";
}) {
  return (
    <div className="space-y-3 rounded-lg border border-border/60 p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 space-y-0.5">
          <Label className="text-sm font-semibold">{props.enabledLabel}</Label>
          <p className="text-sm leading-relaxed text-muted-foreground">{props.description}</p>
        </div>
        <Switch checked={props.enabled} onCheckedChange={props.onToggle} className="shrink-0" />
      </div>

      {props.enabled && (
        <>
          <div className="space-y-1.5">
            <Label className="text-sm">Minimum notice (hours)</Label>
            <Input
              type="number"
              min={0}
              value={props.noticeHours}
              onChange={(e) => props.onNotice(Number(e.target.value))}
              className="max-w-[140px]"
            />
            <p className="text-xs text-muted-foreground">
              0 = clients can {props.action} any time before the appointment.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm">Decline message (optional)</Label>
            <Textarea
              rows={2}
              value={props.declineMessage}
              onChange={(e) => props.onDecline(e.target.value)}
              placeholder={`Shown by the assistant when a ${props.action} is refused (e.g. too close to the appointment).`}
            />
          </div>
        </>
      )}
    </div>
  );
}
