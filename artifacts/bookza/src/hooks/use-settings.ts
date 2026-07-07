import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ensureBusiness,
  fetchBusinessSettings,
  saveBusinessSettings,
} from "@/lib/settings";
import type { BusinessSettings } from "@/types/settings";

export function useSettings() {
  const [settings, setSettings] = useState<BusinessSettings | null>(null);
  const [savedSettings, setSavedSettings] = useState<BusinessSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const businessId = await ensureBusiness();
      const data = await fetchBusinessSettings(businessId);
      setSettings(data);
      setSavedSettings(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = useCallback(async () => {
    if (!settings) return;
    setSaving(true);
    setError(null);
    try {
      await saveBusinessSettings(settings);
      setSavedSettings(settings);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save settings";
      setError(message);
      throw err;
    } finally {
      setSaving(false);
    }
  }, [settings]);

  const updateSettings = useCallback((
    updater: (prev: BusinessSettings) => BusinessSettings,
    options?: { markClean?: boolean },
  ) => {
    setSettings((prev) => {
      if (!prev) return prev;
      const next = updater(prev);
      if (options?.markClean) {
        setSavedSettings(next);
      }
      return next;
    });
  }, []);

  const hasUnsavedChanges = useMemo(() => {
    if (!settings || !savedSettings) return false;
    return JSON.stringify(settings) !== JSON.stringify(savedSettings);
  }, [settings, savedSettings]);

  return {
    settings,
    setSettings,
    updateSettings,
    loading,
    saving,
    hasUnsavedChanges,
    error,
    reload: load,
    save,
  };
}
