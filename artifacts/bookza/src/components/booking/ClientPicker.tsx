import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { catalogKeys, createClient, fetchClients } from "@/lib/catalog";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { ClientFormFields, type ClientFormValue } from "@/components/clients/ClientFormFields";
import { Check, ChevronsUpDown, Loader2, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

const emptyClientForm = (): ClientFormValue => ({
  name: "",
  phone: "",
  email: "",
  clientType: "new",
  notes: "",
});

export function ClientPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (client: { id: string; name: string; phone: string }) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [selectedLabel, setSelectedLabel] = useState("");
  const [addingClient, setAddingClient] = useState(false);
  const [newClientForm, setNewClientForm] = useState<ClientFormValue>(emptyClientForm);

  useEffect(() => {
    if (!value) setSelectedLabel("");
  }, [value]);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const { data: clientsData, isFetching: clientsLoading } = useQuery({
    queryKey: ["catalog", "clients", "picker", search],
    queryFn: () => fetchClients(1, 20, "all", search),
    enabled: open,
  });
  const clients = clientsData?.clients ?? [];

  const createClientMutation = useMutation({
    mutationFn: createClient,
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: catalogKeys.clients });
      onChange({ id: created.id, name: created.name, phone: created.phone });
      setSelectedLabel(`${created.name} · ${created.phone}`);
      setNewClientForm(emptyClientForm());
      setAddingClient(false);
      setOpen(false);
      toast({ title: "Client added", description: `${created.name} has been saved.` });
    },
    onError: (err) => {
      toast({
        title: "Could not add client",
        description: err instanceof Error ? err.message : "Please try again",
        variant: "destructive",
      });
    },
  });

  const handleSaveNewClient = () => {
    if (!newClientForm.name.trim() || !newClientForm.phone.trim()) {
      toast({ title: "Name and phone are required", variant: "destructive" });
      return;
    }
    createClientMutation.mutate({
      name: newClientForm.name.trim(),
      phone: newClientForm.phone.trim(),
      email: newClientForm.email.trim() || null,
      clientType: newClientForm.clientType,
      notes: newClientForm.notes.trim() || null,
    });
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setAddingClient(false);
          setNewClientForm(emptyClientForm());
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between font-normal">
          {selectedLabel || "Select client"}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[360px] p-0" align="start">
        {addingClient ? (
          <div className="space-y-3 p-3">
            <ClientFormFields value={newClientForm} onChange={setNewClientForm} />
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setAddingClient(false);
                  setNewClientForm(emptyClientForm());
                }}
                disabled={createClientMutation.isPending}
              >
                Cancel
              </Button>
              <Button size="sm" onClick={handleSaveNewClient} disabled={createClientMutation.isPending}>
                {createClientMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Save client
              </Button>
            </div>
          </div>
        ) : (
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Search clients by name or phone…"
              value={searchInput}
              onValueChange={setSearchInput}
            />
            <CommandList>
              {clientsLoading ? (
                <div className="py-6 flex items-center justify-center">
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <>
                  <CommandEmpty>No clients found.</CommandEmpty>
                  <CommandGroup>
                    {clients.map((c) => (
                      <CommandItem
                        key={c.id}
                        value={c.id}
                        onSelect={() => {
                          onChange({ id: c.id, name: c.name, phone: c.phone });
                          setSelectedLabel(`${c.name} · ${c.phone}`);
                          setOpen(false);
                        }}
                      >
                        <Check className={cn("mr-2 h-4 w-4", value === String(c.id) ? "opacity-100" : "opacity-0")} />
                        {c.name} · {c.phone}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              )}
            </CommandList>
            <div className="border-t p-1">
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start text-primary"
                onClick={() => setAddingClient(true)}
              >
                <Plus className="w-3.5 h-3.5 mr-2" />
                New client
              </Button>
            </div>
          </Command>
        )}
      </PopoverContent>
    </Popover>
  );
}
