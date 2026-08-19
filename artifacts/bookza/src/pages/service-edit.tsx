import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { catalogKeys, fetchServiceProfile, updateService } from "@/lib/catalog";
import {
  ServiceFormFields,
  buildServicePayload,
  emptyServiceForm,
  formFromService,
  validateServiceForm,
} from "@/components/services/service-form";
import { PageEmptyState, PageHeader } from "@/components/layout/page-ui";
import { usePageChrome } from "@/components/layout/page-chrome";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";

export default function ServiceEditPage({ id }: { id: string }) {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(emptyServiceForm);

  const { data: profile, isLoading, isError } = useQuery({
    queryKey: catalogKeys.service(id),
    queryFn: () => fetchServiceProfile(id),
    enabled: Boolean(id),
  });

  const service = profile?.service;

  const pageChrome = useMemo(
    () => ({
      breadcrumbs: [
        { label: "Services", href: "/services" },
        { label: service?.name ?? "Service", href: `/services/${id}` },
        { label: "Edit" },
      ],
    }),
    [service?.name, id],
  );
  usePageChrome(pageChrome);

  useEffect(() => {
    if (!service) return;
    setForm(formFromService(service));
  }, [service]);

  const saveMutation = useMutation({
    mutationFn: () => updateService(id, buildServicePayload(form)),
    onSuccess: async (updated) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: catalogKeys.service(id) }),
        queryClient.invalidateQueries({ queryKey: catalogKeys.services }),
      ]);
      toast("Service updated", { description: `${updated.name} has been saved.` });
      navigate(`/services/${id}`);
    },
    onError: (err) => {
      toast.error("Could not update service", {
        description: err instanceof Error ? err.message : "Please try again.",
      });
    },
  });

  const handleSave = () => {
    const error = validateServiceForm(form);
    if (error) {
      toast.error("Check the form", { description: error });
      return;
    }
    saveMutation.mutate();
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Edit service" description="Loading service..." />
      </div>
    );
  }

  if (isError || !service) {
    return (
      <div className="space-y-6">
        <PageEmptyState title="Service not found" description="This service may have been removed." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Edit service" description={service.name} />

      <Card>
        <CardContent className="grid gap-6">
          <ServiceFormFields form={form} setForm={setForm} />

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => navigate(`/services/${id}`)} disabled={saveMutation.isPending}>
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
