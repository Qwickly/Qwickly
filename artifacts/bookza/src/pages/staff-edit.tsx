import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { catalogKeys, fetchStaffProfile, updateStaff } from "@/lib/catalog";
import {
  StaffFormFields,
  buildStaffPayload,
  emptyStaffForm,
  staffFormFromMember,
  validateStaffForm,
  type StaffFormValue,
} from "@/components/staff/staff-form";
import { PageEmptyState, PageHeader } from "@/components/layout/page-ui";
import { usePageChrome } from "@/components/layout/page-chrome";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";

export default function StaffEditPage({ id }: { id: string }) {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<StaffFormValue>(emptyStaffForm);

  const { data: profile, isLoading, isError } = useQuery({
    queryKey: catalogKeys.staffMember(id),
    queryFn: () => fetchStaffProfile(id),
    enabled: Boolean(id),
  });

  const staffMember = profile?.staffMember;

  const pageChrome = useMemo(
    () => ({
      breadcrumbs: [
        { label: "Staff", href: "/staff" },
        { label: staffMember?.name ?? "Staff member", href: `/staff/${id}` },
        { label: "Edit" },
      ],
    }),
    [staffMember?.name, id],
  );
  usePageChrome(pageChrome);

  useEffect(() => {
    if (!staffMember) return;
    setForm(staffFormFromMember(staffMember));
  }, [staffMember]);

  const saveMutation = useMutation({
    mutationFn: () => updateStaff(id, buildStaffPayload(form)),
    onSuccess: async (updated) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: catalogKeys.staffMember(id) }),
        queryClient.invalidateQueries({ queryKey: catalogKeys.staff }),
      ]);
      toast("Staff member updated", { description: `${updated.name} has been saved.` });
      navigate(`/staff/${id}`);
    },
    onError: (err) => {
      const raw = err instanceof Error ? err.message : "";
      const isSeatLimit = raw.includes("staff_seat_limit_reached");
      toast.error(isSeatLimit ? "Seat limit reached" : "Could not update staff member", {
        description: isSeatLimit
          ? "Reactivating this staff member would go over your seat limit. Add an Additional Staff seat in Billing first."
          : raw || "Please try again.",
      });
    },
  });

  const handleSave = () => {
    const invalid = validateStaffForm(form);
    if (invalid) {
      toast.error("Check the form", { description: invalid });
      return;
    }
    saveMutation.mutate();
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Edit staff member" description="Loading staff member..." />
      </div>
    );
  }

  if (isError || !staffMember) {
    return (
      <div className="space-y-6">
        <PageEmptyState title="Staff member not found" description="They may have been removed." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Edit staff member"
        description={staffMember.name}
      />

      <Card>
        <CardContent className="grid gap-6">
          <StaffFormFields value={form} onChange={setForm} />

          <p className="text-xs text-muted-foreground">
            Working hours and days off are set on this staff member's Schedule section.
          </p>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => navigate(`/staff/${id}`)} disabled={saveMutation.isPending}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save changes
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
