import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { checkPublicPaymentStatus } from "@/lib/booking-page";

/**
 * Where a customer lands after PayFast (return_url/cancel_url from
 * public-payments.ts#payfast-intent). Deliberately does NOT call any
 * complete/cancel endpoint itself — those are the dashboard's authenticated
 * sandbox-tester routes, owner-only. This page only reads the query param for
 * an immediate message, then polls the booking's real status, since the ITN
 * webhook (the only source of truth) can land after the browser redirects
 * back here.
 */

const POLL_INTERVAL_MS = 3000;
const MAX_POLLS = 20; // ~1 minute

function useQueryParams(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}

export default function PublicBookingPaymentReturnPage({ slug }: { slug: string }) {
  const params = useQueryParams();
  const outcome = params.get("payfast"); // "success" | "cancelled"
  const bookingId = params.get("booking_id");
  const [depositPaid, setDepositPaid] = useState(false);
  const [polling, setPolling] = useState(outcome === "success" && Boolean(bookingId));

  useEffect(() => {
    if (outcome !== "success" || !bookingId) return;
    let cancelled = false;
    let attempts = 0;

    async function poll() {
      attempts += 1;
      try {
        const result = await checkPublicPaymentStatus({ slug, bookingId: bookingId! });
        if (cancelled) return;
        if (result.depositPaid) {
          setDepositPaid(true);
          setPolling(false);
          return;
        }
      } catch {
        // keep polling — a transient network hiccup shouldn't stop the wait
      }
      if (!cancelled && attempts < MAX_POLLS) {
        setTimeout(poll, POLL_INTERVAL_MS);
      } else if (!cancelled) {
        setPolling(false);
      }
    }

    void poll();
    return () => {
      cancelled = true;
    };
  }, [outcome, bookingId, slug]);

  const cancelled = outcome === "cancelled";

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-zinc-50 px-6 text-center">
      <div className="max-w-md space-y-4">
        {cancelled ? (
          <>
            <XCircle className="mx-auto h-12 w-12 text-red-500" />
            <h1 className="text-2xl font-bold text-zinc-900">Payment cancelled</h1>
            <p className="text-zinc-500">
              Your deposit payment was cancelled. Your booking slot is still held for a little longer — go back
              to the booking page to try again.
            </p>
          </>
        ) : polling ? (
          <>
            <Loader2 className="mx-auto h-12 w-12 animate-spin text-zinc-400" />
            <h1 className="text-2xl font-bold text-zinc-900">Confirming your payment…</h1>
            <p className="text-zinc-500">This usually takes a few seconds. Please don&apos;t close this page.</p>
          </>
        ) : depositPaid ? (
          <>
            <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
            <h1 className="text-2xl font-bold text-zinc-900">Deposit received</h1>
            <p className="text-zinc-500">
              Your booking is confirmed as paid. The business will be in touch to finalize your appointment.
            </p>
          </>
        ) : (
          <>
            <Loader2 className="mx-auto h-12 w-12 text-zinc-400" />
            <h1 className="text-2xl font-bold text-zinc-900">Still waiting on confirmation</h1>
            <p className="text-zinc-500">
              We haven&apos;t received payment confirmation yet. If you completed payment, it can take a minute to
              reflect — otherwise, please contact the business directly.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
