// src/components/SigilExplorer/url.ts
/* ─────────────────────────────────────────────────────────────────────
   URL utilities (parity with SigilExplorer.tsx)
────────────────────────────────────────────────────────────────────── */

import type { SigilSharePayloadLoose } from "./types";
import { hasWindow } from "./kaiCadence";
import { LIVE_BACKUP_URL, LIVE_BASE_URL } from "./apiClient";
import { urlHealth } from "./urlHealth";
import { extractPayloadFromUrl as extractPayloadFromUrlUtil, getOriginUrl as getOriginUrlUtil } from "../../utils/sigilUrl";

export const VIEW_BASE_FALLBACK = "https://phi.network";

export function viewBaseOrigin(): string {
  if (!hasWindow) return VIEW_BASE_FALLBACK;
  return window.location.origin;
}

/**
 * Canonical URL (stable key):
 * - Always absolute
 * - Always rooted to *current origin* (no localhost → phi.network rewriting)
 * - Host-agnostic dedupe: foreign origins collapse to the same path on this host
 */
export function canonicalizeUrl(raw: string): string {
  try {
    const base = viewBaseOrigin();
    const u = new URL(raw, base);
    const rooted = new URL(`${u.pathname}${u.search}${u.hash}`, base);
    return rooted.toString();
  } catch {
    return raw;
  }
}

/** Attempt to parse hash from a /s/:hash URL (display only). */
export function parseHashFromUrl(url: string): string | undefined {
  try {
    const u = new URL(url, viewBaseOrigin());
    const m = u.pathname.match(/\/s\/([^/]+)/u);
    return m?.[1] ? decodeURIComponent(m[1]) : undefined;
  } catch {
    return undefined;
  }
}

/** True if url is the SMS-safe /p~<token> route (never browser-viewable). */
export function isPTildeUrl(url: string): boolean {
  try {
    const u = new URL(url, viewBaseOrigin());
    return u.pathname.toLowerCase().startsWith("/p~");
  } catch {
    return url.toLowerCase().includes("/p~");
  }
}

function safeDecodeURIComponent(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

export function looksLikeBareToken(s: string): boolean {
  const t = s.trim();
  if (t.length < 16) return false;
  return /^[A-Za-z0-9_-]+$/u.test(t);
}

/** Build a canonical stream URL from a bare token (Composer uses /stream/p/<token>). */
export function streamUrlFromToken(token: string): string {
  const base = viewBaseOrigin();
  return new URL(`/stream/p/${token}`, base).toString();
}

/** Build the WORKING hash-viewer URL for streams: /stream#p=<token> */
export function streamHashViewerUrlFromToken(token: string): string {
  const base = viewBaseOrigin();
  const u = new URL("/stream", base);
  const h = new URLSearchParams();
  h.set("p", token);
  u.hash = `#${h.toString()}`;
  return u.toString();
}

/** Convert `/stream/p/<token>` → `/stream#p=<token>` (preserves search + existing hash params). */
export function streamPPathToHashViewerUrl(raw: string): string {
  try {
    const base = viewBaseOrigin();
    const u = new URL(raw, base);
    const m = u.pathname.match(/\/stream\/p\/([^/]+)/u);
    if (!m?.[1]) return raw;

    const token = decodeURIComponent(m[1]);
    const out = new URL("/stream", base);

    // Preserve any query params (e.g. add=...) as-is.
    out.search = u.search;

    // Preserve existing hash params, but force `p=`.
    const hashStr = u.hash.startsWith("#") ? u.hash.slice(1) : "";
    const hp = new URLSearchParams(hashStr);
    hp.set("p", token);
    out.hash = `#${hp.toString()}`;

    return out.toString();
  } catch {
    return raw;
  }
}

/** Attempt to parse stream token from /stream/p/<token> or ?p=<token> or /p~<token> (identity help). */
export function parseStreamToken(url: string): string | undefined {
  try {
    const u = new URL(url, viewBaseOrigin());
    const path = u.pathname;

    // /stream/p/<token>
    const m = path.match(/\/stream\/p\/([^/]+)/u);
    if (m?.[1]) return decodeURIComponent(m[1]);

    // /p~<token>  (SMS-safe short route)
    const pm = path.match(/^\/p~([^/]+)/u);
    if (pm?.[1]) return decodeURIComponent(pm[1]);

    // query p=
    const p = u.searchParams.get("p");
    if (p) return p;

    const hashStr = u.hash.startsWith("#") ? u.hash.slice(1) : "";
    const h = new URLSearchParams(hashStr);
    const hp = h.get("p");
    if (hp) return hp;

    return undefined;
  } catch {
    const low = url.toLowerCase();
    const pm = low.match(/\/p~([^/?#]+)/u);
    if (pm?.[1]) return safeDecodeURIComponent(pm[1]);
    return undefined;
  }
}

/**
 * Browser-view normalization:
 * - /p~<token> → /stream#p=<token>
 * - /stream/p/<token> → /stream#p=<token>
 * (view-only; DOES NOT mutate stored registry URLs)
 */
export function browserViewUrl(u: string): string {
  const abs = canonicalizeUrl(u);

  // /p~<token> (never viewable) → hash-viewer
  if (isPTildeUrl(abs)) {
    const tok = parseStreamToken(abs);
    return tok ? canonicalizeUrl(streamHashViewerUrlFromToken(tok)) : abs;
  }

  // /stream/p/<token> → /stream#p=<token>
  const sp = streamPPathToHashViewerUrl(abs);
  if (sp !== abs) return canonicalizeUrl(sp);

  return abs;
}

/**
 * CLICK OPEN URL: force opens on the CURRENT host origin, preserving path/search/hash.
 * (Does NOT mutate stored URLs; view-only override for anchor clicks.)
 */
export function explorerOpenUrl(raw: string): string {
  if (!hasWindow) return browserViewUrl(raw);

  const safe = browserViewUrl(raw);
  const origin = window.location.origin;

  try {
    const u = new URL(safe, origin);
    return `${origin}${u.pathname}${u.search}${u.hash}`;
  } catch {
    const m = safe.match(/^(?:https?:\/\/[^/]+)?(\/.*)$/i);
    const rel = (m?.[1] ?? safe).startsWith("/") ? (m?.[1] ?? safe) : `/${m?.[1] ?? safe}`;
    return `${origin}${rel}`;
  }
}

export const extractPayloadFromUrl = extractPayloadFromUrlUtil;
export const getOriginUrl = getOriginUrlUtil;

/* ─────────────────────────────────────────────────────────────────────
 *  Content identity + parent-first /s grouping rules
 *  (used for tree grouping)
 *  ─────────────────────────────────────────────────────────────────── */
export type UrlKind = "postS" | "streamT" | "streamP" | "streamQ" | "stream" | "other";
export type ContentKind = "post" | "stream" | "other";

export function classifyUrlKind(u: string): UrlKind {
  try {
    const url = new URL(u, viewBaseOrigin());
    const path = url.pathname.toLowerCase();

    if (path.includes("/s/")) return "postS";
    if (path.startsWith("/p~")) return "streamP";

    const isStream = path.includes("/stream");
    if (!isStream) return "other";

    if (path.includes("/stream/p/")) return "streamP";

    const tQ = url.searchParams.get("t");
    if (tQ && tQ.trim()) return "streamT";

    const hashStr = url.hash.startsWith("#") ? url.hash.slice(1) : "";
    const h = new URLSearchParams(hashStr);
    const tH = h.get("t");
    if (tH && tH.trim()) return "streamT";

    if (path.includes("/stream/t")) return "streamT";

    const pQ = url.searchParams.get("p");
    if (pQ && pQ.trim()) return "streamQ";

    const pH = h.get("p");
    if (pH && pH.trim()) return "streamQ";

    return "stream";
  } catch {
    const low = u.toLowerCase();
    if (low.includes("/s/")) return "postS";
    if (low.includes("/p~")) return "streamP";
    if (low.includes("/stream/p/")) return "streamP";
    if (low.includes("/stream/t") || /[?&#]t=/.test(low)) return "streamT";
    if (low.includes("/stream") && /[?&#]p=/.test(low)) return "streamQ";
    if (low.includes("/stream")) return "stream";
    return "other";
  }
}

export function contentKindForUrl(u: string): ContentKind {
  const k = classifyUrlKind(u);
  if (k === "postS") return "post";
  if (k.startsWith("stream")) return "stream";
  return "other";
}

function readPhiKeyFromPayload(p: SigilSharePayloadLoose): string {
  const rec = p as unknown as Record<string, unknown>;
  return (
    (typeof rec.userPhiKey === "string" && rec.userPhiKey) ||
    (typeof rec.phiKey === "string" && rec.phiKey) ||
    (typeof rec.phikey === "string" && rec.phikey) ||
    ""
  );
}

/**
 * Moment key (kindless): used to group /s + /stream nodes that represent the SAME moment.
 * Priority: (phiKey+pulse) > kaiSignature > token > hash/time fallback.
 */
export function momentKeyFor(url: string, p: SigilSharePayloadLoose): string {
  const phiKey = readPhiKeyFromPayload(p);
  const pulse = Number.isFinite(p.pulse ?? NaN) ? (p.pulse as number) : null;

  if (phiKey && pulse != null) return `k:${phiKey}|${pulse}`;

  const sig = typeof p.kaiSignature === "string" ? p.kaiSignature.trim() : "";
  if (sig) return `sig:${sig}`;

  const tok = parseStreamToken(url);
  if (tok && tok.trim()) return `tok:${tok.trim()}`;

  const h = parseHashFromUrl(url) ?? "";
  if (h) return `h:${h}`;

  return `u:${canonicalizeUrl(url)}`;
}

/**
 * Content identity (kind-aware):
 * - /s posts are keyed by hash if available
 * - streams are moment-true by (phiKey|pulse)
 * - fallbacks remain for rare cases
 */
export function contentIdFor(url: string, p: SigilSharePayloadLoose): string {
  const kind = contentKindForUrl(url);

  const h = parseHashFromUrl(url) ?? "";
  if (kind === "post" && h) return `post:${h}`;

  const phiKey = readPhiKeyFromPayload(p);
  const pulse = Number.isFinite(p.pulse ?? NaN) ? (p.pulse as number) : null;
  if (kind === "stream" && phiKey && pulse != null) return `stream:${phiKey}|${pulse}`;

  const sig = typeof p.kaiSignature === "string" ? p.kaiSignature.trim() : "";
  if (sig) return `${kind}:sig:${sig}`;

  const tok = parseStreamToken(url);
  if (tok && tok.trim()) return `${kind}:tok:${tok.trim()}`;

  return `${kind}:u:${canonicalizeUrl(url)}`;
}

const isPackedViewerUrl = (raw: string): boolean => {
  const u = raw.toLowerCase();
  if (!u.includes("/stream")) return false;

  const hasPackedSignals = u.includes("root=") || u.includes("&seg=") || u.includes("&add=");
  const isHashViewer = u.includes("/stream#") || u.includes("#v=");

  return hasPackedSignals && isHashViewer;
};

export function scoreUrlForView(u: string, prefer: ContentKind): number {
  if (isPTildeUrl(u)) return -1e9;

  const url = u.toLowerCase();
  const kind = classifyUrlKind(u);
  let s = 0;

  if (isPackedViewerUrl(url)) s -= 10_000;

  if (prefer === "post") {
    if (kind === "postS") s += 220;
    else s -= 25;
  } else if (prefer === "stream") {
    if (kind === "streamT") s += 220;
    else if (kind === "streamP") s += 190;
    else if (kind === "streamQ") s += 175;
    else if (kind === "stream") s += 160;
    else if (kind === "postS") s += 80;
    else s -= 25;
  } else {
    if (kind === "postS") s += 120;
    if (kind === "streamT") s += 125;
    if (kind === "streamP") s += 105;
    if (kind === "streamQ" || kind === "stream") s += 95;
  }

  const viewBase = viewBaseOrigin().toLowerCase();
  if (url.startsWith(viewBase)) s += 12;
  if (url.startsWith(LIVE_BASE_URL.toLowerCase())) s += 10;
  if (url.startsWith(LIVE_BACKUP_URL.toLowerCase())) s += 10;

  const h = urlHealth.get(canonicalizeUrl(u));
  if (h === 1) s += 200;
  if (h === -1) s -= 200;

  s += Math.max(0, 20 - Math.floor(u.length / 40));

  return s;
}

export function pickPrimaryUrl(urls: string[], prefer: ContentKind): string {
  const nonPTilde = urls.filter((u) => !isPTildeUrl(u));
  const candidates = nonPTilde.length > 0 ? nonPTilde : urls;

  // If only /p~ exists, choose a viewable stream URL by token.
  if (nonPTilde.length === 0 && urls.length > 0) {
    const tok = parseStreamToken(urls[0] ?? "");
    if (tok) return canonicalizeUrl(streamHashViewerUrlFromToken(tok));
  }

  let best = candidates[0] ?? "";
  let bestScore = -1e9;

  for (const u of candidates) {
    const sc = scoreUrlForView(u, prefer);
    if (sc > bestScore || (sc === bestScore && u.length < best.length)) {
      best = u;
      bestScore = sc;
    }
  }
  return best;
}

/* ─────────────────────────────────────────────────────────────────────
 *  CSS escape (for querySelector)
 *  ─────────────────────────────────────────────────────────────────── */
export function cssEscape(s: string): string {
  const w = hasWindow ? (window as unknown as { CSS?: { escape?: (v: string) => string } }) : null;
  const esc = w?.CSS?.escape;
  if (typeof esc === "function") return esc(s);
  return s.replace(/["\\]/g, "\\$&");
}
