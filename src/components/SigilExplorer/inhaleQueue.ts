// src/components/SigilExplorer/inhaleQueue.ts
"use client";

import { apiFetchWithFailover, API_INHALE_PATH } from "./apiClient";
import type { SigilSharePayloadLoose } from "./types";
import { canonicalizeUrl, extractPayloadFromUrl, isPTildeUrl, looksLikeBareToken, parseStreamToken, streamUrlFromToken } from "./url";
import { memoryRegistry, isOnline } from "./registryStore";

const hasWindow = typeof window !== "undefined";

const INHALE_BATCH_MAX = 200;
const INHALE_DEBOUNCE_MS = 180;
const INHALE_RETRY_BASE_MS = 1200;
const INHALE_RETRY_MAX_MS = 12000;

export const INHALE_QUEUE_LS_KEY = "kai:inhaleQueue:v1";

const inhaleQueue: Map<string, Record<string, unknown>> = new Map();
let inhaleFlushTimer: number | null = null;
let inhaleInFlight = false;
let inhaleRetryMs = 0;

const canMatchMedia = hasWindow && typeof window.matchMedia === "function";
const isCoarsePointer = canMatchMedia && window.matchMedia("(pointer: coarse)").matches;

function shouldFastFlush(): boolean {
  if (!hasWindow) return false;
  if (!isCoarsePointer) return false;
  if (typeof document === "undefined") return false;
  return document.visibilityState === "visible";
}

function scheduleFastFlush(): void {
  if (!shouldFastFlush()) return;
  const run = () => void flushInhaleQueue();
  if (typeof queueMicrotask === "function") {
    queueMicrotask(run);
  } else {
    window.setTimeout(run, 0);
  }
}

function randId(): string {
  if (hasWindow && typeof window.crypto?.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return Math.random().toString(16).slice(2);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function saveInhaleQueueToStorage(): void {
  if (!hasWindow) return;
  try {
    const json = JSON.stringify([...inhaleQueue.entries()]);
    localStorage.setItem(INHALE_QUEUE_LS_KEY, json);
  } catch {
    // ignore quota issues
  }
}

function loadInhaleQueueFromStorage(): void {
  if (!hasWindow) return;
  const raw = localStorage.getItem(INHALE_QUEUE_LS_KEY);
  if (!raw) return;
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return;
    inhaleQueue.clear();
    for (const item of arr) {
      if (!Array.isArray(item) || item.length !== 2) continue;
      const [url, obj] = item;
      if (typeof url !== "string" || !isRecord(obj)) continue;
      inhaleQueue.set(canonicalizeUrl(url), obj);
    }
  } catch {
    // ignore corrupt
  }
}

function enqueueInhaleRawKrystal(krystal: Record<string, unknown>): void {
  const urlVal = krystal.url;
  if (typeof urlVal !== "string" || !urlVal.trim()) return;

  const abs = canonicalizeUrl(urlVal.trim());
  inhaleQueue.set(abs, { ...krystal, url: abs });
  saveInhaleQueueToStorage();

  if (!hasWindow) return;
  if (inhaleFlushTimer != null) window.clearTimeout(inhaleFlushTimer);
  inhaleFlushTimer = window.setTimeout(() => {
    inhaleFlushTimer = null;
    void flushInhaleQueue();
  }, INHALE_DEBOUNCE_MS);
  scheduleFastFlush();
}

function enqueueInhaleKrystal(url: string, payload: SigilSharePayloadLoose): void {
  const abs = canonicalizeUrl(url);
  const rec = payload as unknown as Record<string, unknown>;
  const krystal: Record<string, unknown> = { url: abs, ...rec };
  inhaleQueue.set(abs, krystal);
  saveInhaleQueueToStorage();

  if (!hasWindow) return;
  if (inhaleFlushTimer != null) window.clearTimeout(inhaleFlushTimer);
  inhaleFlushTimer = window.setTimeout(() => {
    inhaleFlushTimer = null;
    void flushInhaleQueue();
  }, INHALE_DEBOUNCE_MS);
  scheduleFastFlush();
}

/**
 * Seed inhaleQueue from ALL local registry entries.
 * This is the “OPEN inhale” that makes the system resilient to API restarts/resets.
 */
function seedInhaleFromRegistry(): void {
  for (const [rawUrl, payload] of memoryRegistry) {
    const url = canonicalizeUrl(rawUrl);
    const rec = payload as unknown as Record<string, unknown>;
    inhaleQueue.set(url, { url, ...rec });
  }
  saveInhaleQueueToStorage();
}

function safeDecodeURIComponent(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

function extractWitnessChainFromUrl(url: string): string[] {
  try {
    const u = new URL(url, window.location.origin);

    const hashStr = u.hash.startsWith("#") ? u.hash.slice(1) : "";
    const h = new URLSearchParams(hashStr);

    const rawAdds = [...u.searchParams.getAll("add"), ...h.getAll("add")];

    const out: string[] = [];
    for (const raw of rawAdds) {
      const decoded = safeDecodeURIComponent(String(raw)).trim();
      if (!decoded) continue;

      if (looksLikeBareToken(decoded)) {
        const abs = canonicalizeUrl(streamUrlFromToken(decoded));
        if (!out.includes(abs)) out.push(abs);
        continue;
      }

      let abs = canonicalizeUrl(decoded);

      if (isPTildeUrl(abs)) {
        const tok = parseStreamToken(abs);
        if (tok) abs = canonicalizeUrl(streamUrlFromToken(tok));
      }

      if (!out.includes(abs)) out.push(abs);
    }

    return out.slice(-512);
  } catch {
    return [];
  }
}

type WitnessCtx = {
  chain: string[];
  originUrl?: string;
  parentUrl?: string;
};

function deriveWitnessContext(url: string): WitnessCtx {
  const chain = extractWitnessChainFromUrl(url);
  if (chain.length === 0) return { chain: [] };
  return {
    chain,
    originUrl: chain[0],
    parentUrl: chain[chain.length - 1],
  };
}

function mergeDerivedContext(payload: SigilSharePayloadLoose, ctx: WitnessCtx): SigilSharePayloadLoose {
  const next: SigilSharePayloadLoose = { ...payload };
  if (ctx.originUrl && !next.originUrl) next.originUrl = ctx.originUrl;
  if (ctx.parentUrl && !next.parentUrl) next.parentUrl = ctx.parentUrl;
  return next;
}

/** Force inhale for URLs even if already present. */
function forceInhaleUrls(urls: readonly string[]): void {
  for (const u of urls) {
    const abs = canonicalizeUrl(u);

    const p0 = memoryRegistry.get(abs) ?? extractPayloadFromUrl(abs);
    if (!p0) continue;

    const ctx = deriveWitnessContext(abs);
    const merged = mergeDerivedContext(p0, ctx);
    enqueueInhaleKrystal(abs, merged);
  }
  void flushInhaleQueue();
}

async function flushInhaleQueue(): Promise<void> {
  if (!hasWindow) return;
  if (!isOnline()) return;
  if (inhaleInFlight) return;
  if (inhaleQueue.size === 0) return;

  inhaleInFlight = true;

  try {
    const batch: Record<string, unknown>[] = [];
    const keys: string[] = [];

    for (const [k, v] of inhaleQueue) {
      batch.push(v);
      keys.push(k);
      if (batch.length >= INHALE_BATCH_MAX) break;
    }

    const json = JSON.stringify(batch);
    const blob = new Blob([json], { type: "application/json" });
    const fd = new FormData();
    fd.append("file", blob, `sigils_${randId()}.json`);

    const makeUrl = (base: string) => {
      const url = new URL(API_INHALE_PATH, base);
      url.searchParams.set("include_state", "false");
      url.searchParams.set("include_urls", "false");
      return url.toString();
    };

    const res = await apiFetchWithFailover(makeUrl, { method: "POST", body: fd });
    if (!res || !res.ok) throw new Error(`inhale failed: ${res?.status ?? 0}`);

    try {
      const _parsed = (await res.json()) as unknown;
      void _parsed;
    } catch {
      // ignore
    }

    for (const k of keys) inhaleQueue.delete(k);
    saveInhaleQueueToStorage();
    inhaleRetryMs = 0;

    if (inhaleQueue.size > 0) {
      inhaleFlushTimer = window.setTimeout(() => {
        inhaleFlushTimer = null;
        void flushInhaleQueue();
      }, 10);
    }
  } catch {
    inhaleRetryMs = Math.min(inhaleRetryMs ? inhaleRetryMs * 2 : INHALE_RETRY_BASE_MS, INHALE_RETRY_MAX_MS);
    inhaleFlushTimer = window.setTimeout(() => {
      inhaleFlushTimer = null;
      void flushInhaleQueue();
    }, inhaleRetryMs);
  } finally {
    inhaleInFlight = false;
  }
}

export {
  enqueueInhaleRawKrystal,
  enqueueInhaleKrystal,
  flushInhaleQueue,
  forceInhaleUrls,
  loadInhaleQueueFromStorage,
  saveInhaleQueueToStorage,
  seedInhaleFromRegistry,
};

export function enqueueInhaleUrl(url: string): void {
  const abs = canonicalizeUrl(url);
  const p0 = memoryRegistry.get(abs) ?? extractPayloadFromUrl(abs);
  if (!p0) return;
  const ctx = deriveWitnessContext(abs);
  const merged = mergeDerivedContext(p0, ctx);
  enqueueInhaleKrystal(abs, merged);
}
