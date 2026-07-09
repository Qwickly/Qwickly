import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
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
  Mail,
} from "lucide-react";
import { cn } from "@/lib/utils";
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
  const {
    data: domain,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["email-domain"],
    queryFn: fetchEmailDomain,
  });

  const [domainInput, setDomainInput] = useState("");
  const [localPart, setLocalPart] = useState("bookings");
  const [busy, setBusy] = useState<null | "add" | "verify" | "remove">(null);
  // Which sending mode the panel is showing. Until the user picks, it reflects
  // reality: a configured domain opens on "custom", otherwise "qwickly".
  const [override, setOverride] = useState<"qwickly" | "custom" | null>(null);
  const mode: "qwickly" | "custom" = override ?? (domain ? "custom" : "qwickly");

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Copied", description: text });
    } catch {
      toast({
        title: "Copy failed",
        description: "Copy it manually.",
        variant: "destructive",
      });
    }
  }

  async function handleAdd() {
    if (!domainInput.trim()) return;
    setBusy("add");
    try {
      await registerEmailDomain(
        domainInput.trim(),
        localPart.trim() || "bookings",
      );
      await refetch();
      toast({
        title: "Domain added",
        description:
          "Add the DNS records below at your domain provider, then click Verify.",
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
          ? {
              title: "Domain verified",
              description: "Your emails will now send from your own domain.",
            }
          : {
              title: "Not verified yet",
              description:
                "DNS records aren't resolving yet. They can take up to 48 hours.",
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
      setOverride("qwickly");
      toast({
        title: "Domain removed",
        description: "Emails will send from the Qwickly domain again.",
      });
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
          <CardTitle className="text-lg">Email sending</CardTitle>
          <CardDescription className="text-sm">
            Choose whether booking emails are sent from Qwickly or from your own
            domain.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-0 md:p-5 md:pt-0">
        <SendingModeToggle mode={mode} onChange={setOverride} />

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={mode}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            {mode === "qwickly" ? (
              <QwicklyEmailPanel domain={domain} />
            ) : isLoading ? (
              <div className="flex items-center gap-2 rounded-lg border border-border/60 p-4 text-sm text-muted-foreground">
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
          </motion.div>
        </AnimatePresence>
      </CardContent>
    </Card>
  );
}

function SendingModeToggle({
  mode,
  onChange,
}: {
  mode: "qwickly" | "custom";
  onChange: (m: "qwickly" | "custom") => void;
}) {
  const options: { value: "qwickly" | "custom"; label: string; icon: typeof Mail }[] = [
    { value: "qwickly", label: "Qwickly email", icon: Mail },
    { value: "custom", label: "Your own domain", icon: Globe },
  ];
  return (
    <div className="grid grid-cols-2 gap-2">
      {options.map((o) => {
        const selected = mode === o.value;
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={cn(
              "flex items-center gap-2.5 rounded-lg border p-3 text-left transition-colors",
              selected
                ? "border-primary bg-primary/5 text-primary shadow-sm"
                : "border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground",
            )}
          >
            <span
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors",
                selected ? "bg-primary text-white" : "bg-muted text-muted-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
            </span>
            <span className="truncate text-sm font-medium">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function QwicklyEmailPanel({ domain }: { domain: EmailDomain | null | undefined }) {
  return (
    <div className="space-y-3 rounded-lg border border-border/60 p-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Mail className="h-4 w-4" />
        </div>
        <div className="space-y-0.5">
          <p className="text-sm font-medium">Send from Qwickly</p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Booking emails are sent from Qwickly&rsquo;s verified domain, with your business
            name in the sender and replies going to your own email. Nothing to set up.
          </p>
        </div>
      </div>

      {domain && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 text-xs leading-relaxed text-amber-700 dark:text-amber-400">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            You&rsquo;ve connected <span className="font-medium">{domain.domain}</span>. It stays
            connected until you remove it &mdash; switch to &ldquo;Your own domain&rdquo; to manage it.
          </span>
        </div>
      )}
    </div>
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
    <div className="space-y-4 rounded-lg border border-border/60 p-4">
      <div className="grid gap-3 sm:grid-cols-[1fr,1.4fr]">
        <div className="space-y-1.5">
          <Label htmlFor="cd-local" className="text-sm">
            Send from
          </Label>
          <Input
            id="cd-local"
            value={props.localPart}
            onChange={(e) => props.setLocalPart(e.target.value)}
            placeholder="bookings"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cd-domain" className="text-sm">
            Your domain
          </Label>
          <Input
            id="cd-domain"
            value={props.domainInput}
            onChange={(e) => props.setDomainInput(e.target.value)}
            placeholder="salon.co.za"
          />
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        Emails will send from{" "}
        <span className="font-medium text-foreground">{preview}</span>
      </p>
      <Button
        onClick={props.onAdd}
        disabled={props.busy || !props.domainInput.trim()}
      >
        {props.busy ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Globe className="mr-2 h-4 w-4" />
        )}
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
    <div className="space-y-4 rounded-lg border border-border/60 p-4">
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
            Add these CNAME records at your DNS provider, then click Verify. DNS
            changes can take up to 48 hours to take effect.
          </p>
          <div className="overflow-x-auto rounded-lg border border-border/60">
            <table className="w-full min-w-[560px] table-fixed text-left text-sm">
              <colgroup>
                <col className="w-[92px]" />
                <col className="w-[38%]" />
                <col />
              </colgroup>
              <thead>
                <tr className="border-b border-border/60 bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Type</th>
                  <th className="px-4 py-2.5 font-medium">Name / Host</th>
                  <th className="px-4 py-2.5 font-medium">Value</th>
                </tr>
              </thead>
              <tbody>
                {domain.dnsRecords.map((r) => (
                  <tr
                    key={r.key}
                    className="border-b border-border/60 transition-colors duration-200 last:border-b-0 hover:bg-primary/5"
                  >
                    <td className="px-4 py-3 align-middle">
                      <span className="inline-flex items-center rounded-md border border-border/60 bg-muted/50 px-2 py-0.5 font-mono text-[11px] font-medium uppercase text-muted-foreground">
                        {r.type || "CNAME"}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <CopyCell value={r.host} onCopy={props.onCopy} />
                    </td>
                    <td className="px-4 py-3 align-middle">
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
        <Button
          variant="outline"
          onClick={props.onRemove}
          disabled={props.busy !== null}
        >
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
      <Badge
        variant="outline"
        className="gap-1 border-amber-500/40 text-amber-600 dark:text-amber-400"
      >
        <AlertCircle className="h-3.5 w-3.5" /> Not verified
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 text-muted-foreground">
      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Pending
    </Badge>
  );
}

function CopyCell({
  value,
  onCopy,
}: {
  value: string;
  onCopy: (text: string) => void;
}) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex items-center gap-2">
      {/* Single-line, truncated value keeps every row the same height; the full
          string is available on hover and via the copy button. min-w-0 lets it
          shrink inside the flex row so `truncate` actually engages. */}
      <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground" title={value}>
        {value}
      </span>
      <button
        type="button"
        onClick={() => onCopy(value)}
        className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        title="Copy"
        aria-label="Copy to clipboard"
      >
        <Copy className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
