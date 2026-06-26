import { useCallback, useEffect, useState } from "react";
import {
  WHATSAPP_CONNECTION_CHANGED,
  createWhatsappConnectionQr,
  disconnectWhatsappConnection,
  fetchWhatsappConnectionStatus,
  type WhatsappConnectionState,
  type WhatsappSessionStatus,
} from "@/lib/settings";

export function useWhatsappConnection() {
  const [connection, setConnection] = useState<WhatsappConnectionState>({
    status: "disconnected",
    instanceId: null,
    qrCode: null,
    connectedPhone: null,
    updatedAt: null,
  });
  const [loading, setLoading] = useState(true);
  const [generatingQr, setGeneratingQr] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setConnection(await fetchWhatsappConnectionStatus());
    } catch {
      setConnection({
        status: "disconnected",
        instanceId: null,
        qrCode: null,
        connectedPhone: null,
        updatedAt: null,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  const generateQr = useCallback(async () => {
    setGeneratingQr(true);
    try {
      const nextState = await createWhatsappConnectionQr();
      setConnection(nextState);
      return nextState;
    } finally {
      setGeneratingQr(false);
      setLoading(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    setDisconnecting(true);
    try {
      const nextState = await disconnectWhatsappConnection();
      setConnection(nextState);
      return nextState;
    } finally {
      setDisconnecting(false);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();

    const onConnectionChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ status?: WhatsappSessionStatus }>).detail;
      if (detail?.status) {
        setConnection((current) => ({
          ...current,
          status: detail.status!,
          qrCode: detail.status === "connected" ? null : current.qrCode,
        }));
        setLoading(false);
      }
    };

    window.addEventListener(WHATSAPP_CONNECTION_CHANGED, onConnectionChanged);
    window.addEventListener("focus", refresh);

    const interval = window.setInterval(() => {
      void refresh();
    }, 5000);

    return () => {
      window.removeEventListener(WHATSAPP_CONNECTION_CHANGED, onConnectionChanged);
      window.removeEventListener("focus", refresh);
      window.clearInterval(interval);
    };
  }, [refresh]);

  return {
    connection,
    connected: connection.status === "connected",
    loading,
    generatingQr,
    disconnecting,
    refresh,
    generateQr,
    disconnect,
  };
}
