// src/components/SigilExplorer/apiClient.ts
"use client";

export type ApiSealResponse = {
  seal: string;
  pulse?: number;
  latestPulse?: number;
  latest_pulse?: number;
  total?: number;
};

const hasWindow = typeof window !== "undefined";
const canStorage = hasWindow && typeof window.localStorage !== "undefined";

/* ─────────────────────────────────────────────────────────────────────
 *  LAH-MAH-TOR API (Primary + IKANN Failover, soft-fail backup)
 *  ─────────────────────────────────────────────────────────────────── */
export const LIVE_BASE_URL = "https://m.phi.network";
export const LIVE_BACKUP_URL = "https://memory.kaiklok.com";

function selectPrimaryBase(primary: string, backup: string): string {
  if (!hasWindow) return primary;
  const origin = window.location.origin;
  if (origin === primary || origin === backup) return origin;
  return primary;
}

const API_BASE_PRIMARY = selectPrimaryBase(LIVE_BASE_URL, LIVE_BACKUP_URL);
const API_BASE_FALLBACK = API_BASE_PRIMARY === LIVE_BASE_URL ? LIVE_BACKUP_URL : LIVE_BASE_URL;

export const API_SEAL_PATH = "/sigils/seal";
export const API_URLS_PATH = "/sigils/urls";
export const API_INHALE_PATH = "/sigils/inhale";

const API_BASE_HINT_LS_KEY = "kai:lahmahtorBase:v1";

/** Backup suppression: if m.kai fails, suppress it for a cooldown window (no issues, no spam). */
const API_BACKUP_DEAD_UNTIL_LS_KEY = "kai:lahmahtorBackupDeadUntil:v1";
const API_BACKUP_COOLDOWN_MS = 2 * 60 * 1000; // 2 minutes (tight, safe)

let apiBackupDeadUntil = 0;

function nowMs(): number {
  return Date.now();
}

export function loadApiBackupDeadUntil(): void {
  if (!canStorage) return;
  const raw = localStorage.getItem(API_BACKUP_DEAD_UNTIL_LS_KEY);
  if (!raw) return;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) apiBackupDeadUntil = n;
}

function saveApiBackupDeadUntil(): void {
  if (!canStorage) return;
  try {
    localStorage.setItem(API_BACKUP_DEAD_UNTIL_LS_KEY, String(apiBackupDeadUntil));
  } catch {
    // ignore
  }
}

function isBackupSuppressed(): boolean {
  return nowMs() < apiBackupDeadUntil;
}

function clearBackupSuppression(): void {
  if (apiBackupDeadUntil === 0) return;
  apiBackupDeadUntil = 0;
  saveApiBackupDeadUntil();
}

function markBackupDead(): void {
  apiBackupDeadUntil = nowMs() + API_BACKUP_COOLDOWN_MS;
  saveApiBackupDeadUntil();
  // never “stick” to fallback if it’s failing
  if (apiBaseHint === API_BASE_FALLBACK) {
    apiBaseHint = API_BASE_PRIMARY;
    saveApiBaseHint();
  }
}

/** Sticky base: whichever succeeded last is attempted first. */
let apiBaseHint: string = API_BASE_PRIMARY;

export function loadApiBaseHint(): void {
  if (!canStorage) return;
  const raw = localStorage.getItem(API_BASE_HINT_LS_KEY);
  if (raw === API_BASE_PRIMARY) {
    apiBaseHint = raw;
    return;
  }
  if (raw === API_BASE_FALLBACK) {
    // if backup is currently suppressed, never load it as the preferred base
    apiBaseHint = isBackupSuppressed() ? API_BASE_PRIMARY : raw;
  }
}

function saveApiBaseHint(): void {
  if (!canStorage) return;
  try {
    localStorage.setItem(API_BASE_HINT_LS_KEY, apiBaseHint);
  } catch {
    // ignore
  }
}

function apiBases(): string[] {
  const wantFallbackFirst = apiBaseHint === API_BASE_FALLBACK && !isBackupSuppressed();
  const list = wantFallbackFirst
    ? [API_BASE_FALLBACK, API_BASE_PRIMARY]
    : [API_BASE_PRIMARY, API_BASE_FALLBACK];

  if (!hasWindow) {
    // SSR: keep both, but still respect suppression in case it was set via storage read before render.
    return isBackupSuppressed() ? list.filter((b) => b !== API_BASE_FALLBACK) : list;
  }

  const isHttpsPage = window.location.protocol === "https:";
  // Never try http fallback from an https page (browser will block + log loudly)
  const protocolFiltered = isHttpsPage ? list.filter((b) => b.startsWith("https://")) : list;

  const pageOrigin = window.location.origin;
  if (
    pageOrigin === LIVE_BASE_URL ||
    pageOrigin === LIVE_BACKUP_URL
  ) {
    return protocolFiltered.filter((b) => b === pageOrigin);
  }

  // Soft-fail: suppress backup if marked dead
  return isBackupSuppressed() ? protocolFiltered.filter((b) => b !== API_BASE_FALLBACK) : protocolFiltered;
}

function shouldFailoverStatus(status: number): boolean {
  // 0 = network/CORS/unknown from wrapper
  if (status === 0) return true;
  // common “route didn’t exist here but exists on the other base”
  if (status === 404) return true;
  // transient / throttling / upstream
  if (status === 408 || status === 429) return true;
  if (status >= 500) return true;
  return false;
}

export async function apiFetchWithFailover(
  makeUrl: (base: string) => string,
  init?: RequestInit,
): Promise<Response | null> {
  const bases = apiBases();
  let last: Response | null = null;

  for (const base of bases) {
    const url = makeUrl(base);
    try {
      const res = await fetch(url, init);
      last = res;

      // 304 is a valid success for seal checks.
      if (res.ok || res.status === 304) {
        // if backup works again, clear suppression
        if (base === API_BASE_FALLBACK) clearBackupSuppression();

        apiBaseHint = base;
        saveApiBaseHint();
        return res;
      }

      // If backup is failing (404/5xx/etc), suppress it so it never “causes issues”.
      if (base === API_BASE_FALLBACK && shouldFailoverStatus(res.status)) markBackupDead();

      // If this status is “final”, stop here; otherwise try the other base.
      if (!shouldFailoverStatus(res.status)) return res;
    } catch {
      // network failure → try next base
      if (base === API_BASE_FALLBACK) markBackupDead();
      continue;
    }
  }

  return last;
}

export async function apiFetchJsonWithFailover<T>(
  makeUrl: (base: string) => string,
  init?: RequestInit,
): Promise<{ ok: true; value: T; status: number } | { ok: false; status: number }> {
  const res = await apiFetchWithFailover(makeUrl, init);
  if (!res) return { ok: false, status: 0 };
  if (!res.ok) return { ok: false, status: res.status };
  try {
    const value = (await res.json()) as T;
    return { ok: true, value, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  }
}
