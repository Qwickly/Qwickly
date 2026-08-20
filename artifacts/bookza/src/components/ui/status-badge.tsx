import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { BookingStatus, ClientStatus, ClientType, PaymentStatus, PaymentType } from "@/types/catalog";

/**
 * Single source of truth for status/type -> color mapping across the app.
 * Booking status, client type/status, payment status/type, and campaign status
 * were previously mapped to colors independently in ~10 different files, several
 * of which disagreed with each other for the same status value.
 */

const badgeBase = "rounded-full px-2.5 py-0.5 text-[11px] font-semibold capitalize shadow-none";

export function bookingStatusClass(status: BookingStatus): string {
  switch (status) {
    case "pending":
      return "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300";
    case "confirmed":
      return "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    case "completed":
      return "border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-300";
    case "cancelled":
      return "border-rose-500/20 bg-rose-500/10 text-rose-700 dark:text-rose-300";
    case "no_show":
      return "border-border bg-muted text-muted-foreground";
    default:
      return "border-border bg-muted text-muted-foreground";
  }
}

export function bookingStatusLabel(status: BookingStatus): string {
  return status.replace(/_/g, " ");
}

export function BookingStatusBadge({ status, className }: { status: BookingStatus; className?: string }) {
  return (
    <Badge variant="outline" className={cn(badgeBase, bookingStatusClass(status), className)}>
      {bookingStatusLabel(status)}
    </Badge>
  );
}

/**
 * Richer "surface" tone for whole cards/rows that represent a booking (card wash +
 * badge classes + accent text color), e.g. the dashboard's appointment overview list.
 */
export function bookingStatusSurface(status: BookingStatus): { card: string; badge: string; service: string } {
  switch (status) {
    case "pending":
      return {
        card: "bg-amber-50/90 hover:bg-amber-50 dark:bg-amber-950/20 dark:hover:bg-amber-950/30",
        badge: bookingStatusClass("pending"),
        service: "text-amber-700 dark:text-amber-400",
      };
    case "confirmed":
      return {
        card: "bg-primary/5 hover:bg-primary/10",
        badge: bookingStatusClass("confirmed"),
        service: "text-primary",
      };
    case "completed":
      return {
        card: "bg-sky-50/90 hover:bg-sky-50 dark:bg-sky-950/20 dark:hover:bg-sky-950/30",
        badge: bookingStatusClass("completed"),
        service: "text-sky-700 dark:text-sky-400",
      };
    case "cancelled":
      return {
        card: "bg-destructive/5 hover:bg-destructive/10",
        badge: bookingStatusClass("cancelled"),
        service: "text-destructive",
      };
    case "no_show":
    default:
      return {
        card: "bg-muted/55 hover:bg-muted/75",
        badge: bookingStatusClass(status),
        service: "text-foreground",
      };
  }
}

/** Client type/status, including the "no_show_risk" override computed from noShowCount. */
type ClientRiskInput = { clientType: ClientType; noShowCount: number };
export type EffectiveClientType = ClientType | "no_show_risk";

export function effectiveClientType(client: ClientRiskInput): EffectiveClientType {
  return client.noShowCount >= 2 ? "no_show_risk" : client.clientType ?? "new";
}

export function clientTypeClass(kind: EffectiveClientType | ClientStatus): string {
  switch (kind) {
    case "no_show_risk":
      return "border-destructive/20 bg-destructive/10 text-destructive";
    case "vip":
      return "border-primary/20 bg-primary/10 text-primary";
    case "returning":
    case "active":
      return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-400";
    case "new":
      return "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/50 dark:bg-sky-950/40 dark:text-sky-400";
    case "inactive":
    case "archived":
      return "border-border bg-muted text-muted-foreground";
    default:
      return "border-border bg-muted text-muted-foreground";
  }
}

export function clientTypeLabel(kind: EffectiveClientType | ClientStatus): string {
  if (kind === "vip") return "VIP";
  return kind.replace(/_/g, " ");
}

/** Renders the client-type badge, applying the no_show_risk override consistently. */
export function ClientTypeBadge({ client, className }: { client: ClientRiskInput; className?: string }) {
  const kind = effectiveClientType(client);
  return (
    <Badge variant="outline" className={cn(badgeBase, clientTypeClass(kind), className)}>
      {clientTypeLabel(kind)}
    </Badge>
  );
}

export function clientStatusClass(status: ClientStatus): string {
  return clientTypeClass(status);
}

export function ClientStatusBadge({ status, className }: { status: ClientStatus; className?: string }) {
  return (
    <Badge variant="outline" className={cn(badgeBase, clientStatusClass(status), className)}>
      {status}
    </Badge>
  );
}

export function paymentStatusClass(status: PaymentStatus): string {
  switch (status) {
    case "completed":
      return "border-primary/20 bg-primary/10 text-primary";
    case "pending":
      return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-400";
    case "refunded":
      return "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/50 dark:bg-sky-950/40 dark:text-sky-400";
    case "failed":
      return "border-destructive/20 bg-destructive/10 text-destructive";
    default:
      return "border-border bg-muted text-muted-foreground";
  }
}

export function PaymentStatusBadge({ status, className }: { status: PaymentStatus; className?: string }) {
  return (
    <Badge variant="outline" className={cn(badgeBase, paymentStatusClass(status), className)}>
      {status}
    </Badge>
  );
}

export function paymentTypeClass(type: PaymentType): string {
  switch (type) {
    case "deposit":
      return "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/50 dark:bg-sky-950/40 dark:text-sky-400";
    case "full_payment":
      return "border-primary/20 bg-primary/10 text-primary";
    case "refund":
      return "border-destructive/20 bg-destructive/10 text-destructive";
    default:
      return "border-border bg-muted text-muted-foreground";
  }
}

export function paymentTypeLabel(type: PaymentType): string {
  if (type === "full_payment") return "Full";
  if (type === "deposit") return "Deposit";
  return "Refund";
}

export function PaymentTypeBadge({ type, className }: { type: PaymentType; className?: string }) {
  return (
    <Badge variant="outline" className={cn(badgeBase, paymentTypeClass(type), className)}>
      {paymentTypeLabel(type)}
    </Badge>
  );
}

/**
 * Invoice status. Same four states as a payment, with "paid" where a payment
 * says "completed" — billing.tsx had its own inline copy of this mapping that
 * had already drifted from the one payments.tsx uses.
 */
export type InvoiceStatus = "paid" | "pending" | "refunded" | "failed" | string;

export function InvoiceStatusBadge({ status, className }: { status: InvoiceStatus; className?: string }) {
  const kind = status === "paid" ? "completed" : status;
  return (
    <Badge variant="outline" className={cn(badgeBase, paymentStatusClass(kind as PaymentStatus), className)}>
      {status}
    </Badge>
  );
}

export type CampaignStatus = "draft" | "active" | "completed";

export function campaignStatusClass(status: CampaignStatus): string {
  switch (status) {
    case "active":
      return "border-primary/20 bg-primary/10 text-primary";
    case "completed":
      return "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/50 dark:bg-sky-950/40 dark:text-sky-400";
    case "draft":
    default:
      return "border-border bg-muted text-muted-foreground";
  }
}

export function CampaignStatusBadge({ status, className }: { status: CampaignStatus; className?: string }) {
  return (
    <Badge variant="outline" className={cn(badgeBase, campaignStatusClass(status), className)}>
      {status}
    </Badge>
  );
}

/** WhatsApp/session connection status pill, shared between whatsapp.tsx and WhatsappConnectionManager.tsx. */
export type ConnectionStatusKind = "connected" | "qrcode" | "disconnected" | string;

export function connectionStatusClass(status: ConnectionStatusKind): string {
  switch (status) {
    case "connected":
      return "border-primary/20 bg-primary/10 text-primary";
    case "qrcode":
      return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-400";
    default:
      return "border-border bg-muted text-muted-foreground";
  }
}
