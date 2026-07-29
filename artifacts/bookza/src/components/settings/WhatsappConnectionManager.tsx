import { useEffect, useRef } from "react";
import QRCode from "qrcode";
import {
  Loader2,
  QrCode,
  Info,
  Unplug,
} from "lucide-react";
import { CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
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
  const { toast } = useToast();
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
      toast({
        title: "QR rendering failed",
        description: "We could not draw the QR code. Generate a fresh code and try again.",
        variant: "destructive",
      });
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
        toast({
          title: "QR code ready",
          description: "Scan it from WhatsApp on your phone to connect your account.",
        });
      } else if (nextState.status === "connected") {
        toast({
          title: "WhatsApp connected",
          description: "Your WhatsApp session is already connected.",
        });
      } else {
        toast({
          title: "Starting WhatsApp session",
          description: "The QR code can take a few seconds to appear. This page will refresh automatically.",
        });
      }
    } catch (error) {
      toast({
        title: "Could not generate QR code",
        description: error instanceof Error ? error.message : "Please try again in a moment.",
        variant: "destructive",
      });
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
      toast({
        title: "WhatsApp disconnected",
        description: "This WhatsApp Web session has been logged out from Qwickly.",
      });
    } catch (error) {
      toast({
        title: "Could not disconnect WhatsApp",
        description: error instanceof Error ? error.message : "Please try again in a moment.",
        variant: "destructive",
      });
    }
  };

  return (
    <SettingsPanel className="overflow-hidden">
      <CardHeader className="border-b border-border/60">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2">
              <span className="flex size-9 items-center justify-center rounded-lg border border-primary/15 bg-primary/10 text-primary">
                <QrCode className="h-4 w-4" />
              </span>
              WhatsApp Web Connection
            </CardTitle>
            <CardDescription>
              Pair your WhatsApp account with Qwickly so customer conversations can sync into the inbox.
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

      <CardContent className="p-4 md:p-5">
        <SettingsGroup>
          <SettingsRow
            title={connected ? "Connected" : "Not connected"}
            description={
              connected
                ? "Customer conversations are syncing into the shared inbox."
                : "Generate a QR code to create or reconnect this WhatsApp Web session."
            }
          />

          {connected && (
            <div className="flex items-start gap-2 border-t border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-400">
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
            <div className="border-t border-border/45 px-4 py-4">
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
