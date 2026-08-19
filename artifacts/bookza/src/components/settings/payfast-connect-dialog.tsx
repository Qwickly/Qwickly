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
  const [mode, setMode] = useState<"sandbox" | "live">("sandbox");

  useEffect(() => {
    if (!open) return;
    let mounted = true;
    setLoading(true);
    fetchPayFastConfig()
      .then((config) => {
        if (!mounted) return;
        setExisting(config);
        setMerchantId(config?.merchantId ?? "");
        setMode(config?.mode ?? "sandbox");
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
      await savePayFastConfig({
        merchantId: merchantId.trim(),
        merchantKey: merchantKey.trim(),
        passphrase: passphrase.trim() || undefined,
        mode,
      });
      const config = await fetchPayFastConfig();
      if (config) onSaved(config);
      toast("PayFast connected", { description: "Deposits will now be collected into this account." });
      onOpenChange(false);
    } catch (err) {
      toast.error("Could not save PayFast settings", { description: err instanceof Error ? err.message : "Please try again" });
    } finally {
      setSaving(false);
    }
  }

  async function handleDisconnect() {
    setSaving(true);
    try {
      await disconnectPayFast();
      onDisconnected();
      toast("PayFast disconnected", { description: "Campaigns fall back to the shared sandbox account." });
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
                  { value: "sandbox", label: "Sandbox" },
                  { value: "live", label: "Live" },
                ]}
              />
              <p className="text-xs text-muted-foreground">
                Start with Sandbox to test the flow with PayFast's test cards before switching to Live.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="payfast-merchant-id">Merchant ID</Label>
              <Input
                id="payfast-merchant-id"
                value={merchantId}
                onChange={(e) => setMerchantId(e.target.value)}
                placeholder="10000100"
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

        <DialogFooter className="gap-2 sm:justify-between">
          {existing?.connected ? (
            <Button variant="ghost" className="text-destructive" onClick={handleDisconnect} disabled={saving}>
              Disconnect
            </Button>
          ) : (
            <span />
          )}
          <Button onClick={handleSave} disabled={saving || loading}>
            {saving ? "Saving…" : "Save & Connect"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
