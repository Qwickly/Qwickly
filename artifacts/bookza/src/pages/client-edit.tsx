import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { catalogKeys, fetchClientProfile, updateClient } from "@/lib/catalog";
import { ClientFormFields, type ClientFormValue } from "@/components/clients/ClientFormFields";
import { PageEmptyState, PageHeader } from "@/components/layout/page-ui";
import { usePageChrome } from "@/components/layout/page-chrome";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";

export default function ClientEditPage({ id }: { id: string }) {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<ClientFormValue>({
    name: "",
    phone: "",
    email: "",
    clientType: "new",
    notes: "",
  });

  const { data: profile, isLoading, isError } = useQuery({
    queryKey: catalogKeys.client(id),
    queryFn: () => fetchClientProfile(id),
    enabled: Boolean(id),
  });

  const client = profile?.client;

  const pageChrome = useMemo(
    () => ({
      breadcrumbs: [
        { label: "Clients", href: "/clients" },
        { label: client?.name ?? "Client", href: `/clients/${id}` },
        { label: "Edit" },
      ],
    }),
    [client?.name, id],
  );
  usePageChrome(pageChrome);

  useEffect(() => {
    if (!client) return;
    setForm({
      name: client.name,
      phone: client.phone,
      email: client.email ?? "",
      clientType: client.clientType,
      notes: client.notes ?? "",
    });
  }, [client]);

  const saveMutation = useMutation({
    mutationFn: () =>
      updateClient(id, {
        name: form.name.trim(),
        phone: form.phone.trim(),
        email: form.email.trim() || null,
        clientType: form.clientType,
        notes: form.notes.trim() || null,
      }),
    onSuccess: async (updated) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: catalogKeys.client(id) }),
        queryClient.invalidateQueries({ queryKey: catalogKeys.clients }),
      ]);
      toast("Client updated", { description: `${updated.name} has been saved.` });
      navigate(`/clients/${id}`);
    },
    onError: (err) => {
      toast.error("Could not update client", {
        description: err instanceof Error ? err.message : "Please try again.",
      });
    },
  });

  const handleSave = () => {
    if (!form.name.trim() || !form.phone.trim()) {
      toast.error("Missing fields", { description: "Name and phone are required." });
      return;
    }
    saveMutation.mutate();
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Edit client" description="Loading client..." />
      </div>
    );
  }

  if (isError || !client) {
    return (
      <div className="space-y-6">
        <PageEmptyState title="Client not found" description="This client may have been removed." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Edit client" description={client.name} />

      <Card>
        <CardContent className="grid gap-6">
          <ClientFormFields value={form} onChange={setForm} />

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => navigate(`/clients/${id}`)} disabled={saveMutation.isPending}>
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
