import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Download, ExternalLink, Eye, Link as LinkIcon, Loader2, Pencil, PowerOff, Rocket } from "lucide-react";
import { useTheme } from "next-themes";
import {
  bookingPageKeys,
  bookingPageUrl,
  fetchBookingPageSettings,
  saveBookingPageSettings,
} from "@/lib/booking-page";
import { catalogKeys, fetchServices, fetchStaff } from "@/lib/catalog";
import { fetchOpenDays } from "@/lib/settings";
import { BookingPageView } from "@/components/booking/BookingPageView";
import { PageHeader, PageOverflowMenu } from "@/components/layout/page-ui";
import { FormPageSkeleton } from "@/components/skeletons/page-skeletons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const THUMBNAIL_WIDTH = 1100;

function PageThumbnail({ children }: { children: ReactNode }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    const observer = new ResizeObserver(([entry]) => {
      setScale(entry.contentRect.width / THUMBNAIL_WIDTH);
    });
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={frameRef} className="relative aspect-[16/10] overflow-hidden border-b bg-muted/40">
      <div
        aria-hidden
        className="pointer-events-none absolute left-0 top-0 origin-top-left select-none"
        style={{ width: THUMBNAIL_WIDTH, transform: `scale(${scale})`, opacity: scale ? 1 : 0 }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * What you have and what is live, before you go and edit it.
 *
 * The builder used to be the whole feature, which meant the two questions you
 * actually arrive with — "is my page live?" and "where is my link?" — were
 * answered somewhere inside a six-step wizard. They are answered here instead,
 * and editing is a deliberate step from this screen.
 *
 * It is a list of one. Duplicating pages and running several at once needs its
 * own data model; laying this out as a grid now means that lands as more cards
 * rather than as a redesign.
 */
export default function BookingPageOverview() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { resolvedTheme } = useTheme();
  const [confirmTakeDown, setConfirmTakeDown] = useState(false);

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

  // Above the early return, like every other hook — and guarded, because the
  // settings it spreads are not loaded yet at the point it is declared.
  const publishMutation = useMutation({
    mutationFn: (isPublished: boolean) => {
      if (!settings) throw new Error("Booking page settings have not loaded yet.");
      return saveBookingPageSettings({ ...settings, isPublished });
    },
    onSuccess: async (next) => {
      await queryClient.invalidateQueries({ queryKey: bookingPageKeys.settings });
      toast(next.isPublished ? "Booking page is live" : "Booking page taken down", {
        description: next.isPublished
          ? "Clients can book from your link now."
          : "The link will show a not-found page until you publish again.",
      });
    },
    onError: (err) => {
      toast.error("Could not change the page", {
        description: err instanceof Error ? err.message : "Please try again.",
      });
    },
  });

  if (isLoading || !settings) {
    return <FormPageSkeleton />;
  }

  const isPublished = settings.isPublished;
  const publicUrl = bookingPageUrl(settings.slug);

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

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl);
      toast("Link copied", { description: publicUrl });
    } catch {
      toast.error("Could not copy the link", { description: "Copy it from the field instead." });
    }
  };

  const openLive = () => {
    if (!isPublished) return;
    window.open(publicUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Booking Page"
        description="The page clients use to book with you."
        primaryAction={
          <Button onClick={() => navigate("/booking-page/edit")}>
            <Pencil className="h-4 w-4 sm:mr-2" />
            <span className="sr-only sm:hidden">Edit page</span>
            <span className="hidden sm:inline">Edit page</span>
          </Button>
        }
        overflowActions={
          <PageOverflowMenu label="Booking page actions">
            <DropdownMenuItem onClick={() => void copyLink()}>
              <LinkIcon className="mr-2 h-4 w-4" />
              Copy booking link
            </DropdownMenuItem>
            <DropdownMenuItem onClick={openLive} disabled={!isPublished}>
              <ExternalLink className="mr-2 h-4 w-4" />
              Open live page
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate("/booking-page/edit")}>
              <Download className="mr-2 h-4 w-4" />
              QR code and sharing
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {isPublished ? (
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => setConfirmTakeDown(true)}
              >
                <PowerOff className="mr-2 h-4 w-4" />
                Take page down
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={() => publishMutation.mutate(true)}>
                <Rocket className="mr-2 h-4 w-4" />
                Publish page
              </DropdownMenuItem>
            )}
          </PageOverflowMenu>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <Card className="gap-0 overflow-hidden py-0">
          {/*
            A real render rather than a screenshot: the same component the
            customer loads, drawn at desktop width and scaled to fit. Because it
            is a container query it lays itself out for 1100px and then shrinks,
            so the thumbnail shows the desktop page rather than a squeezed one.
          */}
          <PageThumbnail>
            <BookingPageView
              settings={settings}
              services={publicServices}
              staff={publicStaff}
              openDays={openDays}
              darkOverride={resolvedTheme === "dark"}
              slug={settings.slug}
            />
          </PageThumbnail>

          <CardContent className="space-y-4 py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <h2 className="truncate text-base font-semibold text-foreground">
                  {settings.pageTitle || "Booking page"}
                </h2>
                <p className="truncate text-xs text-muted-foreground">/{settings.slug}</p>
              </div>
              <Badge
                variant="outline"
                className={cn(
                  "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold",
                  isPublished
                    ? "border-primary/20 bg-primary/10 text-primary"
                    : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-400",
                )}
              >
                {isPublished ? "Live" : "Draft"}
              </Badge>
            </div>

            <div className="space-y-2">
              <div className="flex gap-2">
                <Input readOnly value={publicUrl} className="bg-muted/50 text-xs" />
                <Button variant="outline" size="icon" className="shrink-0" onClick={() => void copyLink()}>
                  <LinkIcon className="h-4 w-4" />
                  <span className="sr-only">Copy booking link</span>
                </Button>
              </div>
              <p className="text-xs leading-5 text-muted-foreground">
                {isPublished
                  ? "Clients can book from this link right now."
                  : "This link will not work until the page is published. Preview still shows it to you."}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button className="flex-1" onClick={() => navigate("/booking-page/edit")}>
                <Pencil className="mr-2 h-4 w-4" />
                Edit
              </Button>
              {/*
                Preview works whether or not the page is published — /book/:slug
                filters on is_published, so a draft has nowhere else to be seen.
              */}
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => window.open("/booking-page/preview", "_blank", "noopener,noreferrer")}
              >
                <Eye className="mr-2 h-4 w-4" />
                Preview
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={confirmTakeDown} onOpenChange={setConfirmTakeDown}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Take the booking page down?</DialogTitle>
            <DialogDescription>
              Your booking link will stop working straight away and clients will see a not-found
              page. Existing bookings are not affected, and you can publish again at any time.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmTakeDown(false)}>
              Keep it live
            </Button>
            <Button
              variant="destructive"
              disabled={publishMutation.isPending}
              onClick={() => {
                setConfirmTakeDown(false);
                publishMutation.mutate(false);
              }}
            >
              {publishMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Take it down
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
