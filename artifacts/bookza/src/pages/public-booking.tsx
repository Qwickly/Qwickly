import { useMutation, useQuery } from "@tanstack/react-query";
import {
  bookingPageKeys,
  createPublicBooking,
  fetchPublicBookingPage,
  fetchPublicBookingSlots,
  initiatePayFastDeposit,
  redirectToPayFast,
} from "@/lib/booking-page";
import { BookingPageView } from "@/components/booking/BookingPageView";
import { toast } from "sonner";
import { PublicBookingSkeleton } from "@/components/skeletons/page-skeletons";

export default function PublicBookingPage({ slug }: { slug: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: bookingPageKeys.public(slug),
    queryFn: () => fetchPublicBookingPage(slug),
    enabled: Boolean(slug),
  });

  const createBookingMutation = useMutation({
    mutationFn: createPublicBooking,
    onError: (err) => {
      console.error("[Public Booking] Error:", err);
      toast.error("Could not create booking", { description: err instanceof Error ? err.message : "Please try again" });
    },
  });

  if (isLoading) {
    return <PublicBookingSkeleton />;
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-zinc-50 px-6 text-center">
        <h1 className="text-2xl font-bold text-zinc-900">Page not found</h1>
        <p className="text-zinc-500 mt-2 max-w-md">
          This booking page doesn&apos;t exist or hasn&apos;t been published yet.
        </p>
      </div>
    );
  }

  // Past its grace week. The page still belongs to a real business with real
  // customers holding the link, so it introduces them and hands over a way to
  // get in touch rather than pretending it does not exist. Nothing here hints
  // at a billing problem — that is between us and the owner, and a customer who
  // reads "this business didn't pay" thinks less of the business, not of us.
  if (!data.accepting) {
    const { pageTitle, description, contactPhone, contactEmail, whatsappNumber } = data.settings;
    const whatsappHref = whatsappNumber.trim()
      ? `https://wa.me/${whatsappNumber.replace(/[^0-9]/g, "")}`
      : null;

    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-zinc-50 px-6 py-12 text-center">
        <h1 className="text-2xl font-bold text-zinc-900">{pageTitle || "Bookings"}</h1>
        {description ? (
          <p className="mt-2 max-w-md text-zinc-500">{description}</p>
        ) : null}

        <div className="mt-8 w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <p className="font-medium text-zinc-900">
            Online booking isn&apos;t available right now
          </p>
          <p className="mt-2 text-sm leading-relaxed text-zinc-500">
            {contactPhone || contactEmail || whatsappHref
              ? "Please get in touch directly and we'll book you in."
              : "Please check back soon."}
          </p>

          {contactPhone || contactEmail || whatsappHref ? (
            <div className="mt-5 flex flex-col gap-2 text-sm">
              {contactPhone ? (
                <a className="font-medium text-zinc-900 hover:underline" href={`tel:${contactPhone}`}>
                  {contactPhone}
                </a>
              ) : null}
              {whatsappHref ? (
                <a
                  className="font-medium text-zinc-900 hover:underline"
                  href={whatsappHref}
                  target="_blank"
                  rel="noreferrer"
                >
                  Message on WhatsApp
                </a>
              ) : null}
              {contactEmail ? (
                <a className="font-medium text-zinc-900 hover:underline" href={`mailto:${contactEmail}`}>
                  {contactEmail}
                </a>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <BookingPageView
      settings={data.settings}
      services={data.services}
      staff={data.staff}
      openDays={data.openDays}
      depositSettings={data.depositSettings}
      onInitiatePayment={async (bookingId) => {
        const intent = await initiatePayFastDeposit({ slug: data.settings.slug, bookingId });
        redirectToPayFast(intent);
      }}
      onSubmitBooking={(payload) =>
        createBookingMutation.mutateAsync({
          slug: data.settings.slug,
          serviceId: payload.serviceId,
          staffId: payload.staffId,
          clientName: payload.clientName,
          clientPhone: payload.clientPhone,
          clientEmail: payload.clientEmail,
          startTime: payload.startTime,
          notes: payload.notes,
        })
      }
      onFetchSlots={(input) =>
        fetchPublicBookingSlots({
          slug: data.settings.slug,
          serviceId: input.serviceId,
          staffId: input.staffId,
          date: input.date,
        })
      }
    />
  );
}
