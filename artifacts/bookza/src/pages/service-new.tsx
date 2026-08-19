import { useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { catalogKeys, createService, fetchServices } from "@/lib/catalog";
import {
  ServiceFormFields,
  buildServicePayload,
  emptyServiceForm,
  formFromService,
  validateServiceForm,
} from "@/components/services/service-form";
import { PageHeader } from "@/components/layout/page-ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";

export default function ServiceNewPage() {
  const [, navigate] = useLocation();
  const queryString = useSearch();
  const queryClient = useQueryClient();
  const duplicateOf = new URLSearchParams(queryString).get("duplicateOf");

  const { data: services } = useQuery({
    queryKey: catalogKeys.services,
    queryFn: fetchServices,
  });

  const [form, setForm] = useState(emptyServiceForm);
  // "Duplicate" on a service seeds this form rather than opening a dialog. The
  // seed runs once, when the source service arrives, so later edits stick.
  const [seededFrom, setSeededFrom] = useState<string | null>(null);
  const source = duplicateOf ? (services ?? []).find((service) => service.id === duplicateOf) : undefined;
  if (source && seededFrom !== source.id) {
    setSeededFrom(source.id);
    setForm({ ...formFromService(source), name: `${source.name} (Copy)` });
  }

  const createMutation = useMutation({
    mutationFn: createService,
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: catalogKeys.services });
      toast("Service created", { description: `${created.name} is now available for booking.` });
      // A business's genuinely first service hands the list page the new id so
      // its one-time tour can spotlight the real card.
      const wasFirstService = (services ?? []).length === 0;
      navigate(wasFirstService ? `/services?created=${created.id}` : `/services/${created.id}`);
    },
    onError: (err) => {
      toast.error("Could not create service", {
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
    createMutation.mutate(buildServicePayload(form));
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={duplicateOf ? "Duplicate service" : "New service"}
        description="Add something clients can book online."
      />

      <Card>
        <CardContent className="grid gap-6">
          <ServiceFormFields form={form} setForm={setForm} />

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => navigate("/services")} disabled={createMutation.isPending}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={createMutation.isPending}>
              {createMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Create service
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
