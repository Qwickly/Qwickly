import { useEffect, useRef } from "react";
import QRCode from "qrcode";
import {
  CheckCircle2,
  Loader2,
  MessageSquareDashed,
  QrCode,
  RefreshCcw,
  Smartphone,
  Info,
  Unplug,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useWhatsappConnection } from "@/hooks/use-whatsapp-connection";
import { notifyWhatsappConnectionChanged } from "@/lib/settings";

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
      dark: "#111827",
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
    refresh,
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
      const nextState = await generateQr();
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
        "Disconnect this WhatsApp account from Bookza? New incoming messages will stop syncing until you reconnect.",
      )
    ) {
      return;
    }

    try {
      const nextState = await disconnect();
      notifyWhatsappConnectionChanged(nextState.status);
      toast({
        title: "WhatsApp disconnected",
        description: "This tenant session has been logged out from Bookza.",
      });
    } catch (error) {
      toast({
        title: "Could not disconnect WhatsApp",
        description: error instanceof Error ? error.message : "Please try again in a moment.",
        variant: "destructive",
      });
    }
  };

  const statusBadge = connected ? (
    <Badge className="bg-emerald-100 text-emerald-700 border border-emerald-200 flex items-center gap-1.5">
      <span className="size-2 rounded-full bg-emerald-500" />
      Connected
    </Badge>
  ) : (
    <Badge variant="outline" className="flex items-center gap-1.5">
      <span className="size-2 rounded-full bg-red-500" />
      Disconnected
    </Badge>
  );

  return (
    <Card className="shadow-sm border-border/50">
      <CardHeader>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2">
              <QrCode className="h-5 w-5 text-primary" />
              WhatsApp Connection
            </CardTitle>
            <CardDescription>
              Connect each tenant account by scanning a secure QR code instead of storing phone numbers, API tokens, or manual webhooks in the dashboard.
            </CardDescription>
          </div>
          {statusBadge}
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border bg-muted/20 p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium">
              {connected ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Unplug className="h-4 w-4 text-red-500" />}
              Live status
            </div>
            <p className="text-sm text-muted-foreground">
              {connected
                ? "This tenant account is authenticated and ready to send or receive WhatsApp messages."
                : connection.status === "qrcode"
                  ? "A QR code is active. Scan it from the tenant’s WhatsApp mobile app to finish the session."
                  : "No active session yet. Generate a QR code to start pairing this tenant account."}
            </p>
          </div>

          <div className="rounded-xl border bg-muted/20 p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium">
              <Smartphone className="h-4 w-4 text-primary" />
              Connected number
            </div>
            <p className="text-sm text-muted-foreground">
              {connection.connectedPhone ?? "A number will appear here after the WhatsApp account completes pairing."}
            </p>
          </div>

          <div className="rounded-xl border bg-muted/20 p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium">
              <MessageSquareDashed className="h-4 w-4 text-primary" />
              Instance ID
            </div>
            <p className="break-all text-sm text-muted-foreground">
              {connection.instanceId ?? "A unique Evolution instance will be created for this tenant on first connect."}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            className="bg-primary hover:bg-primary/90"
            onClick={handleGenerateQr}
            disabled={generatingQr || disconnecting}
          >
            {generatingQr ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <QrCode className="mr-2 h-4 w-4" />}
            {connection.status === "qrcode" ? "Regenerate QR Code" : "Generate Connection QR Code"}
          </Button>
          <Button
            variant="outline"
            onClick={() => void refresh()}
            disabled={loading || generatingQr || disconnecting}
          >
            <RefreshCcw className="mr-2 h-4 w-4" />
            Refresh Status
          </Button>
          {connected && (
            <Button
              variant="destructive"
              onClick={handleDisconnect}
              disabled={loading || generatingQr || disconnecting}
            >
              {disconnecting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Unplug className="mr-2 h-4 w-4" />
              )}
              Disconnect WhatsApp
            </Button>
          )}
        </div>

        {connected && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-100">
            <div className="flex gap-3">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="space-y-2">
                <p className="text-sm font-medium">Unlink it from your phone too</p>
                <p className="text-sm">
                  In WhatsApp, open Linked devices, choose this Bookza session, then tap Log out. Use the button above to clear Bookza's saved session.
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="rounded-2xl border bg-card p-5">
          <div className="flex min-h-[320px] items-center justify-center rounded-xl border border-dashed bg-muted/20 p-6">
            {(loading || generatingQr) ? (
              <div className="space-y-4">
                <Skeleton className="h-[280px] w-[280px] rounded-xl" />
                <Skeleton className="mx-auto h-4 w-48" />
              </div>
            ) : connection.status === "qrcode" && connection.qrCode ? (
              <div className="space-y-4 text-center">
                <canvas ref={canvasRef} className="mx-auto rounded-xl bg-white p-4 shadow-sm" />
                <p className="text-sm text-muted-foreground">
                  Scan this QR code from the tenant’s WhatsApp app. Status will update automatically after pairing.
                </p>
              </div>
            ) : connected ? (
              <div className="space-y-3 text-center">
                <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                  <CheckCircle2 className="size-8" />
                </div>
                <div>
                  <p className="font-medium">WhatsApp account connected</p>
                  <p className="text-sm text-muted-foreground">
                    The tenant session is live and ready for inbound and outbound messaging.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-3 text-center">
                <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <QrCode className="size-8" />
                </div>
                <div>
                  <p className="font-medium">No active QR code</p>
                  <p className="text-sm text-muted-foreground">
                    Generate a QR code to create or reconnect this tenant’s WhatsApp session.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
