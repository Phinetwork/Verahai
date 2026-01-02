"use client";

import {
  addUrl,
  ensureRegistryHydrated,
  isOnline,
  memoryRegistry,
} from "../components/SigilExplorer/registryStore";
import {
  enqueueInhaleRawKrystal,
  flushInhaleQueue,
  loadInhaleQueueFromStorage,
  seedInhaleFromRegistry,
} from "../components/SigilExplorer/inhaleQueue";
import { pullAndImportRemoteUrls } from "../components/SigilExplorer/remotePull";
import {
  apiFetchWithFailover,
  API_SEAL_PATH,
  loadApiBackupDeadUntil,
  loadApiBaseHint,
  type ApiSealResponse,
} from "../components/SigilExplorer/apiClient";
import { canonicalizeUrl } from "../components/SigilExplorer/url";
import { SIGIL_EXPLORER_OPEN_EVENT } from "../constants/sigilExplorer";
import { subscribeSigilRegistry } from "./sigilRegistry";

type SyncReason = "open" | "pulse" | "visible" | "focus" | "online" | "event";

type SigilSyncHandle = {
  running: boolean;
  stop?: () => void;
};

type SigilSyncBag = {
  registerSend?: (rec: unknown) => void;
  explorerSync?: SigilSyncHandle;
};

const hasWindow = typeof window !== "undefined";
const INHALE_INTERVAL_MS = 3236;
const EXHALE_INTERVAL_MS = 2000;

function getSigilBag(): SigilSyncBag {
  if (!hasWindow) return {};
  const w = window as Window & { __SIGIL__?: SigilSyncBag };
  if (!w.__SIGIL__) w.__SIGIL__ = {};
  return w.__SIGIL__;
}

function readStringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function urlFromSendRecord(record: Record<string, unknown>): string | undefined {
  const url = readStringField(record, "url");
  return url ? canonicalizeUrl(url) : undefined;
}

function hashFromSendRecord(record: Record<string, unknown>): string | undefined {
  return (
    readStringField(record, "childCanonical") ||
    readStringField(record, "childHash") ||
    readStringField(record, "canonicalHash") ||
    readStringField(record, "hash")
  );
}

function getLatestPulseFromRegistry(): number | undefined {
  let latest: number | undefined;
  for (const [, payload] of memoryRegistry) {
    const pulse = (payload as { pulse?: unknown }).pulse;
    if (typeof pulse !== "number" || !Number.isFinite(pulse)) continue;
    if (latest == null || pulse > latest) latest = pulse;
  }
  return latest;
}

function getRegistryCount(): number {
  let count = 0;
  for (const [,] of memoryRegistry) count += 1;
  return count;
}

function readRemotePulse(body: ApiSealResponse): number | undefined {
  const pulse = body?.pulse ?? body?.latestPulse ?? body?.latest_pulse;
  if (typeof pulse !== "number" || !Number.isFinite(pulse)) return undefined;
  return pulse;
}

function readRemoteTotal(body: ApiSealResponse): number | undefined {
  const total = body?.total;
  if (typeof total !== "number" || !Number.isFinite(total)) return undefined;
  return total;
}

export function startSigilExplorerSync(): () => void {
  if (!hasWindow) return () => {};

  const bag = getSigilBag();
  if (bag.explorerSync?.running) return bag.explorerSync.stop ?? (() => {});

  let stopped = false;
  let inhaleTimer: number | null = null;
  let exhaleTimer: number | null = null;

  let syncInFlight = false;
  let remoteSeal: string | null = null;
  let lastFullSeedSeal: string | null = null;

  loadApiBackupDeadUntil();
  loadApiBaseHint();
  loadInhaleQueueFromStorage();

  const hydrated = ensureRegistryHydrated();
  if (hydrated) seedInhaleFromRegistry();

  const applyUrl = (url: string): void => {
    const changed = addUrl(url, {
      includeAncestry: true,
      broadcast: false,
      persist: true,
      source: "local",
      enqueueToApi: true,
    });
    if (changed) void flushInhaleQueue();
  };

  const onSendRecord = (rec: unknown): void => {
    if (!rec || typeof rec !== "object") return;
    const record = rec as Record<string, unknown>;
    const url = urlFromSendRecord(record);
    if (url) {
      applyUrl(url);
      return;
    }

    const hash = hashFromSendRecord(record);
    if (!hash) return;
    const hashUrl = canonicalizeUrl(`/s/${hash}`);

    enqueueInhaleRawKrystal({ url: hashUrl, ...record });
  };

  const prevSend = bag.registerSend;
  bag.registerSend = onSendRecord;

  const unsubscribeRegistry = subscribeSigilRegistry((url) => {
    applyUrl(url);
  });

  const onSentEvent = (event: Event): void => {
    const detail = (event as CustomEvent<unknown>).detail;
    onSendRecord(detail);
  };
  window.addEventListener("sigil:sent", onSentEvent as EventListener);

  const onExplorerOpen = (): void => {
    resnapBreath();
    void inhaleOnce();
    void exhaleOnce("open");
  };
  window.addEventListener(SIGIL_EXPLORER_OPEN_EVENT, onExplorerOpen as EventListener);

  const ac = new AbortController();

  const inhaleOnce = async (): Promise<void> => {
    if (stopped) return;
    if (!isOnline()) return;
    await flushInhaleQueue();
  };

  const exhaleOnce = async (reason: SyncReason): Promise<void> => {
    if (stopped) return;
    if (!isOnline()) return;
    if (syncInFlight) return;

    syncInFlight = true;
    try {
      const prevSeal = remoteSeal;

      const res = await apiFetchWithFailover((base) => new URL(API_SEAL_PATH, base).toString(), {
        method: "GET",
        cache: "no-store",
        signal: ac.signal,
      });

      if (!res) return;
      if (!res.ok && res.status !== 304) return;

      let nextSeal = "";
      let remotePulse: number | undefined;
      let remoteTotal: number | undefined;
      if (res.status !== 304) {
        try {
          const body = (await res.json()) as ApiSealResponse;
          nextSeal = typeof body?.seal === "string" ? body.seal : "";
          remotePulse = readRemotePulse(body);
          remoteTotal = readRemoteTotal(body);
        } catch {
          return;
        }
      }

      const importedRes = await pullAndImportRemoteUrls(ac.signal);
      if (importedRes.pulled) {
        remoteSeal = importedRes.remoteSeal ?? nextSeal ?? prevSeal ?? null;
      }

      const sealNow = remoteSeal;
      const localLatestPulse = getLatestPulseFromRegistry();
      const localCount = getRegistryCount();
      const hasNewerPulse =
        remotePulse != null && (localLatestPulse == null || remotePulse > localLatestPulse);
      const hasMoreRemote =
        remoteTotal != null && (localCount == null || remoteTotal > localCount);
      const shouldFullSeed =
        reason === "open" ||
        hasNewerPulse ||
        hasMoreRemote ||
        (sealNow && sealNow !== lastFullSeedSeal);
      if (shouldFullSeed) {
        seedInhaleFromRegistry();
        lastFullSeedSeal = sealNow;
        await flushInhaleQueue();
      }
    } finally {
      syncInFlight = false;
    }
  };

  const scheduleInhale = (): void => {
    if (inhaleTimer != null) window.clearInterval(inhaleTimer);
    inhaleTimer = window.setInterval(() => {
      void inhaleOnce();
    }, INHALE_INTERVAL_MS);
  };

  const scheduleExhale = (): void => {
    if (exhaleTimer != null) window.clearInterval(exhaleTimer);
    exhaleTimer = window.setInterval(() => {
      void exhaleOnce("pulse");
    }, EXHALE_INTERVAL_MS);
  };

  const resnapBreath = (): void => {
    scheduleInhale();
    scheduleExhale();
  };

  resnapBreath();
  void inhaleOnce();
  void exhaleOnce("open");

  const onVis = () => {
    if (document.visibilityState === "visible") {
      resnapBreath();
      void inhaleOnce();
      void exhaleOnce("visible");
    }
  };

  const onFocus = () => {
    resnapBreath();
    void inhaleOnce();
    void exhaleOnce("focus");
  };

  const onOnline = () => {
    resnapBreath();
    void inhaleOnce();
    void exhaleOnce("online");
  };

  const onPageHide = () => {
    void flushInhaleQueue();
  };

  document.addEventListener("visibilitychange", onVis);
  window.addEventListener("focus", onFocus);
  window.addEventListener("online", onOnline);
  window.addEventListener("pagehide", onPageHide);

  const stop = (): void => {
    if (stopped) return;
    stopped = true;

    if (bag.registerSend === onSendRecord) bag.registerSend = prevSend;
    window.removeEventListener("sigil:sent", onSentEvent as EventListener);
    window.removeEventListener(SIGIL_EXPLORER_OPEN_EVENT, onExplorerOpen as EventListener);
    window.removeEventListener("focus", onFocus);
    window.removeEventListener("online", onOnline);
    window.removeEventListener("pagehide", onPageHide);
    document.removeEventListener("visibilitychange", onVis);

    if (typeof unsubscribeRegistry === "function") unsubscribeRegistry();

    if (inhaleTimer != null) window.clearInterval(inhaleTimer);
    if (exhaleTimer != null) window.clearInterval(exhaleTimer);
    inhaleTimer = null;
    exhaleTimer = null;

    ac.abort();
    bag.explorerSync = { running: false, stop };
  };

  bag.explorerSync = { running: true, stop };
  return stop;
}
