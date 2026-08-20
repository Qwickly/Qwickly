import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { SettingsSegmentedControl } from "@/components/settings/settings-ui";
import {
  disconnectPayFast,
  fetchPayFastConfig,
  savePayFastConfig,
  type PayFastProviderConfig,
} from "@/lib/payment-providers";
import { toast } from "sonner";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (config: PayFastProviderConfig) => void;
  onDisconnected: () => void;
};

export function PayFastConnectDialog({ open, onOpenChange, onSaved, onDisconnected }: Props) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [existing, setExisting] = useState<PayFastProviderConfig | null>(null);
  const [merchantId, setMerchantId] = useState("");
  const [merchantKey, setMerchantKey] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [mode, setMode] = useState<"sandbox" | "live">("live");

  useEffect(() => {
    if (!open) return;
    let mounted = true;
    setLoading(true);
    fetchPayFastConfig()
      .then((config) => {
        if (!mounted) return;
        setExisting(config);
        setMerchantId(config?.merchantId ?? "");
        setMode(config?.mode ?? "live");
        setMerchantKey("");
        setPassphrase("");
      })
      .catch((err) => {
        toast.error("Could not load PayFast settings", { description: err instanceof Error ? err.message : "Please try again" });
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [open, toast]);

  async function handleSave() {
    if (!merchantId.trim() || !merchantKey.trim()) {
      toast.error("Merchant ID and Merchant Key are required");
      return;
    }
    setSaving(true);
    try {
      // Rejected details come back as an error with PayFast's reason on it,
      // and land in the catch below. A success with `verified: false` means the
      // details were saved but PayFast could not be reached to confirm them —
      // worth saying, because until it is confirmed the business is not
      // actually able to take a payment.
      const result = await savePayFastConfig({
        merchantId: merchantId.trim(),
        merchantKey: merchantKey.trim(),
        passphrase: passphrase.trim() || undefined,
        mode,
      });
      const config = await fetchPayFastConfig();
      if (config) onSaved(config);

      if (result.verified === false) {
        toast.warning("Saved, but not confirmed", {
          description:
            result.warning ??
            "We couldn't reach PayFast to check these details. Open this again to retry before taking payments.",
        });
      } else {
        toast("PayFast connected", {
          description: "We checked these details with PayFast. Deposits go into this account.",
        });
      }
      onOpenChange(false);
    } catch (err) {
      toast.error("PayFast didn't accept those details", { description: err instanceof Error ? err.message : "Please try again" });
    } finally {
      setSaving(false);
    }
  }

  async function handleDisconnect() {
    setSaving(true);
    try {
      await disconnectPayFast();
      onDisconnected();
      toast("PayFast disconnected", { description: "Deposits are switched off until you connect an account again." });
      onOpenChange(false);
    } catch (err) {
      toast.error("Could not disconnect PayFast", { description: err instanceof Error ? err.message : "Please try again" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Connect PayFast</DialogTitle>
          <DialogDescription>
            Deposits collect directly into this PayFast merchant account — Qwickly never touches the funds.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="payfast-mode">Mode</Label>
              <SettingsSegmentedControl<"sandbox" | "live">
                value={mode}
                onChange={setMode}
                options={[
                  { value: "live", label: "Live" },
                  { value: "sandbox", label: "Test mode" },
                ]}
              />
              {mode === "sandbox" ? (
                <p className="text-xs leading-5 text-amber-700 dark:text-amber-400">
                  Test mode sends your clients to PayFast&apos;s sandbox. Bookings go through and
                  deposits look paid, but <strong>no money is collected</strong>. Switch to Live
                  before you share your booking link.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Live collects real deposits into this account. Test mode is for trying the flow
                  with PayFast&apos;s test cards.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="payfast-merchant-id">Merchant ID</Label>
              <Input
                id="payfast-merchant-id"
                value={merchantId}
                onChange={(e) => setMerchantId(e.target.value)}
                placeholder="Your PayFast Merchant ID"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="payfast-merchant-key">Merchant Key</Label>
              <Input
                id="payfast-merchant-key"
                value={merchantKey}
                onChange={(e) => setMerchantKey(e.target.value)}
                placeholder={existing?.merchantKeyMasked ?? "46f0cd694581a"}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="payfast-passphrase">Passphrase (optional)</Label>
              <Input
                id="payfast-passphrase"
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder={existing?.hasPassphrase ? "•••••••• (unchanged)" : "Set in PayFast's integration settings"}
              />
              <p className="text-xs text-muted-foreground">
                Leave blank to keep the current passphrase. Only used server-side to verify payment
                notifications — never shown again after saving.
              </p>
            </div>
          </div>
        )}

        <DialogFooter
          leading={
            existing?.connected ? (
              <Button variant="ghost" className="text-destructive" onClick={handleDisconnect} disabled={saving}>
                Disconnect
              </Button>
            ) : null
          }
        >
          <Button onClick={handleSave} disabled={saving || loading}>
            {saving ? "Saving…" : "Save & Connect"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
