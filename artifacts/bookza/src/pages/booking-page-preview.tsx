import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { ArrowLeft, Eye } from "lucide-react";
import { useTheme } from "next-themes";
import {
  bookingPageKeys,
  fetchBookingPageSettings,
  fetchPublicBookingSlots,
} from "@/lib/booking-page";
import { catalogKeys, fetchServices, fetchStaff } from "@/lib/catalog";
import { fetchOpenDays } from "@/lib/settings";
import { BookingPageView } from "@/components/booking/BookingPageView";
import { PublicBookingSkeleton } from "@/components/skeletons/page-skeletons";
import { Button } from "@/components/ui/button";

/**
 * The owner's view of their own page, at full size, published or not.
 *
 * `/book/:slug` filters on `is_published`, so a draft has nowhere to be looked
 * at — the only way to see it was the frame inside the builder. This renders the
 * same component the same way a customer would get it, from the owner's own
 * authenticated settings, so a draft can be checked before it goes live.
 *
 * It sits outside the app shell on purpose: a preview with the sidebar and app
 * header around it is not a preview of anything.
 */
export default function BookingPagePreviewPage() {
  const [, navigate] = useLocation();
  const { resolvedTheme } = useTheme();

  const { data: settings, isLoading } = useQuery({
    queryKey: bookingPageKeys.settings,
    queryFn: fetchBookingPageSettings,
  });
  const { data: services } = useQuery({ queryKey: catalogKeys.services, queryFn: fetchServices });
  const { data: staff } = useQuery({ queryKey: catalogKeys.staff, queryFn: fetchStaff });
  const { data: openDays } = useQuery({
    queryKey: ["booking-page", "open-days"],
    queryFn: fetchOpenDays,
  });

  if (isLoading || !settings) {
    return <PublicBookingSkeleton />;
  }

  const publicServices = (services ?? [])
    .filter((service) => service.isActive)
    .map((service) => ({
      id: service.id,
      name: service.name,
      description: service.description,
      price: service.price,
      duration: service.duration,
      depositRequired: service.depositRequired,
      depositAmount: service.depositAmount,
    }));

  const publicStaff = (staff ?? [])
    .filter((member) => member.isActive)
    .map((member) => ({ id: member.id, name: member.name, position: member.position }));

  return (
    <div className="min-h-screen">
      {/*
        A thin bar rather than a floating badge: it has to say this is not the
        live page without covering any of it, and it has to offer the way back.
      */}
      <div className="sticky top-0 z-50 flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 bg-zinc-900 px-4 py-2 text-zinc-100">
        <div className="flex min-w-0 items-center gap-2">
          <Eye className="h-4 w-4 shrink-0 text-zinc-400" />
          <p className="truncate text-sm">
            Preview
            <span className="ml-2 text-zinc-400">
              {settings.isPublished
                ? "This matches what clients see."
                : "Not published — clients cannot reach this page yet."}
            </span>
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="shrink-0 border-zinc-700 bg-transparent text-zinc-100 hover:bg-zinc-800 hover:text-zinc-50"
          onClick={() => navigate("/booking-page")}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to editor
        </Button>
      </div>

      <BookingPageView
        settings={settings}
        services={publicServices}
        staff={publicStaff}
        openDays={openDays}
        darkOverride={resolvedTheme === "dark"}
        slug={settings.slug}
        onFetchSlots={(input) =>
          fetchPublicBookingSlots({
            slug: settings.slug,
            serviceId: input.serviceId,
            staffId: input.staffId,
            date: input.date,
          })
        }
      />
    </div>
  );
}
