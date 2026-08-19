import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { catalogKeys, createClient } from "@/lib/catalog";
import { ClientFormFields, type ClientFormValue } from "@/components/clients/ClientFormFields";
import { PageHeader } from "@/components/layout/page-ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";

const emptyClientForm = (): ClientFormValue => ({
  name: "",
  phone: "",
  email: "",
  clientType: "new",
  notes: "",
});

export default function ClientNewPage() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<ClientFormValue>(emptyClientForm);

  const createMutation = useMutation({
    mutationFn: createClient,
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: catalogKeys.clients });
      toast("Client added", { description: `${created.name} has been saved.` });
      navigate(`/clients/${created.id}`);
    },
    onError: (err) => {
      toast.error("Could not add client", {
        description: err instanceof Error ? err.message : "Please try again.",
      });
    },
  });

  const handleSave = () => {
    if (!form.name.trim() || !form.phone.trim()) {
      toast.error("Missing fields", { description: "Name and phone are required." });
      return;
    }
    createMutation.mutate({
      name: form.name.trim(),
      phone: form.phone.trim(),
      email: form.email.trim() || null,
      clientType: form.clientType,
      notes: form.notes.trim() || null,
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader title="New client" description="Add a client to your contact list." />

      <Card>
        <CardContent className="grid gap-6">
          <ClientFormFields value={form} onChange={setForm} />

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => navigate("/clients")} disabled={createMutation.isPending}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={createMutation.isPending}>
              {createMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Add client
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
