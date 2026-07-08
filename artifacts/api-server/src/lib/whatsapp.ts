    import { randomUUID } from "node:crypto";
    import { execFile } from "node:child_process";
    import { existsSync, watch, readdirSync, type Dirent } from "node:fs";
    import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
    import path from "node:path";
    import { fileURLToPath } from "node:url";
    import { promisify } from "node:util";
    import { gzip, gunzip } from "node:zlib";
    import QRCode from "qrcode";
    import { Client, LocalAuth, type Message, MessageMedia } from "whatsapp-web.js";
    import { getSupabaseAdmin, isSupabaseAdminConfigured } from "./supabase";
    import { recordActivity } from "./activity";
    import {
      buildBookingAiContext,
      executeAssistantAction,
      fetchBotSettingsForBusiness,
      findClientByPhoneForBusiness,
      currentBusinessTime,
      getConfirmationReply,
      getDecisionAndReply,
      getGroqChatHistory,
      clearOutOfHoursReply,
      hasRecentlyReceivedClosedReply,
      isWithinWorkingHours,
      nextOpeningTime,
      normalizePhoneLikeValue,
      recordOutOfHoursReply,
      saveWhatsappAiDraft,
      shouldReplyToPhone,
    } from "./whatsapp-ai";
import { waitForSafeOutboundSend } from "./whatsapp-send-safety";

    export type WhatsappSessionStatus = "qrcode" | "connected" | "disconnected";

    export type TenantRow = {
      id: string;
      owner_user_id: string;
      name: string;
    };

    export type WhatsappSessionRow = {
      id: string;
      tenant_id: string;
      instance_id: string;
      instance_token: string;
      status: WhatsappSessionStatus;
      qr_code: string | null;
      connected_phone: string | null;
      updated_at: string;
    };

    export type WhatsappConversationSummary = {
      id: number;
      remoteJid: string;
      clientName: string;
      clientPhone: string;
      lastMessage: string;
      lastMessageAt: string;
      unreadCount: number;
      isBot: boolean;
      avatarUrl: string | null;
    };

    export type WhatsappConversationMessage = {
      id: number;
      messageId: string | null;
      conversationId: number;
      remoteJid: string;
      content: string;
      direction: "inbound" | "outbound";
      timestamp: string;
      status: "sent" | "delivered" | "read" | "failed";
      isBot: boolean;
    };

    type StoredInboundMessageRow = {
      id: string;
      message_id: string | null;
      remote_jid: string;
      text_body: string;
      received_at: string;
    };

    type SessionRuntime = {
      client: Client | null;
      startingPromise: Promise<WhatsappSessionRow> | null;
      restartPromise: Promise<void> | null;
      qrCode: string | null;
      status: WhatsappSessionStatus;
      connectedPhone: string | null;
      healthCheckTimer: NodeJS.Timeout | null;
      sessionBackupTimer: NodeJS.Timeout | null;
      healthCheckFailures: number;
    };

    type WhatsappSessionArchiveEntry =
      | {
          type: "dir";
          path: string;
        }
      | {
          type: "file";
          path: string;
          data: string;
        };

    type WhatsappSessionArchive = {
      version: 1;
      createdAt: string;
      entries: WhatsappSessionArchiveEntry[];
    };

    type WhatsappSessionDataRow = {
      session_archive: string;
    };

    const currentFile = fileURLToPath(import.meta.url);
    const currentDir = path.dirname(currentFile);
    const projectDir = path.resolve(currentDir, "..", "..");
    const execFileAsync = promisify(execFile);
    const gzipAsync = promisify(gzip);
    const gunzipAsync = promisify(gunzip);
    const configuredSessionsRoot = process.env["WHATSAPP_SESSION_DIR"]?.trim();

    function resolveSessionsRoot(root: string): string {
      if (path.isAbsolute(root)) {
        return path.resolve(root);
      }

      if (process.env["RAILWAY_ENVIRONMENT"] || process.env["RAILWAY_SERVICE_ID"]) {
        return path.resolve("/app", root);
      }

      return path.resolve(projectDir, root);
    }

    const sessionsRoot = configuredSessionsRoot
      ? resolveSessionsRoot(configuredSessionsRoot)
      : process.env["RAILWAY_ENVIRONMENT"] || process.env["RAILWAY_SERVICE_ID"]
        ? "/app/.sessions/whatsapp"
        : path.resolve(projectDir, ".sessions", "whatsapp");

    const runtimeByTenantId = new Map<string, SessionRuntime>();
    const qrWaiters = new Map<string, Array<(session: WhatsappSessionRow) => void>>();
    const sessionArchiveVersion = 1;
    const sessionArchiveBackupIntervalMs = 5 * 60 * 1000;
    const sessionArchiveSkipNames = new Set([
      "DevToolsActivePort",
      "SingletonCookie",
      "SingletonLock",
      "SingletonSocket",
      "lockfile",
    ]);

    function parseJsonValue(value: unknown): unknown {
      if (typeof value !== "string") return value;

      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }

    function coerceNumber(value: unknown): number | null {
      if (typeof value === "number" && Number.isFinite(value)) {
        return value;
      }

      if (typeof value === "string" && value.trim() !== "") {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }

      return null;
    }

    function extractMonthlyBookingLimit(subscription: Record<string, any> | null | undefined): number {
      const candidateSources = [
        subscription?.metadata,
        subscription?.plans?.metadata,
        subscription?.metadata?.custom_config,
        subscription?.plans?.metadata?.custom_config,
        subscription?.metadata?.customPlan,
        subscription?.plans?.metadata?.customPlan,
      ];

      const pathCandidates = [
        ["custom_config", "bookingsPerMonth"],
        ["custom_config", "bookings"],
        ["customPlan", "bookingsPerMonth"],
        ["customPlan", "bookings"],
        ["bookingsPerMonth"],
        ["bookings"],
        ["monthlyLimit"],
        ["monthly_limit"],
      ];

      for (const source of candidateSources) {
        const parsedSource = parseJsonValue(source);

        for (const path of pathCandidates) {
          let current: unknown = parsedSource;
          let matched = true;

          for (const segment of path) {
            if (!current || typeof current !== "object") {
              matched = false;
              break;
            }
            current = (current as Record<string, unknown>)[segment];
          }

          if (matched) {
            const limit = coerceNumber(current);
            if (limit !== null) {
              return limit;
            }
          }
        }
      }

      return 100;
    }

    function resolveBrowserExecutablePath(): string | undefined {
      const configuredPath =
        process.env["WHATSAPP_BROWSER_PATH"]?.trim() ||
        process.env["PUPPETEER_EXECUTABLE_PATH"]?.trim();

      if (configuredPath) {
        if (existsSync(configuredPath)) {
          return configuredPath;
        }

        console.warn("[WhatsApp] Configured browser path does not exist:", configuredPath);
      }

      // Use Puppeteer's bundled Chromium when no explicit browser path is configured.
      return undefined;
    }

    function getBrowserLaunchEnv(): NodeJS.ProcessEnv {
      const env: NodeJS.ProcessEnv = {
        PATH: process.env.PATH,
        HOME: process.env.HOME || "/tmp",
        TMPDIR: "/tmp",
        TMP: "/tmp",
        TEMP: "/tmp",
        NODE_ENV: process.env.NODE_ENV,
        DISPLAY: process.env.DISPLAY || "",
        WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY || "",
        XAUTHORITY: process.env.XAUTHORITY || "",
        DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS || "",
        DBUS_SYSTEM_BUS_ADDRESS: process.env.DBUS_SYSTEM_BUS_ADDRESS || "",
        XDG_CACHE_HOME: path.resolve(sessionsRoot, ".chromium-cache"),
        XDG_CONFIG_HOME: path.resolve(sessionsRoot, ".chromium-config"),
        XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR || "/tmp",
        NO_AT_BRIDGE: "1",
      };

      if (!env.PATH) {
        delete env.PATH;
      }
      if (!env.NODE_ENV) {
        delete env.NODE_ENV;
      }

      return env;
    }

    function escapePowerShellSingleQuoted(value: string): string {
      return value.replace(/'/g, "''");
    }

    function isWhatsappLockFileName(name: string): boolean {
      const lockNames = new Set([
        "lockfile",
        "SingletonLock",
        "SingletonCookie",
        "SingletonSocket",
        "LOCK", // Chrome/Chromium lock file variants
      ]);
      return lockNames.has(name) || name.startsWith("Singleton");
    }

    async function removeLockFilesRecursively(dir: string): Promise<void> {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const entryPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await removeLockFilesRecursively(entryPath);
          continue;
        }

        if (isWhatsappLockFileName(entry.name)) {
          try {
            await rm(entryPath, { force: true });
            console.log("[WhatsApp] Removed stale lock file:", entryPath);
          } catch (err) {
            console.log("[WhatsApp] Failed to remove lock file:", entryPath, err);
          }
        }
      }
    }

    async function cleanupStaleWhatsappBrowserSession(tenantId: string): Promise<void> {
      const sessionDir = path.resolve(sessionsRoot, `session-${tenantId}`);

      // Clean up Chromium lock files on persistent volume
      if (existsSync(sessionDir)) {
        try {
          await removeLockFilesRecursively(sessionDir);
        } catch (err) {
          console.log("[WhatsApp] Error cleaning lock files recursively:", err);
        }
      }

      if (process.platform === "win32") {
        const escapedSessionDir = escapePowerShellSingleQuoted(sessionDir);
        const command = [
          `$sessionDir = '${escapedSessionDir}'`,
          "$browserProcesses = Get-CimInstance Win32_Process | Where-Object {",
          "  $_.CommandLine -and",
          "  $_.CommandLine -like '*--user-data-dir*' -and",
          "  $_.CommandLine -like \"*$sessionDir*\"",
          "}",
          "foreach ($process in $browserProcesses) {",
          "  try { Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop } catch {}",
          "}",
        ].join("; ");

        try {
          await execFileAsync("powershell", ["-NoProfile", "-Command", command]);
        } catch {
          // Best effort cleanup only. If nothing is found or PowerShell errors, continue.
        }
      } else {
        // Linux cleanup for Railway
        try {
          await execFileAsync("pkill", ["-f", `--user-data-dir=${sessionDir}`]);
          console.log("[WhatsApp] Killed stale browser processes for session:", tenantId);
        } catch (err) {
          console.log("[WhatsApp] No stale browser processes to clean up for session:", tenantId);
        }
      }
    }

    function getRuntime(tenantId: string): SessionRuntime {
      const existing = runtimeByTenantId.get(tenantId);
      if (existing) return existing;

      const created: SessionRuntime = {
        client: null,
        startingPromise: null,
        restartPromise: null,
        qrCode: null,
        status: "disconnected",
        connectedPhone: null,
        healthCheckTimer: null,
        sessionBackupTimer: null,
        healthCheckFailures: 0,
      };
      runtimeByTenantId.set(tenantId, created);
      return created;
    }

    function stopTenantHealthCheck(tenantId: string): void {
      const runtime = getRuntime(tenantId);
      if (runtime.healthCheckTimer) {
        clearInterval(runtime.healthCheckTimer);
        runtime.healthCheckTimer = null;
      }
      runtime.healthCheckFailures = 0;
    }

    function stopTenantSessionBackup(tenantId: string): void {
      const runtime = getRuntime(tenantId);
      if (runtime.sessionBackupTimer) {
        clearInterval(runtime.sessionBackupTimer);
        runtime.sessionBackupTimer = null;
      }
    }

    function startTenantSessionBackup(tenantId: string): void {
      const runtime = getRuntime(tenantId);
      if (runtime.sessionBackupTimer) return;

      runtime.sessionBackupTimer = setInterval(() => {
        void (async () => {
          const current = getRuntime(tenantId);
          if (current.status !== "connected" || !current.client) {
            stopTenantSessionBackup(tenantId);
            return;
          }

          await backupSessionToSupabase(tenantId);
        })().catch((error) => {
          console.error("[WhatsApp Session] Periodic backup failed:", error);
        });
      }, sessionArchiveBackupIntervalMs);

      runtime.sessionBackupTimer.unref?.();
    }

    function startTenantHealthCheck(tenantId: string): void {
      const runtime = getRuntime(tenantId);
      if (runtime.healthCheckTimer) return;

      runtime.healthCheckTimer = setInterval(() => {
        void (async () => {
          const current = getRuntime(tenantId);
          if (current.status !== "connected" || !current.client) {
            stopTenantHealthCheck(tenantId);
            stopTenantSessionBackup(tenantId);
            return;
          }

          if (current.client.info) {
            current.healthCheckFailures = 0;
            return;
          }

          current.healthCheckFailures += 1;
          console.warn("[WhatsApp] Health check failed", {
            tenantId,
            failures: current.healthCheckFailures,
          });

          if (current.healthCheckFailures < 2) return;

          stopTenantHealthCheck(tenantId);
          stopTenantSessionBackup(tenantId);
          try {
            await current.client.destroy();
          } catch {
            // Best effort. A crashed Chromium process may already be gone.
          }

          current.client = null;
          current.status = "disconnected";
          current.connectedPhone = null;

          const session = await getWhatsappSessionByTenantId(tenantId);
          if (session?.status === "connected") {
            console.log("[WhatsApp] Restarting unhealthy connected session:", tenantId);
            void startTenantSocket(tenantId).catch((error) => {
              console.error("[WhatsApp] Failed to restart unhealthy session:", error);
            });
          }
        })().catch((error) => {
          console.error("[WhatsApp] Health check crashed:", error);
        });
      }, 30000);

      runtime.healthCheckTimer.unref?.();
    }

    function notifyQrWaiters(tenantId: string, session: WhatsappSessionRow) {
      const waiters = qrWaiters.get(tenantId);
      if (!waiters?.length) return;
      console.log("[WhatsApp] Notifying QR waiters for tenant:", tenantId, { waiterCount: waiters.length, status: session.status });
      qrWaiters.delete(tenantId);
      waiters.forEach((resolve) => resolve(session));
    }

    async function ensureSessionsRoot(): Promise<void> {
      await mkdir(sessionsRoot, { recursive: true });
    }

    function getSessionDir(tenantId: string): string {
      return path.resolve(sessionsRoot, `session-${tenantId}`);
    }

    const sessionDirWatchers = new Map<string, ReturnType<typeof watch>>();

    function logSessionDirSnapshot(tenantId: string, sessionDir: string): void {
      try {
        const files: string[] = [];
        const walk = (dir: string) => {
          for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const entryPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              walk(entryPath);
            } else {
              files.push(path.relative(sessionDir, entryPath));
            }
          }
        };
        walk(sessionDir);
        console.log(`[WhatsApp] LocalAuth dir snapshot for tenant ${tenantId}:`, files);
      } catch (error) {
        console.warn(`[WhatsApp] Could not snapshot LocalAuth dir for tenant ${tenantId}:`, error);
      }
    }

    function watchSessionDir(tenantId: string, sessionDir: string): void {
      if (sessionDirWatchers.has(tenantId)) return;
      try {
        const watcher = watch(sessionDir, { recursive: true }, (eventType, filename) => {
          console.log("[WhatsApp] LocalAuth FS event for tenant:", tenantId, { eventType, filename });
        });
        sessionDirWatchers.set(tenantId, watcher);
        console.log("[WhatsApp] Started watching LocalAuth directory for tenant:", tenantId, sessionDir);
      } catch (error) {
        console.warn("[WhatsApp] Failed to watch LocalAuth directory for tenant:", tenantId, sessionDir, error);
      }
    }

    function stopWatchingSessionDir(tenantId: string): void {
      const watcher = sessionDirWatchers.get(tenantId);
      if (!watcher) return;
      watcher.close();
      sessionDirWatchers.delete(tenantId);
      console.log("[WhatsApp] Stopped watching LocalAuth directory for tenant:", tenantId);
    }

    function dumpClientDebugInfo(client: Client, tenantId: string): void {
      const anyClient = client as any;
      console.log("[WhatsApp] Client debug info for tenant:", tenantId, {
        constructorName: client.constructor?.name,
        info: client.info ? client.info : null,
        authStrategyType: anyClient.authStrategy?.constructor?.name ?? null,
        authStrategyKeys: anyClient.authStrategy ? Object.keys(anyClient.authStrategy) : null,
        authClientId: anyClient.authStrategy?.clientId ?? null,
        authDataPath: anyClient.authStrategy?.dataPath ?? null,
        clientKeys: Object.keys(anyClient),
      });
    }

    function attachPuppeteerDiagnostics(client: Client, tenantId: string): void {
      const anyClient = client as any;
      const browser = anyClient.pupBrowser ?? anyClient.browser ?? anyClient.page?.browser?.();
      if (!browser) {
        console.warn("[WhatsApp] No Puppeteer browser object found for tenant:", tenantId);
      } else {
        browser.on("disconnected", () => {
          console.warn("[WhatsApp Browser] browser disconnected event for tenant:", tenantId);
        });
        browser.on("targetcreated", (target: unknown) => {
          console.log("[WhatsApp Browser] targetcreated for tenant:", tenantId, { target: (target as any)?.url?.() ?? null, type: (target as any)?.type?.() ?? null });
        });
        browser.on("targetdestroyed", (target: unknown) => {
          console.log("[WhatsApp Browser] targetdestroyed for tenant:", tenantId, { target: (target as any)?.url?.() ?? null, type: (target as any)?.type?.() ?? null });
        });
        browser.on("close", () => {
          console.warn("[WhatsApp Browser] browser close for tenant:", tenantId);
        });
      }

      const page = anyClient.pupPage ?? anyClient.page;
      if (page?.on) {
        page.on("close", () => {
          console.warn("[WhatsApp Browser] page close for tenant:", tenantId);
        });
      }
    }

    function isSkippableSessionArchiveName(name: string): boolean {
      return sessionArchiveSkipNames.has(name) || name.startsWith("Singleton");
    }

    function toSessionArchivePath(rootDir: string, absolutePath: string): string {
      return path.relative(rootDir, absolutePath).split(path.sep).join("/");
    }

    function resolveSessionArchivePath(rootDir: string, archivePath: string): string | null {
      if (!archivePath || archivePath.includes("\0")) return null;

      const normalized = path.normalize(archivePath);
      if (path.isAbsolute(normalized) || normalized === ".." || normalized.startsWith(`..${path.sep}`)) {
        return null;
      }

      const resolvedRoot = path.resolve(rootDir);
      const resolvedPath = path.resolve(resolvedRoot, normalized);
      const rootWithSeparator = resolvedRoot.endsWith(path.sep) ? resolvedRoot : `${resolvedRoot}${path.sep}`;

      if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(rootWithSeparator)) {
        return null;
      }

      return resolvedPath;
    }

    async function collectSessionArchiveEntries(
      rootDir: string,
      currentDir: string,
    ): Promise<WhatsappSessionArchiveEntry[]> {
      let dirents: Dirent[];

      try {
        dirents = await readdir(currentDir, { withFileTypes: true });
      } catch (error) {
        console.warn("[WhatsApp Session] Could not read session directory for backup:", currentDir, error);
        return [];
      }

      const entries: WhatsappSessionArchiveEntry[] = [];

      for (const dirent of dirents) {
        if (isSkippableSessionArchiveName(dirent.name)) continue;

        const absolutePath = path.join(currentDir, dirent.name);
        const archivePath = toSessionArchivePath(rootDir, absolutePath);

        if (dirent.isDirectory()) {
          entries.push({ type: "dir", path: archivePath });
          entries.push(...await collectSessionArchiveEntries(rootDir, absolutePath));
          continue;
        }

        if (!dirent.isFile()) continue;

        try {
          const fileBuffer = await readFile(absolutePath);
          entries.push({
            type: "file",
            path: archivePath,
            data: fileBuffer.toString("base64"),
          });
        } catch (error) {
          console.warn("[WhatsApp Session] Skipping unreadable session file:", archivePath, error);
        }
      }

      return entries;
    }

    function isWhatsappSessionArchiveEntry(value: unknown): value is WhatsappSessionArchiveEntry {
      if (!value || typeof value !== "object") return false;

      const entry = value as Record<string, unknown>;
      if (entry.type === "dir") {
        return typeof entry.path === "string";
      }

      if (entry.type === "file") {
        return typeof entry.path === "string" && typeof entry.data === "string";
      }

      return false;
    }

    function parseWhatsappSessionArchive(rawArchive: Buffer): WhatsappSessionArchive {
      const parsed = JSON.parse(rawArchive.toString("utf8")) as unknown;
      if (!parsed || typeof parsed !== "object") {
        throw new Error("Session archive is not an object");
      }

      const archive = parsed as Record<string, unknown>;
      if (archive.version !== sessionArchiveVersion || !Array.isArray(archive.entries)) {
        throw new Error("Unsupported WhatsApp session archive format");
      }

      const entries = archive.entries;
      if (!entries.every(isWhatsappSessionArchiveEntry)) {
        throw new Error("WhatsApp session archive contains invalid entries");
      }

      return {
        version: sessionArchiveVersion,
        createdAt: typeof archive.createdAt === "string" ? archive.createdAt : new Date().toISOString(),
        entries,
      };
    }

    async function backupSessionToSupabase(tenantId: string): Promise<void> {
      const sessionDir = getSessionDir(tenantId);
      if (!existsSync(sessionDir)) return;

      try {
        const entries = await collectSessionArchiveEntries(sessionDir, sessionDir);
        const fileCount = entries.filter((entry) => entry.type === "file").length;

        if (fileCount === 0) {
          console.warn("[WhatsApp Session] Session backup skipped because no files were found:", tenantId);
          return;
        }

        const archive: WhatsappSessionArchive = {
          version: sessionArchiveVersion,
          createdAt: new Date().toISOString(),
          entries,
        };
        const compressedArchive = await gzipAsync(Buffer.from(JSON.stringify(archive), "utf8"));
        const nowIso = new Date().toISOString();

        const { error } = await getSupabaseAdmin()
          .from("whatsapp_session_data")
          .upsert(
            {
              tenant_id: tenantId,
              session_archive: compressedArchive.toString("base64"),
              saved_at: nowIso,
              updated_at: nowIso,
            },
            { onConflict: "tenant_id" },
          );

        if (error) {
          console.warn("[WhatsApp Session] Could not save session archive to Supabase:", error.message);
          return;
        }

        console.log("[WhatsApp Session] Session archive saved to Supabase:", { tenantId, fileCount });
      } catch (error) {
        console.warn("[WhatsApp Session] Session backup failed:", error);
      }
    }

    async function restoreSessionFromSupabase(tenantId: string): Promise<boolean> {
      try {
        const { data, error } = await getSupabaseAdmin()
          .from("whatsapp_session_data")
          .select("session_archive")
          .eq("tenant_id", tenantId)
          .maybeSingle<WhatsappSessionDataRow>();

        if (error) {
          console.warn("[WhatsApp Session] Could not load session archive from Supabase:", error.message);
          return false;
        }

        if (!data?.session_archive) return false;

        const compressedArchive = Buffer.from(data.session_archive, "base64");
        const archive = parseWhatsappSessionArchive(await gunzipAsync(compressedArchive));
        const sessionDir = getSessionDir(tenantId);
        const restoreDir = path.resolve(sessionsRoot, `.restore-${tenantId}-${process.pid}-${Date.now()}`);

        await rm(restoreDir, { recursive: true, force: true });
        await mkdir(restoreDir, { recursive: true });

        try {
          for (const entry of archive.entries) {
            if (entry.type !== "dir") continue;

            const targetPath = resolveSessionArchivePath(restoreDir, entry.path);
            if (!targetPath) {
              throw new Error(`Unsafe directory path in WhatsApp session archive: ${entry.path}`);
            }

            await mkdir(targetPath, { recursive: true });
          }

          for (const entry of archive.entries) {
            if (entry.type !== "file") continue;

            const targetPath = resolveSessionArchivePath(restoreDir, entry.path);
            if (!targetPath) {
              throw new Error(`Unsafe file path in WhatsApp session archive: ${entry.path}`);
            }

            await mkdir(path.dirname(targetPath), { recursive: true });
            await writeFile(targetPath, Buffer.from(entry.data, "base64"));
          }

          await rm(sessionDir, { recursive: true, force: true });
          await rename(restoreDir, sessionDir);
        } catch (error) {
          await rm(restoreDir, { recursive: true, force: true });
          throw error;
        }

        const fileCount = archive.entries.filter((entry) => entry.type === "file").length;
        console.log("[WhatsApp Session] Session archive restored from Supabase:", { tenantId, fileCount });
        return true;
      } catch (error) {
        console.warn("[WhatsApp Session] Session restore failed; falling back to QR flow:", error);
        return false;
      }
    }

    async function deleteSessionArchiveFromSupabase(tenantId: string): Promise<void> {
      try {
        const { error } = await getSupabaseAdmin()
          .from("whatsapp_session_data")
          .delete()
          .eq("tenant_id", tenantId);

        if (error) {
          console.warn("[WhatsApp Session] Could not delete session archive from Supabase:", error.message);
        }
      } catch (error) {
        console.warn("[WhatsApp Session] Session archive delete failed:", error);
      }
    }

    async function persistSessionState(
      sessionId: string,
      patch: Partial<{
        status: WhatsappSessionStatus;
        qr_code: string | null;
        connected_phone: string | null;
        last_seen_at: string;
      }>,
    ): Promise<void> {
      const { error } = await getSupabaseAdmin()
        .from("whatsapp_sessions")
        .update(patch)
        .eq("id", sessionId);

      if (error) {
        throw new Error(error.message);
      }
    }

    export async function ensureTenantForUser(userId: string, fallbackName: string): Promise<TenantRow> {
      const { data: existing, error: existingError } = await getSupabaseAdmin()
        .from("tenants")
        .select("*")
        .eq("owner_user_id", userId)
        .maybeSingle<TenantRow>();

      if (existingError) throw new Error(existingError.message);
      if (existing) return existing;

      const { data: inserted, error: insertError } = await getSupabaseAdmin()
        .from("tenants")
        .insert({
          owner_user_id: userId,
          name: fallbackName,
        })
        .select("*")
        .single<TenantRow>();

      if (insertError || !inserted) {
        throw new Error(insertError?.message ?? "Could not create tenant");
      }

      return inserted;
    }

    export async function getWhatsappSessionByTenantId(tenantId: string): Promise<WhatsappSessionRow | null> {
      const { data, error } = await getSupabaseAdmin()
        .from("whatsapp_sessions")
        .select("*")
        .eq("tenant_id", tenantId)
        .maybeSingle<WhatsappSessionRow>();

      if (error) throw new Error(error.message);
      return data ?? null;
    }

    export async function createOrLoadWhatsappSession(tenantId: string): Promise<WhatsappSessionRow> {
      const existing = await getWhatsappSessionByTenantId(tenantId);
      if (existing) return existing;

      const { data, error } = await getSupabaseAdmin()
        .from("whatsapp_sessions")
        .insert({
          tenant_id: tenantId,
          instance_id: `tenant-${tenantId}`,
          instance_token: randomUUID(),
          status: "disconnected",
        })
        .select("*")
        .single<WhatsappSessionRow>();

      if (error || !data) {
        throw new Error(error?.message ?? "Could not create WhatsApp session");
      }

      return data;
    }

    export async function resetWhatsappSession(tenantId: string): Promise<void> {
      const runtime = getRuntime(tenantId);
      const session = await getWhatsappSessionByTenantId(tenantId);

      if (runtime.client) {
        try {
          await runtime.client.destroy();
        } catch {
          // Best effort only. We still clear persisted auth state below.
        }
      }

      stopWatchingSessionDir(tenantId);
      runtime.client = null;
      runtime.startingPromise = null;
      runtime.qrCode = null;
      runtime.status = "disconnected";
      runtime.connectedPhone = null;
      stopTenantHealthCheck(tenantId);
      stopTenantSessionBackup(tenantId);
      qrWaiters.delete(tenantId);

      await cleanupStaleWhatsappBrowserSession(tenantId);
      await rm(getSessionDir(tenantId), { recursive: true, force: true });
      await deleteSessionArchiveFromSupabase(tenantId);

      if (session) {
        await persistSessionState(session.id, {
          status: "disconnected",
          qr_code: null,
          connected_phone: null,
          last_seen_at: new Date().toISOString(),
        });
      }
    }

    export function formatWhatsappStatusResponse(session: Partial<WhatsappSessionRow> | null | undefined) {
      return {
        status: session?.status ?? "disconnected",
        instanceId: session?.instance_id ?? null,
        qrCode: session?.qr_code ?? null,
        connectedPhone: session?.connected_phone ?? null,
        updatedAt: session?.updated_at ?? null,
      };
    }

    async function storeInboundMessage(session: WhatsappSessionRow, message: Message): Promise<void> {
      const textBody = message.body ?? "";

      const { error } = await getSupabaseAdmin().from("inbound_messages").insert({
        tenant_id: session.tenant_id,
        whatsapp_session_id: session.id,
        instance_id: session.instance_id,
        message_id: message.id.id ?? null,
        remote_jid: message.from,
        sender_name: (message as { _data?: { notifyName?: string } })._data?.notifyName ?? null,
        message_type: "text",
        text_body: textBody,
        payload: message.rawData ?? message,
      });

      if (error && error.code !== "23505") {
        throw new Error(error.message);
      }
    }

    function getConnectedPhone(client: Client | null): string | null {
      const info = client?.info as { wid?: { user?: string } } | undefined;
      return info?.wid?.user ?? null;
    }

    function normalizeRemoteJid(value: string | null | undefined): string {
      return (value ?? "").trim().toLowerCase();
    }

    async function hasRecentInboundConversation(tenantId: string, phoneOrJid: string): Promise<boolean> {
      const digits = normalizePhoneLikeValue(phoneOrJid);
      if (!digits) {
        return true;
      }

      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await getSupabaseAdmin()
        .from("inbound_messages")
        .select("remote_jid")
        .eq("tenant_id", tenantId)
        .gte("received_at", since)
        .limit(500);

      if (error) {
        console.warn("[WhatsApp] Could not check recent inbound conversations:", error.message);
        return false;
      }

      const haystacks = (data ?? []).map((row) => normalizeRemoteJid((row as { remote_jid?: string | null }).remote_jid));
      const patterns = [digits, digits.slice(-10), digits.slice(-12)].filter(Boolean);

      const found = haystacks.some((haystack) => patterns.some((pattern) => haystack.includes(pattern)));
      if (!found) {
        console.warn(
          "[WhatsApp] WARNING: Outbound to new contact detected. This violates WhatsApp TOS and risks account suspension. " +
          "Use WhatsApp Cloud API for business outreach; whatsapp-web.js only supports replying to inbound messages.",
          { phoneOrJid, digits },
        );
      }
      return found;
    }

    const currentlyProcessing = new Set<string>();

    async function getBusinessIdForTenant(tenantId: string): Promise<string | null> {
      const { data, error } = await getSupabaseAdmin()
        .from("tenants")
        .select("owner_user_id")
        .eq("id", tenantId)
        .maybeSingle();

      if (error || !data?.owner_user_id) {
        console.error("[WhatsApp Business Lookup] Failed to get tenant owner:", error);
        return null;
      }

      const { data: bizData, error: bizError } = await getSupabaseAdmin()
        .from("businesses")
        .select("id, user_id")
        .eq("user_id", data.owner_user_id)
        .maybeSingle();

      if (bizError || !bizData?.id) {
        console.error("[WhatsApp Business Lookup] Failed to get business for owner:", bizError);
        return null;
      }

      return bizData.id;
    }

    async function getSubscriptionForBusiness(businessId: string, ownerUserId?: string | null) {
      const businessIds = [businessId].filter(Boolean);

      const { data: businessRows, error: businessError } = await getSupabaseAdmin()
        .from("businesses")
        .select("id")
        .eq("user_id", ownerUserId)
        .limit(10);

      if (!businessError) {
        for (const row of businessRows ?? []) {
          if (row?.id && !businessIds.includes(row.id)) {
            businessIds.push(row.id);
          }
        }
      }

      let query = getSupabaseAdmin()
        .from("subscriptions")
        .select("id, status, metadata, plan_id, current_period_start, current_period_end, created_at")
        .order("created_at", { ascending: false })
        .limit(10);

      if (businessIds.length > 0) {
        query = query.in("business_id", businessIds);
      }

      if (ownerUserId) {
        query = query.or(`user_id.eq.${ownerUserId}`);
      }

      const { data: subscriptionRows, error: subscriptionError } = await query;

      if (subscriptionError) {
        console.error("[WhatsApp Subscription Lookup] Failed to fetch subscriptions:", subscriptionError);
        return null;
      }

      for (const row of subscriptionRows ?? []) {
        if (!row) continue;
        const rowLimit = extractMonthlyBookingLimit(row as Record<string, any>);
        const hasLimitMetadata = Boolean(
          (row as Record<string, any>).metadata ||
          rowLimit !== 100,
        );

        if (hasLimitMetadata) {
          return row as Record<string, any>;
        }
      }

      return subscriptionRows?.[0] as Record<string, any> | null;
    }

    /**
    * Resolve the real phone number (digits only, international form) behind an inbound
    * message.
    *
    * On LID-based WhatsApp accounts `message.from` is "<lid>@lid" and `contact.number`
    * is ALSO the LID — neither is a phone number. whatsapp-web.js rewrites `contact.id`
    * to the real "<phone>@c.us" WID whenever the phone is known, so `contact.id` is the
    * only reliable source. Returns "" when the phone cannot be recovered (e.g. a
    * privacy-hidden unknown contact); callers must NOT fall back to storing the LID.
    */
    async function resolveInboundPhoneNumber(message: Message): Promise<string> {
      try {
        const contact = await message.getContact();
        const id = (contact as { id?: { user?: string; _serialized?: string } }).id;
        const serialized = normalizeRemoteJid(id?._serialized);
        if (serialized.endsWith("@c.us")) {
          const digits = normalizePhoneLikeValue(id?.user ?? "");
          if (digits) return digits;
        }
      } catch (err) {
        console.warn("[WhatsApp resolveInboundPhoneNumber] getContact failed:", err);
      }
      return "";
    }

    /** Extract the bare LID from a "<lid>@lid" JID, or null for non-LID JIDs. */
    function extractLidFromJid(jid: string | null | undefined): string | null {
      const normalized = normalizeRemoteJid(jid);
      if (!normalized.endsWith("@lid")) return null;
      const user = normalized.split("@")[0] ?? "";
      return user || null;
    }

    async function createClientFromWhatsApp(
      businessId: string,
      phone: string,
      name: string,
      lid: string | null = null,
    ): Promise<void> {
      const normalizedPhone = normalizePhoneLikeValue(phone);
      const cleanLid = lid?.trim() || null;
      if (!normalizedPhone || !isSupabaseAdminConfigured()) return;

      const existingClient = await findClientByPhoneForBusiness(businessId, normalizedPhone);
      if (existingClient) {
        const updatePayload: Record<string, unknown> = { status: "active" };
        if (cleanLid) {
          updatePayload.lid = cleanLid;
        }
        await getSupabaseAdmin()
          .from("clients")
          .update(updatePayload)
          .eq("id", existingClient.id);
        return;
      }

      const { error: insertError } = await getSupabaseAdmin()
        .from("clients")
        .insert({
          business_id: businessId,
          name: name?.trim() || "Unknown",
          phone: normalizedPhone,
          lid: cleanLid,
          email: null,
          client_type: "new",
          status: "active",
          no_show_count: 0,
          avatar_url: null,
          notes: null,
        });

      // 23505 = unique violation: a concurrent inbound created the same client first.
      // The unique index did its job; the existing row stands, so this is benign.
      if (insertError && insertError.code !== "23505") {
        console.log("[WhatsApp Auto-Add] Failed to create client:", insertError.message);
      } else if (!insertError) {
        console.log("[WhatsApp Auto-Add] Client created:", name, normalizedPhone);
      }
    }

    function shouldIncludeConversationRemoteJid(remoteJid: string): boolean {
      const normalized = normalizeRemoteJid(remoteJid);
      if (!normalized) return false;
      if (normalized === "status@broadcast") return false;
      if (normalized.endsWith("@broadcast")) return false;
      return true;
    }

    export function getConversationIdFromRemoteJid(remoteJid: string): number {
      const digits = normalizePhoneLikeValue(remoteJid);
      if (digits) {
        return Number(digits.slice(-12));
      }

      let hash = 0;
      for (const char of remoteJid) {
        hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
      }

      return hash || 1;
    }

    function getChatRemoteJid(chat: unknown): string {
      const id = (chat as { id?: { _serialized?: string } })?.id?._serialized;
      return normalizeRemoteJid(id);
    }

    function getMessageRemoteJid(message: unknown): string {
      const typed = message as { fromMe?: boolean; from?: string; to?: string };
      return normalizeRemoteJid(typed.fromMe ? typed.to : typed.from);
    }

    function getMessageText(message: unknown): string {
      const typed = message as { body?: string; type?: string };
      const body = typed.body?.trim();
      if (body) return body;

      const type = typed.type?.trim();
      if (type) {
        return `${type.charAt(0).toUpperCase()}${type.slice(1)} message`;
      }

      return "Media message";
    }

    function getIsoTimestamp(value: unknown): string {
      if (typeof value === "string") {
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
      }

      if (typeof value === "number" && Number.isFinite(value)) {
        const ms = value > 1_000_000_000_000 ? value : value * 1000;
        return new Date(ms).toISOString();
      }

      if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value.toISOString();
      }

      return new Date().toISOString();
    }

    function getMessageTimestamp(message: unknown): string {
      const typed = message as { timestamp?: number | string | Date; rawData?: { t?: number | string } };
      return getIsoTimestamp(typed.timestamp ?? typed.rawData?.t);
    }

    function getWhatsappMessageStatus(message: unknown): "sent" | "delivered" | "read" | "failed" {
      const typed = message as { fromMe?: boolean; ack?: number };
      if (!typed.fromMe) return "delivered";

      switch (typed.ack) {
        case 3:
        case 4:
          return "read";
        case 2:
          return "delivered";
        case 0:
        case 1:
          return "sent";
        default:
          return "sent";
      }
    }

    function getChatDisplayName(chat: unknown): string {
      const typed = chat as {
        name?: string;
        formattedTitle?: string;
        contact?: { pushname?: string; name?: string; number?: string };
      };

      return (
        typed.name?.trim() ||
        typed.formattedTitle?.trim() ||
        typed.contact?.pushname?.trim() ||
        typed.contact?.name?.trim() ||
        typed.contact?.number?.trim() ||
        normalizePhoneLikeValue(getChatRemoteJid(chat)) ||
        "Unknown"
      );
    }

    function getChatPhone(chat: unknown): string {
      const typed = chat as { contact?: { number?: string } };
      return typed.contact?.number?.trim() || normalizePhoneLikeValue(getChatRemoteJid(chat));
    }

    function mapMessageToConversationMessage(
      message: unknown,
      index: number,
      conversationId: number,
      remoteJid: string,
    ): WhatsappConversationMessage {
      const typedMessage = message as { id?: { id?: string } };
      return {
        id: index + 1,
        messageId: typedMessage.id?.id ?? null,
        conversationId,
        remoteJid,
        content: getMessageText(message),
        direction: (message as { fromMe?: boolean }).fromMe ? "outbound" : "inbound",
        timestamp: getMessageTimestamp(message),
        status: getWhatsappMessageStatus(message),
        isBot: false,
      };
    }

    async function listStoredInboundMessages(
      tenantId: string,
      conversationId: number,
      remoteJid: string,
      limit: number,
    ): Promise<WhatsappConversationMessage[]> {
      const { data, error } = await getSupabaseAdmin()
        .from("inbound_messages")
        .select("id, message_id, remote_jid, text_body, received_at")
        .eq("tenant_id", tenantId)
        .eq("remote_jid", remoteJid)
        .order("received_at", { ascending: false })
        .limit(limit);

      if (error) {
        throw new Error(error.message);
      }

      return ((data ?? []) as StoredInboundMessageRow[])
        .reverse()
        .map((row, index) => ({
          id: index + 1,
          messageId: row.message_id ?? row.id,
          conversationId,
          remoteJid,
          content: row.text_body?.trim() || "Media message",
          direction: "inbound",
          timestamp: row.received_at,
          status: "delivered",
          isBot: false,
        }));
    }

    async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
      let timeout: NodeJS.Timeout | undefined;
      try {
        return await Promise.race([
          promise,
          new Promise<T>((_, reject) => {
            timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
          }),
        ]);
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    }

    async function getClientConnectionState(client: Client, timeoutMs = 5000): Promise<string | null> {
      try {
        const state = await withTimeout(client.getState(), timeoutMs, "getState timeout");
        return typeof state === "string" ? state : null;
      } catch (error) {
        console.warn("[WhatsApp] Could not read client state:", error);
        return null;
      }
    }

    async function isClientReady(client: Client | null, timeoutMs = 5000): Promise<boolean> {
      if (!client?.info) return false;
      const state = await getClientConnectionState(client, timeoutMs);
      return state === "CONNECTED";
    }

    function hasReadyClientShape(client: Client | null): client is Client {
      if (!client?.info) return false;
      const page = (client as unknown as { pupPage?: { isClosed?: () => boolean } }).pupPage;
      return !page?.isClosed?.();
    }

    async function markRuntimeDisconnected(tenantId: string): Promise<void> {
      const runtime = getRuntime(tenantId);
      runtime.status = "disconnected";
      runtime.qrCode = null;
      runtime.connectedPhone = null;
      stopTenantHealthCheck(tenantId);
      stopTenantSessionBackup(tenantId);

      const session = await getWhatsappSessionByTenantId(tenantId);
      if (!session || session.status === "disconnected") return;

      await persistSessionState(session.id, {
        status: "disconnected",
        qr_code: null,
        connected_phone: null,
        last_seen_at: new Date().toISOString(),
      });
    }

    async function restartUnhealthyTenantClient(tenantId: string, reason: string): Promise<void> {
      const runtime = getRuntime(tenantId);
      if (runtime.restartPromise) {
        console.warn("[WhatsApp] Restart already in progress:", { tenantId, reason });
        return runtime.restartPromise;
      }

      runtime.restartPromise = (async () => {
        console.warn("[WhatsApp] Restarting tenant client:", { tenantId, reason });
        stopTenantHealthCheck(tenantId);
        stopTenantSessionBackup(tenantId);

        const clientToDestroy = runtime.client;
        runtime.client = null;
        runtime.status = "disconnected";
        runtime.connectedPhone = null;
        runtime.qrCode = null;

        if (clientToDestroy) {
          try {
            await withTimeout(clientToDestroy.destroy(), 5000, "destroy timeout");
          } catch {
            // Best effort. A hung browser may not answer destroy().
          }
        }

        stopWatchingSessionDir(tenantId);
        await cleanupStaleWhatsappBrowserSession(tenantId);

        const session = await getWhatsappSessionByTenantId(tenantId);
        if (session?.status === "connected") {
          await startTenantSocket(tenantId);
        }
      })();

      try {
        await runtime.restartPromise;
      } finally {
        runtime.restartPromise = null;
      }
    }

    export async function ensureTenantClient(tenantId: string): Promise<Client | null> {
      const runtime = getRuntime(tenantId);
      if (runtime.status === "connected" && hasReadyClientShape(runtime.client)) return runtime.client;

      const session = await getWhatsappSessionByTenantId(tenantId);
      if (session?.status !== "connected") {
        return null;
      }

      await startTenantSocket(tenantId);
      const client = getRuntime(tenantId).client;
      
      // Wait for client to be ready before returning
      if (client) {
        await new Promise<void>((resolve) => {
          if (client.info) {
            resolve();
          } else {
            client.once('ready', () => resolve());
            // Timeout after 10 seconds to avoid hanging
            setTimeout(() => resolve(), 10000);
          }
        });
      }

      if (hasReadyClientShape(client)) {
        return client;
      }

      console.warn("[WhatsApp] Session is marked connected but the live client is not ready:", tenantId);
      await markRuntimeDisconnected(tenantId);
      return null;
    }

    async function resolveConversationChat(tenantId: string, conversationId: number): Promise<unknown | null> {
      const client = await ensureTenantClient(tenantId);
      if (!client) return null;

      const chats = await withTimeout(client.getChats(), 30000, "getChats timeout");
      return (
        chats.find((chat) => {
          const remoteJid = getChatRemoteJid(chat);
          return (
            shouldIncludeConversationRemoteJid(remoteJid) &&
            getConversationIdFromRemoteJid(remoteJid) === conversationId
          );
        }) ?? null
      );
    }

    export async function listTenantChats(tenantId: string): Promise<WhatsappConversationSummary[]> {
      console.log("[listTenantChats] Starting for tenant:", tenantId);
      const client = await ensureTenantClient(tenantId);
      if (!client) {
        console.log("[listTenantChats] No client available for tenant:", tenantId);
        return [];
      }

      console.log("[listTenantChats] Client available, fetching chats...");
      let chats;
      try {
        chats = await withTimeout(client.getChats(), 30000, "getChats timeout") as any[];
        console.log("[listTenantChats] Total chats fetched:", chats.length);
      } catch (err) {
        console.error("[listTenantChats] Failed to fetch chats:", err);
        if (err instanceof Error && /timeout/i.test(err.message)) {
          const stillConnected = await isClientReady(client, 10000);
          if (!stillConnected) {
            console.warn("[listTenantChats] Client is not healthy after getChats timeout, restarting tenant", tenantId);
            await restartUnhealthyTenantClient(tenantId, err.message);
          } else {
            console.warn("[listTenantChats] getChats timeout while client is still connected; not restarting tenant", tenantId);
          }
        }
        return [];
      }
      
      const filteredChats = chats.filter((chat) => shouldIncludeConversationRemoteJid(getChatRemoteJid(chat)));
      console.log("[listTenantChats] Chats after filtering:", filteredChats.length);
      
      const summaries = await Promise.all(
        filteredChats
          .map(async (chat) => {
            const remoteJid = getChatRemoteJid(chat);
            const typedChat = chat as {
              unreadCount?: number;
              isGroup?: boolean;
              lastMessage?: unknown;
              timestamp?: number | string | Date;
              fetchMessages?: (options?: { limit?: number }) => Promise<unknown[]>;
            };

            let latestMessage = typedChat.lastMessage ?? null;
            if (!latestMessage && typedChat.fetchMessages) {
              const fetched = await typedChat.fetchMessages({ limit: 1 });
              latestMessage = fetched.at(-1) ?? null;
            }

            const clientName = getChatDisplayName(chat);
            const clientPhone = getChatPhone(chat);

            // NOTE: listing conversations must NOT create client records. Auto-create
            // is owned solely by the inbound "message" handler, which resolves the real
            // phone from contact.id. Creating here used the LID-based chat phone and ran
            // on every list load, which is what flooded the CRM with duplicate clients.

            return {
              id: getConversationIdFromRemoteJid(remoteJid),
              remoteJid,
              clientName,
              clientPhone,
              lastMessage: latestMessage ? getMessageText(latestMessage) : "No messages yet",
              lastMessageAt: latestMessage ? getMessageTimestamp(latestMessage) : getIsoTimestamp(typedChat.timestamp),
              unreadCount: Number(typedChat.unreadCount ?? 0),
              isBot: false,
              avatarUrl: null,
            } satisfies WhatsappConversationSummary;
          }),
      );

      console.log("[listTenantChats] Summaries generated:", summaries.length);
      return summaries.sort(
        (a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime(),
      );
    }

    export async function listTenantMessages(
      tenantId: string,
      conversationId: number,
      limit = 500,
    ): Promise<WhatsappConversationMessage[]> {
      const chat = await resolveConversationChat(tenantId, conversationId);
      if (!chat) return [];

      const typedChat = chat as { fetchMessages?: (options?: { limit?: number }) => Promise<unknown[]> };
      const fetched = typedChat.fetchMessages ? await typedChat.fetchMessages({ limit }) : [];
      const remoteJid = getChatRemoteJid(chat);
      const liveMessages = fetched
        .sort(
          (a, b) =>
            new Date(getMessageTimestamp(a)).getTime() - new Date(getMessageTimestamp(b)).getTime(),
        )
        .map((message, index) => mapMessageToConversationMessage(message, index, conversationId, remoteJid));

      if (liveMessages.length > 0) {
        return liveMessages;
      }

      const storedMessages = await listStoredInboundMessages(tenantId, conversationId, remoteJid, limit);
      if (storedMessages.length > 0) {
        return storedMessages;
      }

      const latestMessage = (chat as { lastMessage?: unknown }).lastMessage;
      return latestMessage ? [mapMessageToConversationMessage(latestMessage, 0, conversationId, remoteJid)] : [];
    }

    /**
    * Convert a stored phone number into a WhatsApp MSISDN (digits only, international
    * form, no leading "+"). Handles the common South African local format where a
    * number is stored as 0XXXXXXXXX (10 digits) and must become 27XXXXXXXXX.
    */
    export function toWhatsAppMsisdn(phone: string): string {
      let digits = normalizePhoneLikeValue(phone);
      if (!digits) return "";
      if (digits.startsWith("0") && digits.length === 10) {
        digits = `27${digits.slice(1)}`;
      }
      return digits;
    }

    export function resolveRemoteJidFromPhone(phone: string): string {
      const trimmed = phone.trim();
      if (!trimmed) return "";
      if (trimmed.includes("@")) return normalizeRemoteJid(trimmed);
      const digits = toWhatsAppMsisdn(trimmed);
      return digits ? `${digits}@c.us` : "";
    }

    /**
    * Resolve the canonical WhatsApp chat id for a phone number via WhatsApp itself.
    *
    * Building "<digits>@c.us" by hand is unreliable: for some numbers the canonical
    * chat id differs from the naive form, and sending to the naive id silently sits
    * at a single tick (sent, never delivered). client.getNumberId() asks WhatsApp
    * for the real id and returns null when the number is not registered on WhatsApp.
    */
    async function resolveWhatsAppJid(client: Client, phone: string): Promise<string> {
      const msisdn = toWhatsAppMsisdn(phone);
      if (!msisdn) {
        throw new Error(`Invalid phone number provided: "${phone}"`);
      }

      let numberId: { _serialized?: string } | null = null;
      try {
        numberId = await client.getNumberId(msisdn);
      } catch (err) {
        console.error("[WhatsApp resolveWhatsAppJid] getNumberId threw", {
          phone,
          msisdn,
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }

      if (!numberId?._serialized) {
        console.error("[WhatsApp resolveWhatsAppJid] number is not on WhatsApp", { phone, msisdn });
        throw new Error(`${phone} is not a registered WhatsApp number`);
      }

      const naiveJid = `${msisdn}@c.us`;
      const resolvedJid = numberId._serialized;

      // Always force WhatsApp JID format (@c.us) to ensure messages go to WhatsApp
      // Baileys getNumberId() may return LinkedIn (@lid) or other formats
      if (resolvedJid !== naiveJid) {
        console.warn("[WhatsApp resolveWhatsAppJid] Non-standard JID detected, forcing WhatsApp format", {
          phone,
          msisdn,
          resolvedJid,
          naiveJid,
        });
        return naiveJid;
      }

      console.log("[WhatsApp resolveWhatsAppJid] resolved", {
        phone,
        msisdn,
        remoteJid: resolvedJid,
        naiveJid,
      });

      return resolvedJid;
    }

    async function loadMessageMedia(urlOrDataUri: string): Promise<MessageMedia> {
      const trimmed = urlOrDataUri.trim();
      if (!trimmed) {
        throw new Error("Media URL is required.");
      }

      if (trimmed.startsWith("data:")) {
        const parts = /^data:(.+?);base64,(.*)$/s.exec(trimmed);
        if (!parts) {
          throw new Error("Invalid data URI for media.");
        }

        return new MessageMedia(parts[1], parts[2]);
      }

      const response = await fetch(trimmed);
      if (!response.ok) {
        throw new Error(`Unable to load media from URL: ${response.status} ${response.statusText}`);
      }

      const contentType = response.headers.get("content-type") ?? "application/octet-stream";
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const base64Data = buffer.toString("base64");

      const filename = (() => {
        try {
          const url = new URL(trimmed);
          const candidate = url.pathname.split("/").filter(Boolean).pop();
          return candidate || "media";
        } catch {
          return "media";
        }
      })();

      return new MessageMedia(contentType, base64Data, filename);
    }

    export async function sendTenantMessageByPhone(
      tenantId: string,
      phone: string,
      content: string,
      imageUrl?: string,
      fastMode = false,
    ): Promise<WhatsappConversationMessage> {
      const client = await ensureTenantClient(tenantId);
      if (!client) {
        throw new Error("WhatsApp client is not connected");
      }

      const remoteJid = await resolveWhatsAppJid(client, phone);

      try {
        const hasRecentConversation = await hasRecentInboundConversation(tenantId, phone);
        if (!hasRecentConversation) {
          console.error(
            "[WhatsApp] Blocking outbound to new contact (not in 24h inbound window). " +
            "WhatsApp Cloud API is required for unsolicited business outreach.",
            { phone },
          );
          throw new Error(
            "Cannot send to this contact. WhatsApp blocks unsolicited outbound messages. " +
            "Please use WhatsApp Cloud API for business campaigns, or wait for this contact to message you first.",
          );
        }

        await waitForSafeOutboundSend(tenantId, fastMode);

        let sent: Message;
        if (imageUrl?.trim()) {
          const media = await loadMessageMedia(imageUrl);
          sent = await client.sendMessage(remoteJid, media, {
            caption: content || undefined,
          });
        } else if (!content.trim()) {
          throw new Error("Message or image is required.");
        } else {
          sent = await client.sendMessage(remoteJid, content);
        }

        const typedSent = sent as { id?: { id?: string } };
        const messageContent = content.trim() || (imageUrl ? "[Image]" : getMessageText(sent));

        return {
          id: Date.now(),
          messageId: typedSent.id?.id ?? null,
          conversationId: getConversationIdFromRemoteJid(remoteJid),
          remoteJid,
          content: messageContent,
          direction: "outbound",
          timestamp: getMessageTimestamp(sent),
          status: getWhatsappMessageStatus(sent),
          isBot: false,
        };
      } catch (err) {
        console.error("[WhatsApp sendTenantMessageByPhone] failed", {
          tenantId,
          phone,
          remoteJid,
          imageUrl,
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
    }

    export async function sendTenantMessageByRemoteJid(
      tenantId: string,
      remoteJidInput: string,
      content: string,
      imageUrl?: string,
    ): Promise<WhatsappConversationMessage> {
      const remoteJid = normalizeRemoteJid(remoteJidInput);
      if (!shouldIncludeConversationRemoteJid(remoteJid) || remoteJid.endsWith("@g.us")) {
        throw new Error("Invalid WhatsApp chat id.");
      }

      const client = await ensureTenantClient(tenantId);
      if (!client) {
        throw new Error("WhatsApp client is not connected");
      }

      try {
        const hasRecentConversation = await hasRecentInboundConversation(tenantId, remoteJidInput);
        if (!hasRecentConversation) {
          console.error(
            "[WhatsApp] Blocking outbound to new contact (not in 24h inbound window). " +
            "WhatsApp Cloud API is required for unsolicited business outreach.",
            { remoteJidInput },
          );
          throw new Error(
            "Cannot send to this contact. WhatsApp blocks unsolicited outbound messages. " +
            "Please use WhatsApp Cloud API for business campaigns, or wait for this contact to message you first.",
          );
        }

        await waitForSafeOutboundSend(tenantId);

        let sent: Message;
        if (imageUrl?.trim()) {
          const media = await loadMessageMedia(imageUrl);
          sent = await client.sendMessage(remoteJid, media, {
            caption: content || undefined,
          });
        } else if (!content.trim()) {
          throw new Error("Message or image is required.");
        } else {
          sent = await client.sendMessage(remoteJid, content);
        }

        const typedSent = sent as { id?: { id?: string } };
        const messageContent = content.trim() || (imageUrl ? "[Image]" : getMessageText(sent));

        return {
          id: Date.now(),
          messageId: typedSent.id?.id ?? null,
          conversationId: getConversationIdFromRemoteJid(remoteJid),
          remoteJid,
          content: messageContent,
          direction: "outbound",
          timestamp: getMessageTimestamp(sent),
          status: getWhatsappMessageStatus(sent),
          isBot: false,
        };
      } catch (err) {
        console.error("[WhatsApp sendTenantMessageByRemoteJid] failed", {
          tenantId,
          remoteJid,
          imageUrl,
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
    }

    export async function sendTenantMessage(
      tenantId: string,
      conversationId: number,
      content: string,
      imageUrl?: string,
    ): Promise<WhatsappConversationMessage> {
      const chat = await resolveConversationChat(tenantId, conversationId);
      if (!chat) {
        throw new Error("Conversation not found");
      }

      const client = await ensureTenantClient(tenantId);
      if (!client) {
        throw new Error("WhatsApp client is not connected");
      }

      const remoteJid = getChatRemoteJid(chat);
      await waitForSafeOutboundSend(tenantId);
      let sent: Message;
      if (imageUrl?.trim()) {
        const media = await loadMessageMedia(imageUrl);
        sent = await client.sendMessage(remoteJid, media, {
          caption: content || undefined,
        });
      } else if (!content.trim()) {
        throw new Error("Message or image is required.");
      } else {
        sent = await client.sendMessage(remoteJid, content);
      }

      const typedSent = sent as { id?: { id?: string } };
      const messageContent = content.trim() || (imageUrl ? "[Image]" : getMessageText(sent));

      return {
        id: Date.now(),
        messageId: typedSent.id?.id ?? null,
        conversationId,
        remoteJid,
        content: messageContent,
        direction: "outbound",
        timestamp: getMessageTimestamp(sent),
        status: getWhatsappMessageStatus(sent),
        isBot: false,
      };
    }

    export async function markTenantConversationRead(tenantId: string, conversationId: number): Promise<void> {
      const chat = await resolveConversationChat(tenantId, conversationId);
      const typedChat = chat as { sendSeen?: () => Promise<unknown> } | null;
      if (!typedChat?.sendSeen) {
        throw new Error("Conversation not found");
      }

      await typedChat.sendSeen();
    }

    export async function startTenantSocket(tenantId: string): Promise<WhatsappSessionRow> {
      const runtime = getRuntime(tenantId);
      if (runtime.startingPromise) {
        console.log("[WhatsApp] startTenantSocket already in progress for tenant:", tenantId);
        return runtime.startingPromise;
      }

      if (runtime.client && runtime.status !== "disconnected") {
        console.log("[WhatsApp] startTenantSocket skipped because active client already exists for tenant:", tenantId, {
          status: runtime.status,
          qrCode: runtime.qrCode ? "present" : "none",
          connectedPhone: runtime.connectedPhone,
        });
        return await createOrLoadWhatsappSession(tenantId);
      }

      if (runtime.client) {
        console.log("[WhatsApp] startTenantSocket called while runtime.client exists for tenant:", tenantId, "status:", runtime.status);
      }

      runtime.startingPromise = (async () => {
        await ensureSessionsRoot();
        await cleanupStaleWhatsappBrowserSession(tenantId);
        await restoreSessionFromSupabase(tenantId);
        const session = await createOrLoadWhatsappSession(tenantId);
        const businessId = await getBusinessIdForTenant(tenantId);
        const sessionDir = getSessionDir(tenantId);

        console.log("[WhatsApp] Creating client with LocalAuth for tenant:", tenantId);
        console.log("[WhatsApp] sessionsRoot=", sessionsRoot);
        console.log("[WhatsApp] sessionDir=", sessionDir);
        console.log("[WhatsApp] sessionDir exists=", existsSync(sessionDir));
        console.log("[WhatsApp] LocalAuth dataPath=", sessionsRoot);
        logSessionDirSnapshot(tenantId, sessionDir);
        const executablePath = resolveBrowserExecutablePath();

        if (executablePath) {
          console.log("[WhatsApp] Launching browser with executable path:", executablePath);
        } else {
          console.log("[WhatsApp] No explicit browser path configured; using Puppeteer's bundled Chromium.");
        }

        const puppeteerOptions: Record<string, unknown> = {
          headless: true,
          dumpio: true,
          args: [
            "--headless",
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
            "--disable-software-rasterizer",
            "--disable-extensions",
            "--disable-background-networking",
            "--disable-background-timer-throttling",
            "--disable-backgrounding-occluded-windows",
            "--disable-renderer-backgrounding",
            "--disable-infobars",
            "--mute-audio",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-sync",
            "--metrics-recording-only",
            "--no-zygote",
            "--window-size=1280,720",
            "--proxy-server=direct://",
            "--proxy-bypass-list=*",
            "--disable-breakpad",
            "--disable-crash-reporter",
            "--disable-crashpad",
            "--disable-features=TranslateUI,site-per-process,VizDisplayCompositor,AudioServiceOutOfProcess,UseDBus,UseOzonePlatform",
            "--ozone-platform=offscreen",
            "--use-gl=swiftshader",
            "--disable-ipc-flooding-protection",
          ],
          env: getBrowserLaunchEnv(),
        };

        if (executablePath) {
          puppeteerOptions.executablePath = executablePath;
        }

        const client = new Client({
          authStrategy: new LocalAuth({
            clientId: tenantId,
            dataPath: sessionsRoot,
          }),
          puppeteer: puppeteerOptions,
        });

        runtime.client = client;
        runtime.status = session.status;
        runtime.qrCode = session.qr_code;
        runtime.connectedPhone = session.connected_phone;
        watchSessionDir(tenantId, sessionDir);
        dumpClientDebugInfo(client, tenantId);
        attachPuppeteerDiagnostics(client, tenantId);

        console.log("[WhatsApp] Client created for tenant:", tenantId, {
          status: runtime.status,
          qrCode: runtime.qrCode ? "present" : "none",
          connectedPhone: runtime.connectedPhone,
        });

        client.on("qr", (qr: string) => {
          console.log("[WhatsApp] qr event for tenant:", tenantId);
          logSessionDirSnapshot(tenantId, sessionDir);
          void (async () => {
            runtime.status = "qrcode";
            runtime.qrCode = await QRCode.toDataURL(qr);
            await persistSessionState(session.id, {
              status: "qrcode",
              qr_code: runtime.qrCode,
              last_seen_at: new Date().toISOString(),
            });

            const refreshed = await getWhatsappSessionByTenantId(tenantId);
            if (refreshed) {
              notifyQrWaiters(tenantId, refreshed);
            } else {
              console.warn("[WhatsApp] QR event did not refresh session row for tenant:", tenantId);
            }
          })().catch((error) => {
            console.error("Failed to process WhatsApp QR event:", error);
          });
        });

        client.on("ready", () => {
          void (async () => {
            const liveState = await getClientConnectionState(client, 10000);
            if (liveState !== "CONNECTED") {
              console.warn("[WhatsApp] Ready event fired before CONNECTED state:", liveState);
              return;
            }

            runtime.status = "connected";
            runtime.qrCode = null;
            runtime.connectedPhone = getConnectedPhone(client);
            runtime.healthCheckFailures = 0;
            startTenantHealthCheck(tenantId);
            startTenantSessionBackup(tenantId);
            console.log('[WhatsApp] Client is ready and connected. Phone:', runtime.connectedPhone);
            await persistSessionState(session.id, {
              status: "connected",
              qr_code: null,
              connected_phone: runtime.connectedPhone,
              last_seen_at: new Date().toISOString(),
            });
            await backupSessionToSupabase(tenantId);
          })().catch((error) => {
            console.error("Failed to process WhatsApp ready event:", error);
          });
        });

        client.on("authenticated", () => {
          console.log("[WhatsApp] authenticated event for tenant:", tenantId);
          runtime.status = runtime.status === "connected" ? "connected" : runtime.status;
        });

        client.on("auth_failure", (message) => {
          console.warn("[WhatsApp] auth_failure event received for tenant:", tenantId, "message:", message);
          stopTenantHealthCheck(tenantId);
          stopTenantSessionBackup(tenantId);
          void (async () => {
            await deleteSessionArchiveFromSupabase(tenantId);
            await persistSessionState(session.id, {
              status: "disconnected",
              qr_code: null,
              connected_phone: null,
              last_seen_at: new Date().toISOString(),
            });
          })().catch((error) => {
            console.error("Failed to process WhatsApp auth failure:", error);
          });
        });

        client.on("session_update", (sessionData) => {
          console.log("[WhatsApp] session_update event for tenant:", tenantId, {
            keys: sessionData ? Object.keys(sessionData as Record<string, unknown>) : null,
          });
        });

        client.on("change_state", (state) => {
          console.log("[WhatsApp] change_state event for tenant:", tenantId, "state:", state);
        });

        client.on("loading_screen", (percent) => {
          console.log("[WhatsApp] loading_screen event for tenant:", tenantId, "percent:", percent);
        });

        client.on("remote_session_saved", () => {
          console.log("[WhatsApp] remote_session_saved event for tenant:", tenantId);
        });

        client.on("disconnected", (reason) => {
          console.warn("[WhatsApp] disconnected event received for tenant:", tenantId, "reason:", reason);
          stopWatchingSessionDir(tenantId);
          void (async () => {
            stopTenantHealthCheck(tenantId);
            stopTenantSessionBackup(tenantId);
            runtime.status = "disconnected";
            runtime.connectedPhone = null;
            runtime.client = null;
            await persistSessionState(session.id, {
              status: "disconnected",
              qr_code: null,
              connected_phone: null,
              last_seen_at: new Date().toISOString(),
            });
            logSessionDirSnapshot(tenantId, sessionDir);
          })().catch((error) => {
            console.error("Failed to process WhatsApp disconnect:", error);
          });
        });

        // AI auto-reply for incoming private messages (when bot is enabled).
        client.on("message_create", async (message: Message) => {
          if (message.fromMe) return;

          const fromJidRaw = message.from ?? "";
          if (fromJidRaw.endsWith("@g.us")) return;

          const jidUser = fromJidRaw.split("@")[0] ?? "";
          const relevantJid = fromJidRaw;
          const textBody = message.body?.trim() ?? "";
          if (!textBody) return;

          const businessId = await getBusinessIdForTenant(tenantId);
          if (!businessId) {
            console.error("[WhatsApp AI] Could not resolve business ID for tenant", tenantId);
            return;
          }
          console.log("[WhatsApp AI] Resolved business ID for tenant", tenantId, "=>", businessId);

          const botConfig = await fetchBotSettingsForBusiness(businessId);
          const settings = botConfig.settings;
          if (!settings?.bot_enabled) return;

          if (!shouldReplyToPhone(jidUser)) return;

          if (currentlyProcessing.has(relevantJid)) return;

          const withinHours = isWithinWorkingHours(botConfig.workingHours, settings.always_on);

          if (!withinHours) {
            // Outside bot working hours — send one courtesy reply per 24h window then
            // stay silent. Avoids spamming "we're closed" on every customer message.
            if (!hasRecentlyReceivedClosedReply(relevantJid)) {
              const next = nextOpeningTime(botConfig.workingHours);
              const closedReply = next
                ? `Thanks for your message! Our booking assistant is currently offline. We'll be back ${next} — feel free to message us then and we'll get you sorted! 😊`
                : `Thanks for your message! Our booking assistant is currently offline. Please try again during business hours.`;
              try {
                await client.sendMessage(relevantJid, closedReply);
                recordOutOfHoursReply(relevantJid);
              } catch (err) {
                console.error("[WhatsApp AI] Failed to send out-of-hours reply:", err);
              }
            }
            return;
          }

          // Within hours — reset the closed-reply dedup so the customer gets a fresh
          // greeting if they message again after hours again later.
          clearOutOfHoursReply(relevantJid);

          currentlyProcessing.add(relevantJid);
          try {
            const senderName =
              (message as { _data?: { notifyName?: string } })._data?.notifyName?.trim() || "";

            // Resolve the real phone from contact.id — message.from is a LID, not a phone.
            // Used for client lookup and any booking/cancel/reschedule the AI performs.
            const senderPhone = await resolveInboundPhoneNumber(message);

            const [chat, clientProfile] = await Promise.all([
              message.getChat(),
              findClientByPhoneForBusiness(businessId, senderPhone),
            ]);

            // NOTE: client auto-create is owned solely by the "message" handler (which
            // also resolves the real phone). Creating here raced with it and produced
            // duplicate client records, so we intentionally do not create here.

            const clientName =
              clientProfile?.name || senderName || "there";

            const [{ history, isFirstMessage }, { businessContext, aiData, workingHoursText }] = await Promise.all([
              getGroqChatHistory(chat, message),
              buildBookingAiContext(
                businessId,
                clientProfile,
                senderName,
              ),
            ]);

            // Check monthly booking limit BEFORE AI processing to save tokens
            const now = new Date();
            const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
            
            const { data: monthlyBookings } = await getSupabaseAdmin()
              .from("bookings")
              .select("id")
              .eq("business_id", businessId)
              .gte("start_time", startOfMonth.toISOString())
              .lte("start_time", endOfMonth.toISOString());
            
            const bookingsThisMonth = monthlyBookings?.length || 0;
            
            const ownerLookup = await getSupabaseAdmin()
              .from("tenants")
              .select("owner_user_id")
              .eq("id", tenantId)
              .maybeSingle();
            const ownerUserId = ownerLookup?.data?.owner_user_id ?? null;
            console.log("[WhatsApp AI] Tenant owner user id:", ownerUserId);

            const subscription = await getSubscriptionForBusiness(businessId, ownerUserId);

            console.log("[WhatsApp AI] Subscription data:", JSON.stringify(subscription, null, 2));

            const monthlyLimit = extractMonthlyBookingLimit(subscription);
            console.log("[WhatsApp AI] Parsed monthly limit:", monthlyLimit);
            console.log("[WhatsApp AI] bookingsThisMonth:", bookingsThisMonth, "monthlyLimit:", monthlyLimit);
            
            if (bookingsThisMonth >= monthlyLimit) {
              console.log("[WhatsApp AI] BLOCKED: Monthly booking limit reached, skipping AI processing");
              // Send limit reached message to user
              const limitMessage = `⚠️ Booking limit reached: You've created ${bookingsThisMonth} bookings this month. Your plan limit is ${monthlyLimit}. Please contact the business directly.`;
              await client.sendMessage(relevantJid, limitMessage);
              return;
            }

            const promptSettings = {
              bot_name: settings.bot_name,
              tone: settings.tone,
              welcome_message: settings.welcome_message,
              fallback_message: settings.fallback_message,
              auto_confirm: settings.auto_confirm,
              accept_cancellations: settings.accept_cancellations,
              cancellation_min_notice_hours: settings.cancellation_min_notice_hours ?? 24,
              cancellation_decline_message: settings.cancellation_decline_message ?? "",
              accept_reschedules: settings.accept_reschedules ?? true,
              reschedule_min_notice_hours: settings.reschedule_min_notice_hours ?? 24,
              reschedule_decline_message: settings.reschedule_decline_message ?? "",
              send_payment_links: settings.send_payment_links,
              answer_faqs: settings.answer_faqs,
              working_hours: workingHoursText,
              always_on: settings.always_on,
              client_name: clientName,
              client_id: clientProfile?.id ?? null,
              is_first_message: isFirstMessage,
              within_business_hours: withinHours,
              current_time: currentBusinessTime(),
              action_summary: undefined,
            } as const;

            const { decision, reply: initialReply } = await getDecisionAndReply(
              history,
              businessContext,
              promptSettings,
              aiData,
              jidUser,
            );

            const reviewMode = settings.review_mode ?? "auto";
            if (reviewMode !== "auto") {
              const draftId = await saveWhatsappAiDraft({
                businessId,
                tenantId,
                remoteJid: relevantJid,
                clientId: clientProfile?.id ?? null,
                clientName,
                clientPhone: senderPhone,
                inboundMessageText: textBody,
                suggestedReply: initialReply,
                decision,
              });

              console.log("[WhatsApp AI] Draft saved instead of sending", {
                draftId,
                phone: jidUser,
                reviewMode,
              });
              return;
            }

            const actionResult = await executeAssistantAction({
              businessId,
              phone: senderPhone,
              fallbackClientName: clientName,
              settings: promptSettings,
              aiData,
              decision,
            });

            let aiResponse = initialReply;
            if (actionResult.outcome !== "none") {
              aiResponse = await getConfirmationReply(
                history,
                businessContext,
                promptSettings,
                aiData,
                jidUser,
                actionResult.summary,
              );
            }

            if (aiResponse) {
              await client.sendMessage(relevantJid, aiResponse);
              await recordActivity({
                businessId,
                actorType: "ai",
                actorId: settings.bot_name,
                entityType: "whatsapp",
                entityId: relevantJid,
                eventType: "ai_reply_sent",
                title: "AI replied on WhatsApp",
                description: aiResponse,
                metadata: {
                  phone: senderPhone || jidUser,
                  clientId: clientProfile?.id ?? null,
                  clientName,
                  actionOutcome: actionResult.outcome,
                },
              });
              console.log("[WhatsApp AI] Response sent to", jidUser);
            }
          } catch (error) {
            console.error("[WhatsApp AI] Processing failed:", error);
            try {
              await client.sendMessage(
                relevantJid,
                settings?.fallback_message ??
                  "Sorry, I'm having trouble right now. A team member will help you shortly.",
              );
            } catch {
              // Best effort fallback only.
            }
          } finally {
            currentlyProcessing.delete(relevantJid);
          }
        });

        console.log("[WhatsApp] Registering inbound message handler");
        client.on("message", async (message: Message) => {
          if (message.fromMe) return;

          void storeInboundMessage(session, message).catch((error) => {
            console.error("Failed to store inbound WhatsApp message:", error);
          });

          const fromJid = message.from ?? "";
          if (fromJid.endsWith("@g.us")) return;

          const senderName = (message as { _data?: { notifyName?: string } })._data?.notifyName || "";

          // Resolve the REAL phone from contact.id. message.from and contact.number are
          // the opaque LID on LID-based accounts, NOT a phone number — storing those is
          // what created duplicate "client with the jid" records. When the phone can't
          // be recovered we skip auto-add rather than persist a LID.
          const phone = await resolveInboundPhoneNumber(message);
          const lid = extractLidFromJid(fromJid);

          console.log('[WhatsApp Message] ⬇ INBOUND:', {
            from: fromJid,
            resolvedPhone: phone || "(unresolved — skipping auto-add)",
            lid,
            senderName,
            body: message.body?.slice(0, 120),
          });

          if (phone && businessId) {
            void createClientFromWhatsApp(businessId, phone, senderName, lid);
          }
        });

        try {
          await client.initialize();
          console.log("[WhatsApp] Client.initialize resolved for tenant:", tenantId, {
            info: client.info ? client.info : null,
            sessionDirExists: existsSync(sessionDir),
          });
          logSessionDirSnapshot(tenantId, sessionDir);
        } catch (error) {
          console.error("[WhatsApp] Client initialization failed:", error);
          stopTenantHealthCheck(tenantId);
          stopTenantSessionBackup(tenantId);
          stopWatchingSessionDir(tenantId);
          runtime.client = null;
          runtime.status = "disconnected";
          runtime.qrCode = null;
          runtime.connectedPhone = null;
          await persistSessionState(session.id, {
            status: "disconnected",
            qr_code: null,
            connected_phone: null,
            last_seen_at: new Date().toISOString(),
          }).catch((persistError) => {
            console.error("[WhatsApp] Failed to persist initialization failure:", persistError);
          });
          throw error;
        }
        return session;
      })();

      try {
        return await runtime.startingPromise;
      } finally {
        runtime.startingPromise = null;
      }
    }

    export async function waitForQrOrConnection(tenantId: string, timeoutMs = 15000): Promise<WhatsappSessionRow> {
      const existing = await getWhatsappSessionByTenantId(tenantId);
      if (existing?.status === "qrcode" || existing?.status === "connected") {
        console.log("[WhatsApp] waitForQrOrConnection returning existing session for tenant:", tenantId, existing.status);
        return existing;
      }

      return new Promise<WhatsappSessionRow>((resolve, reject) => {
        console.log("[WhatsApp] waitForQrOrConnection waiting for tenant:", tenantId, { timeoutMs, waiterCount: (qrWaiters.get(tenantId)?.length ?? 0) + 1, existingSessionStatus: existing?.status ?? null });
        const wrappedResolve = (session: WhatsappSessionRow) => {
          clearTimeout(timeout);
          console.log("[WhatsApp] waitForQrOrConnection resolved for tenant:", tenantId, session.status);
          resolve(session);
        };

        const timeout = setTimeout(() => {
          const waiters = qrWaiters.get(tenantId) ?? [];
          qrWaiters.set(
            tenantId,
            waiters.filter((entry) => entry !== wrappedResolve),
          );
          console.warn("[WhatsApp] waitForQrOrConnection timed out for tenant:", tenantId);
          reject(new Error("Timed out waiting for WhatsApp QR code"));
        }, timeoutMs);

        const current = qrWaiters.get(tenantId) ?? [];
        current.push(wrappedResolve);
        qrWaiters.set(tenantId, current);
      });
    }

    export async function getLiveWhatsappSession(tenantId: string): Promise<WhatsappSessionRow | null> {
      const session = await getWhatsappSessionByTenantId(tenantId);
      if (!session) return null;

      const runtime = getRuntime(tenantId);
      if (runtime.client) {
        if (runtime.status === "connected" && !hasReadyClientShape(runtime.client)) {
          if (!runtime.restartPromise) {
            void restartUnhealthyTenantClient(tenantId, "browser page closed").catch((error) => {
              console.error("[WhatsApp] Failed to restart closed browser session:", error);
            });
          }

          return {
            ...session,
            status: "disconnected",
            qr_code: null,
            connected_phone: null,
          };
        }

        return {
          ...session,
          status: runtime.status,
          qr_code: runtime.qrCode,
          connected_phone: runtime.connectedPhone,
        };
      }

      return session;
    }

    /**
    * Called once at server startup.
    * Finds every WhatsApp session that was previously in "connected" state and
    * restarts the socket so the bot keeps listening in the background without
    * the user needing to open the UI.
    */
    export async function autoBootWhatsappSessions(): Promise<void> {
      if (!isSupabaseAdminConfigured()) {
        console.log("[WhatsApp AutoBoot] Supabase not configured – skipping auto-boot.");
        return;
      }

      const { data: sessions, error } = await getSupabaseAdmin()
        .from("whatsapp_sessions")
        .select("*")
        .eq("status", "connected");

      if (error) {
        console.error("[WhatsApp AutoBoot] Failed to query sessions:", error.message);
        return;
      }

      const rows = (sessions ?? []) as WhatsappSessionRow[];
      if (rows.length === 0) {
        console.log("[WhatsApp AutoBoot] No previously connected sessions found.");
        return;
      }

      console.log(`[WhatsApp AutoBoot] Restarting ${rows.length} session(s) in the background...`);
      for (const row of rows) {
        const tenantId = row.tenant_id;
        console.log(`[WhatsApp AutoBoot] Booting session for tenant ${tenantId}`);
        void startTenantSocket(tenantId).catch((err) => {
          console.error(`[WhatsApp AutoBoot] Failed to boot session for tenant ${tenantId}:`, err);
        });
      }
    }
