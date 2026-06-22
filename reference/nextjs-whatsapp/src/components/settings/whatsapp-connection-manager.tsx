"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { CheckCircle2, Loader2, QrCode, RefreshCcw } from "lucide-react";

type WhatsappStatus = "qrcode" | "connected" | "disconnected";

type WhatsappStatusResponse = {
  status: WhatsappStatus;
  instanceId: string | null;
  qrCode: string | null;
  connectedPhone: string | null;
  updatedAt: string | null;
};

async function fetchStatus(): Promise<WhatsappStatusResponse> {
  const response = await fetch("/api/whatsapp/status", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Could not fetch WhatsApp status");
  }
  return response.json() as Promise<WhatsappStatusResponse>;
}

async function generateQr(): Promise<WhatsappStatusResponse> {
  const response = await fetch("/api/whatsapp/connect", { method: "POST" });
  if (!response.ok) {
    throw new Error("Could not generate WhatsApp QR code");
  }
  return response.json() as Promise<WhatsappStatusResponse>;
}

export function WhatsappConnectionManager() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [status, setStatus] = useState<WhatsappStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    void fetchStatus()
      .then(setStatus)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!status?.qrCode || !canvasRef.current) return;
    void QRCode.toCanvas(canvasRef.current, status.qrCode, { width: 280, margin: 1 });
  }, [status?.qrCode]);

  useEffect(() => {
    if (status?.status !== "qrcode") return;

    const interval = window.setInterval(() => {
      void fetchStatus().then(setStatus);
    }, 5000);

    return () => window.clearInterval(interval);
  }, [status?.status]);

  const isConnected = status?.status === "connected";

  return (
    <div className="rounded-2xl border bg-card p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">WhatsApp connection</h2>
          <p className="text-sm text-muted-foreground">
            Pair the tenant’s own WhatsApp account by scanning a QR code.
          </p>
        </div>
        <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm ${isConnected ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"}`}>
          <span className={`size-2 rounded-full ${isConnected ? "bg-emerald-500" : "bg-red-500"}`} />
          {isConnected ? "Connected" : "Disconnected"}
        </div>
      </div>

      <div className="mb-4 flex gap-2">
        <button
          className="inline-flex items-center rounded-lg bg-black px-4 py-2 text-sm font-medium text-white"
          disabled={generating}
          onClick={async () => {
            setGenerating(true);
            try {
              setStatus(await generateQr());
            } finally {
              setGenerating(false);
            }
          }}
        >
          {generating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <QrCode className="mr-2 h-4 w-4" />}
          Generate Connection QR Code
        </button>

        <button
          className="inline-flex items-center rounded-lg border px-4 py-2 text-sm font-medium"
          onClick={async () => setStatus(await fetchStatus())}
        >
          <RefreshCcw className="mr-2 h-4 w-4" />
          Refresh status
        </button>
      </div>

      <div className="flex min-h-[320px] items-center justify-center rounded-xl border border-dashed bg-muted/20 p-6">
        {loading ? (
          <Loader2 className="h-6 w-6 animate-spin" />
        ) : isConnected ? (
          <div className="text-center">
            <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-emerald-600" />
            <p className="font-medium">WhatsApp connected</p>
            <p className="text-sm text-muted-foreground">{status?.connectedPhone ?? "Session active"}</p>
          </div>
        ) : status?.qrCode ? (
          <canvas ref={canvasRef} className="rounded-xl bg-white p-4" />
        ) : (
          <p className="text-sm text-muted-foreground">Generate a QR code to start pairing.</p>
        )}
      </div>
    </div>
  );
}
