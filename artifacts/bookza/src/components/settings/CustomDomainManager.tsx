import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Globe,
  Copy,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Trash2,
  AlertCircle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  fetchEmailDomain,
  registerEmailDomain,
  verifyEmailDomain,
  deleteEmailDomain,
  type EmailDomain,
} from "@/lib/email-domains";

/**
 * Stage 2 custom-domain manager. Lets a business send booking emails From its own
 * verified domain instead of the shared Qwickly domain. Three states:
 *   1. No domain → enter domain + mailbox, register (creates SendGrid auth).
 *   2. Pending/failed → show the CNAME records to add at their DNS provider + Verify.
 *   3. Verified → show the active From address + option to remove.
 * All SendGrid work happens server-side; this only reads status and triggers actions.
 */
export function CustomDomainManager() {
  const { toast } = useToast();
  const { data: domain, isLoading, refetch } = useQuery({
    queryKey: ["email-domain"],
    queryFn: fetchEmailDomain,
  });

  const [domainInput, setDomainInput] = useState("");
  const [localPart, setLocalPart] = useState("bookings");
  const [busy, setBusy] = useState<null | "add" | "verify" | "remove">(null);

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Copied", description: text });
    } catch {
      toast({ title: "Copy failed", description: "Copy it manually.", variant: "destructive" });
    }
  }

  async function handleAdd() {
    if (!domainInput.trim()) return;
    setBusy("add");
    try {
      await registerEmailDomain(domainInput.trim(), localPart.trim() || "bookings");
      await refetch();
      toast({
        title: "Domain added",
        description: "Add the DNS records below at your domain provider, then click Verify.",
      });
      setDomainInput("");
    } catch (err) {
      toast({
        title: "Could not add domain",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  }

  async function handleVerify() {
    setBusy("verify");
    try {
      const { valid } = await verifyEmailDomain();
      await refetch();
      toast(
        valid
          ? { title: "Domain verified", description: "Your emails will now send from your own domain." }
          : {
              title: "Not verified yet",
              description: "DNS records aren't resolving yet. They can take up to 48 hours.",
              variant: "destructive",
            },
      );
    } catch (err) {
      toast({
        title: "Verification failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  }

  async function handleRemove() {
    setBusy("remove");
    try {
      await deleteEmailDomain();
      await refetch();
      toast({ title: "Domain removed", description: "Emails will send from the Qwickly domain again." });
    } catch (err) {
      toast({
        title: "Could not remove domain",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="border-0 bg-transparent shadow-none md:border-border/60 md:bg-card md:shadow-sm">
      <CardHeader className="flex flex-row items-start gap-3 p-0 pb-4 md:p-5">
        <div className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/15 bg-primary/10 text-primary md:flex">
          <Globe className="h-4 w-4" />
        </div>
        <div className="flex-1">
          <CardTitle className="text-lg">Send from your own domain</CardTitle>
          <CardDescription className="text-sm">
            By default emails come from the Qwickly domain. Connect your own domain so booking
            emails are sent from your business address instead.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-0 md:p-5 md:pt-0">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : !domain ? (
          <AddDomainForm
            domainInput={domainInput}
            setDomainInput={setDomainInput}
            localPart={localPart}
            setLocalPart={setLocalPart}
            busy={busy === "add"}
            onAdd={handleAdd}
          />
        ) : (
          <DomainStatus
            domain={domain}
            busy={busy}
            onVerify={handleVerify}
            onRemove={handleRemove}
            onCopy={copy}
          />
        )}
      </CardContent>
    </Card>
  );
}

function AddDomainForm(props: {
  domainInput: string;
  setDomainInput: (v: string) => void;
  localPart: string;
  setLocalPart: (v: string) => void;
  busy: boolean;
  onAdd: () => void;
}) {
  const preview = `${props.localPart.trim() || "bookings"}@${props.domainInput.trim() || "yourdomain.co.za"}`;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[1fr,1.4fr]">
        <div className="space-y-1.5">
          <Label htmlFor="cd-local" className="text-sm">Send from</Label>
          <Input
            id="cd-local"
            value={props.localPart}
            onChange={(e) => props.setLocalPart(e.target.value)}
            placeholder="bookings"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cd-domain" className="text-sm">Your domain</Label>
          <Input
            id="cd-domain"
            value={props.domainInput}
            onChange={(e) => props.setDomainInput(e.target.value)}
            placeholder="salon.co.za"
          />
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        Emails will send from <span className="font-medium text-foreground">{preview}</span>
      </p>
      <Button onClick={props.onAdd} disabled={props.busy || !props.domainInput.trim()}>
        {props.busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Globe className="mr-2 h-4 w-4" />}
        Add domain
      </Button>
    </div>
  );
}

function DomainStatus(props: {
  domain: EmailDomain;
  busy: null | "add" | "verify" | "remove";
  onVerify: () => void;
  onRemove: () => void;
  onCopy: (text: string) => void;
}) {
  const { domain } = props;
  const verified = domain.status === "verified";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{domain.fromAddress}</p>
          <p className="text-sm text-muted-foreground">{domain.domain}</p>
        </div>
        <StatusBadge status={domain.status} />
      </div>

      {domain.lastError && !verified && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-400">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{domain.lastError}</span>
        </div>
      )}

      {!verified && domain.dnsRecords.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Add these CNAME records at your DNS provider, then click Verify. DNS changes can take
            up to 48 hours to take effect.
          </p>
          <div className="overflow-x-auto rounded-lg border border-border/60">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Host / Name</th>
                  <th className="px-3 py-2 font-medium">Value</th>
                </tr>
              </thead>
              <tbody>
                {domain.dnsRecords.map((r) => (
                  <tr key={r.key} className="border-t border-border/60 align-top">
                    <td className="px-3 py-2 uppercase text-muted-foreground">{r.type || "CNAME"}</td>
                    <td className="px-3 py-2">
                      <CopyCell value={r.host} onCopy={props.onCopy} />
                    </td>
                    <td className="px-3 py-2">
                      <CopyCell value={r.data} onCopy={props.onCopy} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {!verified && (
          <Button onClick={props.onVerify} disabled={props.busy !== null}>
            {props.busy === "verify" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Verify domain
          </Button>
        )}
        <Button variant="outline" onClick={props.onRemove} disabled={props.busy !== null}>
          {props.busy === "remove" ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="mr-2 h-4 w-4" />
          )}
          Remove
        </Button>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: EmailDomain["status"] }) {
  if (status === "verified") {
    return (
      <Badge className="gap-1 bg-primary/15 text-primary hover:bg-primary/15">
        <CheckCircle2 className="h-3.5 w-3.5" /> Verified
      </Badge>
    );
  }
  if (status === "failed") {
    return (
      <Badge variant="outline" className="gap-1 border-amber-500/40 text-amber-600 dark:text-amber-400">
        <AlertCircle className="h-3.5 w-3.5" /> Not verified
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 text-muted-foreground">
      <Loader2 className="h-3.5 w-3.5" /> Pending
    </Badge>
  );
}

function CopyCell({ value, onCopy }: { value: string; onCopy: (text: string) => void }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  return (
    <button
      type="button"
      onClick={() => onCopy(value)}
      className="group flex max-w-[240px] items-center gap-1.5 break-all text-left font-mono text-xs hover:text-primary"
      title="Copy"
    >
      <span className="break-all">{value}</span>
      <Copy className="h-3 w-3 shrink-0 opacity-40 group-hover:opacity-100" />
    </button>
  );
}
