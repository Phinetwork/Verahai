// src/components/SigilExplorer/urlHealth.ts
"use client";

import { LIVE_BACKUP_URL, LIVE_BASE_URL } from "./apiClient";
import { browserViewUrl, canonicalizeUrl, viewBaseOrigin, VIEW_BASE_FALLBACK } from "./url";

export type UrlHealthScore = 1 | -1;

const URL_HEALTH_LS_KEY = "kai:urlHealth:v1";
const URL_PROBE_TIMEOUT_MS = 2200;

const hasWindow = typeof window !== "undefined";
const canStorage = hasWindow && typeof window.localStorage !== "undefined";

export const urlHealth: Map<string, UrlHealthScore> = new Map();

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function loadUrlHealthFromStorage(): void {
  if (!canStorage) return;
  const raw = localStorage.getItem(URL_HEALTH_LS_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return;
    urlHealth.clear();
    for (const [k, v] of Object.entries(parsed)) {
      if (v === 1 || v === -1) urlHealth.set(canonicalizeUrl(k), v);
    }
  } catch {
    // ignore
  }
}

function saveUrlHealthToStorage(): void {
  if (!canStorage) return;
  const obj: Record<string, UrlHealthScore> = {};
  for (const [k, v] of urlHealth) obj[k] = v;
  try {
    localStorage.setItem(URL_HEALTH_LS_KEY, JSON.stringify(obj));
  } catch {
    // ignore
  }
}

export function setUrlHealth(u: string, h: UrlHealthScore): boolean {
  const url = canonicalizeUrl(u);
  const prev = urlHealth.get(url);
  if (prev === h) return false;
  urlHealth.set(url, h);
  saveUrlHealthToStorage();
  return true;
}

function isCanonicalHost(host: string): boolean {
  const liveHost = new URL(LIVE_BASE_URL).host;
  const backupHost = new URL(LIVE_BACKUP_URL).host;
  const viewHost = new URL(viewBaseOrigin()).host;
  const fallbackHost = new URL(VIEW_BASE_FALLBACK).host;
  return host === liveHost || host === backupHost || host === viewHost || host === fallbackHost;
}

export async function probeUrl(u: string): Promise<"ok" | "bad" | "unknown"> {
  if (!hasWindow) return "unknown";

  // ✅ Never probe the non-viewable server routes; probe the browser-view form instead.
  const target = browserViewUrl(u);

  let parsed: URL;
  try {
    parsed = new URL(target, viewBaseOrigin());
    if (!isCanonicalHost(parsed.host)) return "unknown";

    // ✅ /stream#p=... is SPA-viewed; probing it would just hit /stream anyway.
    // Treat as OK with zero network to avoid console spam + scroll jitter.
    if (parsed.pathname.toLowerCase() === "/stream") return "ok";
  } catch {
    return "unknown";
  }

  try {
    const ac = new AbortController();
    const t = window.setTimeout(() => ac.abort(), URL_PROBE_TIMEOUT_MS);

    const doFetch = (method: "HEAD" | "GET") =>
      fetch(parsed.toString(), {
        method,
        cache: "no-store",
        signal: ac.signal,
        redirect: "follow",
        mode: "cors",
      });

    let res: Response;
    try {
      res = await doFetch("HEAD");
    } catch {
      res = await doFetch("GET");
    } finally {
      window.clearTimeout(t);
    }

    return res.ok ? "ok" : "bad";
  } catch {
    return "unknown";
  }
}
