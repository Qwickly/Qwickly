import { useMutation, useQuery } from "@tanstack/react-query";
import {
  bookingPageKeys,
  createPublicBooking,
  fetchPublicBookingPage,
  fetchPublicBookingSlots,
} from "@/lib/booking-page";
import { BookingPagePreview } from "@/components/booking/BookingPagePreview";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function PublicBookingPage({ slug }: { slug: string }) {
  const { toast } = useToast();
  const { data, isLoading, error } = useQuery({
    queryKey: bookingPageKeys.public(slug),
    queryFn: () => fetchPublicBookingPage(slug),
    enabled: Boolean(slug),
  });

  const createBookingMutation = useMutation({
    mutationFn: createPublicBooking,
    onError: (err) => {
      toast({
        title: "Could not create booking",
        description: err instanceof Error ? err.message : "Please try again",
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
      </div>
    );
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

  return (
    <BookingPagePreview
      settings={data.settings}
      services={data.services}
      staff={data.staff}
      openDays={data.openDays}
      showChrome={false}
      onSubmitBooking={(payload) =>
        createBookingMutation.mutateAsync({
          slug: data.settings.slug,
          serviceId: payload.serviceId,
          staffId: payload.staffId,
          clientName: payload.clientName,
          clientPhone: payload.clientPhone,
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
