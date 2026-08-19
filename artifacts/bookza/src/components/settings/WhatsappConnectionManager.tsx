import { useEffect, useRef } from "react";
import QRCode from "qrcode";
import {
  Loader2,
  QrCode,
  Info,
  Smartphone,
  Unplug,
} from "lucide-react";
import { CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { useWhatsappConnection } from "@/hooks/use-whatsapp-connection";
import { notifyWhatsappConnectionChanged } from "@/lib/settings";
import { SettingsGroup, SettingsPanel, SettingsRow } from "@/components/settings/settings-ui";

async function renderQrToCanvas(canvas: HTMLCanvasElement, qrCode: string): Promise<void> {
  const context = canvas.getContext("2d");
  if (!context) return;

  if (qrCode.startsWith("data:image")) {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Could not render QR image"));
      image.src = qrCode;
    });
    canvas.width = image.width;
    canvas.height = image.height;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0);
    return;
  }

  await QRCode.toCanvas(canvas, qrCode, {
    margin: 1,
    width: 280,
    color: {
      dark: "#24a36f",
      light: "#ffffff",
    },
  });
}

export function WhatsappConnectionManager() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const {
    connection,
    connected,
    loading,
    generatingQr,
    disconnecting,
    generateQr,
    disconnect,
  } = useWhatsappConnection();

  useEffect(() => {
    if (!connection.qrCode || !canvasRef.current) return;

    void renderQrToCanvas(canvasRef.current, connection.qrCode).catch(() => {
      toast.error("QR rendering failed", { description: "We could not draw the QR code. Generate a fresh code and try again." });
    });
  }, [connection.status, connection.qrCode, loading, generatingQr, toast]);

  useEffect(() => {
    notifyWhatsappConnectionChanged(connection.status);
  }, [connection.status]);

  const handleGenerateQr = async () => {
    try {
      const nextState = await generateQr(connection.status === "qrcode");
      notifyWhatsappConnectionChanged(nextState.status);
      if (nextState.status === "qrcode") {
        toast("QR code ready", { description: "Scan it from WhatsApp on your phone to connect your account." });
      } else if (nextState.status === "connected") {
        toast("WhatsApp connected", { description: "Your WhatsApp session is already connected." });
      } else {
        toast("Starting WhatsApp session", { description: "The QR code can take a few seconds to appear. This page will refresh automatically." });
      }
    } catch (error) {
      toast.error("Could not generate QR code", { description: error instanceof Error ? error.message : "Please try again in a moment." });
    }
  };

  const handleDisconnect = async () => {
    if (
      !confirm(
        "Disconnect this WhatsApp account from Qwickly? New incoming messages will stop syncing until you reconnect.",
      )
    ) {
      return;
    }

    try {
      const nextState = await disconnect();
      notifyWhatsappConnectionChanged(nextState.status);
      toast("WhatsApp disconnected", { description: "This WhatsApp Web session has been logged out from Qwickly." });
    } catch (error) {
      toast.error("Could not disconnect WhatsApp", { description: error instanceof Error ? error.message : "Please try again in a moment." });
    }
  };

  return (
    <SettingsPanel>
      <CardHeader className="border-b border-border/60">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2">
              <span className="flex size-9 items-center justify-center rounded-lg border border-primary/15 bg-primary/10 text-primary">
                <QrCode className="h-4 w-4" />
              </span>
              Connect WhatsApp
            </CardTitle>
            <CardDescription>
              Generate a QR code, then scan it from WhatsApp on your phone using Linked devices. Once paired, client messages can sync into the Inbox and the AI assistant can respond.
            </CardDescription>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Button onClick={handleGenerateQr} disabled={generatingQr || disconnecting}>
              {generatingQr ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <QrCode className="mr-2 h-4 w-4" />}
              {connection.status === "qrcode" ? "Regenerate QR code" : "Generate QR code"}
            </Button>
            {connected && (
              <Button
                variant="outline"
                onClick={handleDisconnect}
                disabled={loading || generatingQr || disconnecting}
              >
                {disconnecting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Unplug className="mr-2 h-4 w-4" />
                )}
                Disconnect
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <SettingsGroup>
          {!connected && (
            <div className="grid gap-3 border-b border-border/45 px-6 py-4 md:grid-cols-3">
              {[
                {
                  title: "Use another screen",
                  description: "Keep this setup page open on your laptop or another device.",
                },
                {
                  title: "Open Linked devices",
                  description: "On your phone, open WhatsApp, then go to Linked devices.",
                },
                {
                  title: "Scan the QR code",
                  description: "Generate the code below and scan it with your phone to pair Qwickly.",
                },
              ].map((step, index) => (
                <div key={step.title} className="rounded-xl border border-border/45 bg-muted/20 p-4">
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                      {index + 1}
                    </span>
                    <Smartphone className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </div>
                  <p className="mt-3 text-sm font-semibold text-foreground">{step.title}</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{step.description}</p>
                </div>
              ))}
            </div>
          )}

          <SettingsRow
            title={connected ? "Connected" : "Not connected"}
            description={
              connected
                ? "Customer conversations are syncing into the shared inbox."
                : "Click Generate QR code, open WhatsApp on your phone, go to Linked devices, then scan the code shown here."
            }
          />

          {connected && (
            <div className="flex items-start gap-2 border-t border-amber-200 bg-amber-50 px-6 py-4 text-sm text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-400">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="space-y-1">
                <p className="font-medium">Unlink it from your phone too</p>
                <p>
                  In WhatsApp, open Linked devices, choose this Qwickly session, then tap Log out. Use the button above to clear Qwickly's saved session.
                </p>
              </div>
            </div>
          )}

          {!connected && (
            <div className="border-t border-border/45 px-6 py-4">
              <div className="flex min-h-[260px] items-center justify-center rounded-xl border border-dashed border-border/70 bg-muted/20 p-4 sm:min-h-[320px] sm:p-6">
                {loading || generatingQr ? (
                  <div className="w-full max-w-[240px] space-y-4 sm:max-w-[280px]">
                    <Skeleton className="aspect-square w-full rounded-xl" />
                    <Skeleton className="mx-auto h-4 w-48" />
                  </div>
                ) : connection.status === "qrcode" && connection.qrCode ? (
                  <div className="w-full max-w-[240px] space-y-4 text-center sm:max-w-[280px]">
                    <canvas ref={canvasRef} className="mx-auto aspect-square w-full rounded-xl bg-white p-3 shadow-sm sm:p-4" />
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      Scan this QR code from WhatsApp on your phone. Status will update automatically after pairing.
                    </p>
                  </div>
                ) : (
                  <div className="max-w-sm space-y-3 text-center">
                    <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <QrCode className="size-8" />
                    </div>
                    <div>
                      <p className="font-medium">No active QR code</p>
                      <p className="text-sm text-muted-foreground">
                        Generate a QR code to create or reconnect this WhatsApp Web session.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </SettingsGroup>
      </CardContent>
    </SettingsPanel>
  );
}
