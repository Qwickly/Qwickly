import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import {
  Copy,
  ExternalLink,
  Eye,
  Link as LinkIcon,
  Loader2,
  Pencil,
  Plus,
  PowerOff,
  Rocket,
  Trash2,
} from "lucide-react";
import { useTheme } from "next-themes";
import { formatDistanceToNow } from "date-fns";
import {
  bookingPageKeys,
  bookingPageUrl,
  createBookingPage,
  deleteBookingPage,
  duplicateBookingPage,
  fetchBookingPages,
  saveBookingPageSettings,
} from "@/lib/booking-page";
import { catalogKeys, fetchServices, fetchStaff } from "@/lib/catalog";
import { fetchOpenDays } from "@/lib/settings";
import type { BookingPageSettings } from "@/types/booking-page";
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
 * What you have and what is live, before you go and edit any of it.
 *
 * The builder used to be the whole feature, which meant the two questions you
 * actually arrive with — "is my page live?" and "where is my link?" — were
 * answered somewhere inside a wizard. They are answered here, and editing is a
 * deliberate step from this screen.
 *
 * "Active" and "published" are different things, and the card says both: several
 * pages can be published, each on its own URL, while the active one is the page
 * this business's own links point at.
 */
export default function BookingPageOverview() {
  const [, navigate] = useLocation();
  const queryString = useSearch();
  const queryClient = useQueryClient();
  const { resolvedTheme } = useTheme();
  const [confirmTakeDown, setConfirmTakeDown] = useState<BookingPageSettings | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<BookingPageSettings | null>(null);

  const { data: pages, isLoading } = useQuery({
    queryKey: bookingPageKeys.list,
    queryFn: fetchBookingPages,
  });

  const { data: services } = useQuery({ queryKey: catalogKeys.services, queryFn: fetchServices });
  const { data: staff } = useQuery({ queryKey: catalogKeys.staff, queryFn: fetchStaff });
  const { data: openDays } = useQuery({
    queryKey: ["booking-page", "open-days"],
    queryFn: fetchOpenDays,
  });

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: bookingPageKeys.list }),
      queryClient.invalidateQueries({ queryKey: bookingPageKeys.settings }),
    ]);

  const failed = (action: string) => (err: unknown) =>
    toast.error(`Could not ${action}`, {
      description: err instanceof Error ? err.message : "Please try again.",
    });

  const createMutation = useMutation({
    mutationFn: () => createBookingPage(),
    onSuccess: async (created) => {
      await refresh();
      toast("Page created", { description: "It starts as a draft, so nobody can book it yet." });
      navigate(`/booking-page/${created.id}/edit`);
    },
    onError: failed("create the page"),
  });

  const duplicateMutation = useMutation({
    mutationFn: (id: string) => duplicateBookingPage(id),
    onSuccess: async (copy) => {
      await refresh();
      toast("Page duplicated", { description: "The copy is a draft on its own link." });
      navigate(`/booking-page/${copy.id}/edit`);
    },
    onError: failed("duplicate the page"),
  });

  const publishMutation = useMutation({
    mutationFn: ({ page, isPublished }: { page: BookingPageSettings; isPublished: boolean }) =>
      saveBookingPageSettings({ ...page, isPublished }),
    onSuccess: async (next) => {
      await refresh();
      toast(next.isPublished ? "Page is live" : "Page taken down", {
        description: next.isPublished
          ? "Clients can book from its link now."
          : "That link will show a not-found page until you publish again.",
      });
    },
    onError: failed("change the page"),
  });

  const tourRequested = new URLSearchParams(queryString).get("tour") === "booking-page";
  const tourTarget = tourRequested ? pages?.find((page) => page.isPublished) ?? pages?.[0] : undefined;
  useEffect(() => {
    if (!tourTarget) return;
    navigate(`/booking-page/${tourTarget.id}/edit?tour=booking-page`, { replace: true });
  }, [tourTarget, navigate]);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteBookingPage(id),
    onSuccess: async () => {
      await refresh();
      toast("Page deleted");
    },
    onError: failed("delete the page"),
  });

  if (isLoading || !pages) {
    return <FormPageSkeleton />;
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

  const copyLink = async (page: BookingPageSettings) => {
    const url = bookingPageUrl(page.slug);
    try {
      await navigator.clipboard.writeText(url);
      toast("Link copied", { description: url });
    } catch {
      toast.error("Could not copy the link", { description: "Copy it from the field instead." });
    }
  };

  const livePage = pages.find((page) => page.isPublished) ?? null;

  const openLive = (page: BookingPageSettings) => {
    if (!page.isPublished) return;
    window.open(bookingPageUrl(page.slug), "_blank", "noopener,noreferrer");
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Booking Pages"
        description="One page can be online at a time. The rest are drafts you can work on."
        primaryAction={
          <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
            {createMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin sm:mr-2" />
            ) : (
              <Plus className="h-4 w-4 sm:mr-2" />
            )}
            <span className="sr-only sm:hidden">New page</span>
            <span className="hidden sm:inline">New page</span>
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {pages.map((page) => {
          const url = bookingPageUrl(page.slug);

          return (
            <Card key={page.id} className="gap-0 overflow-hidden py-0">
              {/*
                A real render rather than a screenshot: the same component the
                customer loads, drawn at desktop width and scaled to fit.
              */}
              <PageThumbnail>
                <BookingPageView
                  settings={page}
                  services={publicServices}
                  staff={publicStaff}
                  openDays={openDays}
                  darkOverride={resolvedTheme === "dark"}
                  slug={page.slug}
                />
              </PageThumbnail>

              <CardContent className="space-y-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <h2 className="truncate text-base font-semibold text-foreground">
                      {page.pageTitle || "Booking page"}
                    </h2>
                    <p className="truncate text-xs text-muted-foreground">
                      /{page.slug}
                      {page.updatedAt
                        ? ` · edited ${formatDistanceToNow(new Date(page.updatedAt), { addSuffix: true })}`
                        : ""}
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className={cn(
                      "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold",
                      page.isPublished
                        ? "border-primary/20 bg-primary/10 text-primary"
                        : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-400",
                    )}
                  >
                    {page.isPublished ? "Live" : "Draft"}
                  </Badge>
                </div>

                <div className="space-y-2">
                  <div className="flex gap-2">
                    <Input readOnly value={url} className="bg-muted/50 text-xs" />
                    <Button
                      variant="outline"
                      size="icon"
                      className="shrink-0"
                      onClick={() => void copyLink(page)}
                    >
                      <LinkIcon className="h-4 w-4" />
                      <span className="sr-only">Copy booking link</span>
                    </Button>
                  </div>
                  <p className="text-xs leading-5 text-muted-foreground">
                    {page.isPublished
                      ? "Clients can book from this link right now."
                      : "This link will not work until the page is published. Preview still shows it to you."}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button className="flex-1" onClick={() => navigate(`/booking-page/${page.id}/edit`)}>
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
                    onClick={() => navigate(`/booking-page/${page.id}/preview`)}
                  >
                    <Eye className="mr-2 h-4 w-4" />
                    Preview
                  </Button>
                  <PageOverflowMenu label={`Actions for ${page.pageTitle || "this page"}`}>
                    <DropdownMenuItem onClick={() => void copyLink(page)}>
                      <LinkIcon className="mr-2 h-4 w-4" />
                      Copy booking link
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => openLive(page)} disabled={!page.isPublished}>
                      <ExternalLink className="mr-2 h-4 w-4" />
                      Open live page
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => duplicateMutation.mutate(page.id)}
                      disabled={duplicateMutation.isPending}
                    >
                      <Copy className="mr-2 h-4 w-4" />
                      Duplicate
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {page.isPublished ? (
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() => setConfirmTakeDown(page)}
                      >
                        <PowerOff className="mr-2 h-4 w-4" />
                        Take page down
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem
                        onClick={() => {
                          // Refused rather than swapped: taking the current page
                          // down is a decision about clients who are mid-booking,
                          // not a side effect of publishing a different one.
                          if (livePage) {
                            toast.error("Another page is already live", {
                              description: `Take "${livePage.pageTitle || livePage.slug}" down first — only one page can be online at a time.`,
                            });
                            return;
                          }
                          publishMutation.mutate({ page, isPublished: true });
                        }}
                      >
                        <Rocket className="mr-2 h-4 w-4" />
                        Publish page
                      </DropdownMenuItem>
                    )}
                    {/* A live page has to come down before it can be removed. */}
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      disabled={page.isPublished || pages.length === 1}
                      onClick={() => setConfirmDelete(page)}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete page
                    </DropdownMenuItem>
                  </PageOverflowMenu>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={!!confirmTakeDown} onOpenChange={(open) => !open && setConfirmTakeDown(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Take this page down?</DialogTitle>
            <DialogDescription>
              Its booking link will stop working straight away and clients will see a not-found
              page. Existing bookings are not affected, and you can publish again at any time.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmTakeDown(null)}>
              Keep it live
            </Button>
            <Button
              variant="destructive"
              disabled={publishMutation.isPending}
              onClick={() => {
                const page = confirmTakeDown;
                setConfirmTakeDown(null);
                if (page) publishMutation.mutate({ page, isPublished: false });
              }}
            >
              {publishMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Take it down
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirmDelete} onOpenChange={(open) => !open && setConfirmDelete(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete {confirmDelete?.pageTitle || "this page"}?</DialogTitle>
            <DialogDescription>
              This cannot be undone. The page and its link are removed; bookings already made
              through it are not affected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => {
                const page = confirmDelete;
                setConfirmDelete(null);
                if (page) deleteMutation.mutate(page.id);
              }}
            >
              {deleteMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Delete page
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
