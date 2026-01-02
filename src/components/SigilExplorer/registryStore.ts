// src/components/SigilExplorer/registryStore.ts
"use client";

import type { FeedPostPayload } from "../../utils/feedPayload";
import type { Registry, SigilSharePayloadLoose } from "./types";
import { USERNAME_CLAIM_KIND, type UsernameClaimPayload } from "../../types/usernameClaim";
import { ingestUsernameClaimGlyph } from "../../utils/usernameClaimRegistry";
import { normalizeClaimGlyphRef, normalizeUsername } from "../../utils/usernameClaim";
import { resolveLineageBackwards } from "../../utils/sigilUrl";
import { getInMemorySigilUrls } from "../../utils/sigilRegistry";
import { markConfirmedByNonce } from "../../utils/sendLedger";
import {
  canonicalizeUrl,
  extractPayloadFromUrl,
  isPTildeUrl,
  looksLikeBareToken,
  parseStreamToken,
  streamUrlFromToken,
} from "./url";
import { byKaiTime } from "./format";
import { enqueueInhaleKrystal } from "./inhaleQueue";

export const REGISTRY_LS_KEY = "kai:sigils:v1"; // explorer’s persisted URL list
export const MODAL_FALLBACK_LS_KEY = "sigil:urls"; // composer/modal fallback URL list
const BC_NAME = "kai-sigil-registry";

const WITNESS_ADD_MAX = 512;

const hasWindow = typeof window !== "undefined";
const canStorage = hasWindow && typeof window.localStorage !== "undefined";
let registryHydrated = false;

export const memoryRegistry: Registry = new Map();
const channel = hasWindow && "BroadcastChannel" in window ? new BroadcastChannel(BC_NAME) : null;

export type AddSource = "local" | "remote" | "hydrate" | "import";

export type AddUrlOptions = {
  includeAncestry?: boolean;
  broadcast?: boolean;
  persist?: boolean;
  source?: AddSource;
  enqueueToApi?: boolean;
};

export function isOnline(): boolean {
  if (!hasWindow) return false;
  if (typeof navigator === "undefined") return true;
  return navigator.onLine;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function readStringField(obj: unknown, key: string): string | undefined {
  if (!isRecord(obj)) return undefined;
  const v = obj[key];
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t : undefined;
}

function readTransferDirectionValue(value: unknown): "send" | "receive" | null {
  if (typeof value !== "string") return null;
  const t = value.trim().toLowerCase();
  if (!t) return null;
  if (t.includes("receive") || t.includes("received") || t.includes("inhale")) return "receive";
  if (t.includes("send") || t.includes("sent") || t.includes("exhale")) return "send";
  return null;
}

function readTransferDirectionFromPayload(payload: SigilSharePayloadLoose): "send" | "receive" | null {
  const record = payload as unknown as Record<string, unknown>;
  return (
    readTransferDirectionValue(record.transferDirection) ||
    readTransferDirectionValue(record.transferMode) ||
    readTransferDirectionValue(record.transferKind) ||
    readTransferDirectionValue(record.phiDirection)
  );
}

function safeDecodeURIComponent(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

/* ─────────────────────────────────────────────────────────────────────
 *  Witness chain extraction + derived context
 *  ─────────────────────────────────────────────────────────────────── */

type WitnessCtx = {
  chain: string[]; // origin..parent (URLs), from #add=
  originUrl?: string;
  parentUrl?: string;
};

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

    return out.slice(-WITNESS_ADD_MAX);
  } catch {
    return [];
  }
}

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

function mergePayloadLineage(payload: SigilSharePayloadLoose): SigilSharePayloadLoose {
  const record = payload as Record<string, unknown>;
  let parentUrl = payload.parentUrl;
  let originUrl = payload.originUrl;

  const parentHash = readStringField(record, "parentHash") ?? readStringField(record, "parentCanonical");
  if (!parentUrl && parentHash) parentUrl = canonicalizeUrl(`/s/${parentHash}`);

  const originHash = readStringField(record, "originHash") ?? readStringField(record, "originCanonical");
  if (!originUrl && originHash) originUrl = canonicalizeUrl(`/s/${originHash}`);

  if (!originUrl && parentUrl) originUrl = parentUrl;

  if (parentUrl === payload.parentUrl && originUrl === payload.originUrl) return payload;
  return { ...payload, parentUrl, originUrl };
}

/* ─────────────────────────────────────────────────────────────────────
 *  Registry helpers
 *  ─────────────────────────────────────────────────────────────────── */

function ingestUsernameClaimEvidence(url: string, payload: SigilSharePayloadLoose): void {
  const feed = (payload as { feed?: unknown }).feed as FeedPostPayload | undefined;
  if (!feed) return;

  const claimEvidence = (feed as FeedPostPayload & { usernameClaim?: unknown }).usernameClaim;

  const normalizedFromClaim = claimEvidence
    ? normalizeUsername(
        (claimEvidence as { payload?: { normalized?: string; username?: string } }).payload?.normalized ||
          (claimEvidence as { payload?: { normalized?: string; username?: string } }).payload?.username ||
          "",
      )
    : "";

  const normalizedFromAuthor = normalizeUsername(feed.author ?? "");
  const normalizedUsername = normalizedFromClaim || normalizedFromAuthor;

  if (!normalizedUsername) return;
  if (!claimEvidence) return;

  const claimHash = normalizeClaimGlyphRef((claimEvidence as { hash?: string }).hash ?? "");
  const claimUrl = (claimEvidence as { url?: string }).url?.trim() || url;

  if (!claimHash || !claimUrl) return;

  const payloadObj = (claimEvidence as { payload?: unknown }).payload as UsernameClaimPayload | undefined;

  if (!payloadObj || payloadObj.kind !== USERNAME_CLAIM_KIND) return;

  const normalizedPayloadUser =
    normalizeUsername(payloadObj.normalized || payloadObj.username || "") || normalizedUsername;

  if (normalizedPayloadUser !== normalizedUsername) return;

  const ownerHint = (claimEvidence as { ownerHint?: string | null }).ownerHint ?? payloadObj.ownerHint ?? null;

  ingestUsernameClaimGlyph({
    hash: claimHash,
    url: canonicalizeUrl(claimUrl),
    payload: { ...payloadObj, normalized: normalizedPayloadUser },
    ownerHint,
  });
}

/** Upsert a payload into registry; returns true if materially changed. */
function upsertRegistryPayload(url: string, payload: SigilSharePayloadLoose): boolean {
  const key = canonicalizeUrl(url);

  ingestUsernameClaimEvidence(key, payload);

  const prev = memoryRegistry.get(key);
  if (!prev) {
    memoryRegistry.set(key, payload);
    return true;
  }

  const prevParent = prev.parentUrl ?? "";
  const prevOrigin = prev.originUrl ?? "";
  const nextParent = payload.parentUrl ?? "";
  const nextOrigin = payload.originUrl ?? "";

  const topoChanged = prevParent !== nextParent || prevOrigin !== nextOrigin;

  const prevKeys = Object.keys(prev as unknown as Record<string, unknown>).length;
  const nextKeys = Object.keys(payload as unknown as Record<string, unknown>).length;
  const richnessChanged = nextKeys !== prevKeys;

  const kaiChanged = byKaiTime(prev, payload) !== 0;

  if (topoChanged || richnessChanged || kaiChanged) {
    memoryRegistry.set(key, payload);
    return true;
  }

  return false;
}

function ensureUrlInRegistry(url: string): boolean {
  const abs = canonicalizeUrl(url);
  const extracted = extractPayloadFromUrl(abs);
  if (!extracted) return false;

  const ctx = deriveWitnessContext(abs);
  const merged = mergeDerivedContext(extracted, ctx);

  return upsertRegistryPayload(abs, merged);
}

function synthesizeEdgesFromWitnessChain(chain: readonly string[], leafUrl: string): boolean {
  if (chain.length === 0) return false;

  const origin = canonicalizeUrl(chain[0]);
  let changed = false;

  changed = ensureUrlInRegistry(origin) || changed;

  {
    const p = memoryRegistry.get(origin);
    if (p) {
      const next: SigilSharePayloadLoose = { ...p };
      if (!next.originUrl) next.originUrl = origin;
      changed = upsertRegistryPayload(origin, next) || changed;
    }
  }

  for (let i = 1; i < chain.length; i++) {
    const child = canonicalizeUrl(chain[i]);
    const parent = canonicalizeUrl(chain[i - 1]);

    changed = ensureUrlInRegistry(child) || changed;

    const p = memoryRegistry.get(child);
    if (p) {
      const next: SigilSharePayloadLoose = { ...p };
      if (!next.originUrl) next.originUrl = origin;
      if (!next.parentUrl) next.parentUrl = parent;
      changed = upsertRegistryPayload(child, next) || changed;
    }
  }

  const leafAbs = canonicalizeUrl(leafUrl);
  const leafPayload = memoryRegistry.get(leafAbs);
  if (leafPayload) {
    const next: SigilSharePayloadLoose = { ...leafPayload };
    if (!next.originUrl) next.originUrl = origin;
    if (!next.parentUrl) next.parentUrl = canonicalizeUrl(chain[chain.length - 1]);
    changed = upsertRegistryPayload(leafAbs, next) || changed;
  }

  return changed;
}

/* ─────────────────────────────────────────────────────────────────────
 *  Storage + hydrate
 *  ─────────────────────────────────────────────────────────────────── */

export function persistRegistryToStorage(): void {
  if (!canStorage) return;
  const urls = Array.from(memoryRegistry.keys());
  try {
    localStorage.setItem(REGISTRY_LS_KEY, JSON.stringify(urls));
  } catch {
    // ignore quota issues
  }
}

/** Hydrate persisted URLs into registry without broadcasting; no auto inhale here. */
export function hydrateRegistryFromStorage(): boolean {
  if (!hasWindow) return false;

  const ingestList = (raw: string | null): boolean => {
    if (!raw) return false;
    try {
      const urls: unknown = JSON.parse(raw);
      if (!Array.isArray(urls)) return false;

      let changed = false;

      for (const u of urls) {
        if (typeof u !== "string") continue;
        if (
          addUrl(u, {
            includeAncestry: true,
            broadcast: false,
            persist: false,
            source: "hydrate",
            enqueueToApi: false,
          })
        ) {
          changed = true;
        }
      }

      return changed;
    } catch {
      return false;
    }
  };

  const changedA = canStorage ? ingestList(localStorage.getItem(REGISTRY_LS_KEY)) : false;
  const changedB = canStorage ? ingestList(localStorage.getItem(MODAL_FALLBACK_LS_KEY)) : false;
  const changedC = ingestList(JSON.stringify(getInMemorySigilUrls()));

  if (changedA || changedB || changedC) persistRegistryToStorage();
  return changedA || changedB || changedC;
}

export function ensureRegistryHydrated(): boolean {
  if (registryHydrated) return false;
  registryHydrated = true;
  return hydrateRegistryFromStorage();
}

/* ─────────────────────────────────────────────────────────────────────
 *  Add URL (local registry) — deterministic ingest + optional inhale enqueue
 *  ─────────────────────────────────────────────────────────────────── */

export function addUrl(url: string, opts?: AddUrlOptions): boolean {
  const abs = canonicalizeUrl(url);

  const extracted = extractPayloadFromUrl(abs);
  if (!extracted) return false;

  const includeAncestry = opts?.includeAncestry ?? true;
  const broadcast = opts?.broadcast ?? true;
  const persist = opts?.persist ?? true;
  const source = opts?.source ?? "local";
  const enqueueToApi = opts?.enqueueToApi ?? source === "local";

  let changed = false;

  const ctx = deriveWitnessContext(abs);
  const mergedLeaf = mergeDerivedContext(mergePayloadLineage(extracted), ctx);
  changed = upsertRegistryPayload(abs, mergedLeaf) || changed;

  if (readTransferDirectionFromPayload(extracted) === "receive") {
    const record = extracted as unknown as Record<string, unknown>;
    const parentHash = readStringField(record, "parentHash");
    const nonce = readStringField(record, "transferNonce") ?? readStringField(record, "nonce");
    if (parentHash && nonce) markConfirmedByNonce(parentHash, nonce);
  }

  if (includeAncestry && ctx.chain.length > 0) {
    for (const link of ctx.chain) changed = ensureUrlInRegistry(link) || changed;
    changed = synthesizeEdgesFromWitnessChain(ctx.chain, abs) || changed;
  }

  if (includeAncestry) {
    const fallbackChain = resolveLineageBackwards(abs);
    for (const link of fallbackChain) {
      const key = canonicalizeUrl(link);
      const p = extractPayloadFromUrl(key);
      if (!p) continue;
      const pCtx = deriveWitnessContext(key);
      const merged = mergeDerivedContext(p, pCtx);
      changed = upsertRegistryPayload(key, merged) || changed;
    }
  }

  if (changed) {
    if (persist) persistRegistryToStorage();
    if (channel && broadcast) channel.postMessage({ type: "sigil:add", url: abs });

    if (enqueueToApi) {
      const latest = memoryRegistry.get(abs);
      if (latest) enqueueInhaleKrystal(abs, latest);
    }
  }

  return changed;
}

/* ─────────────────────────────────────────────────────────────────────
 *  Import JSON (urls + optional krystals)
 *  ─────────────────────────────────────────────────────────────────── */

export function parseImportedJson(value: unknown): { urls: string[]; rawKrystals: Record<string, unknown>[] } {
  const urls: string[] = [];
  const rawKrystals: Record<string, unknown>[] = [];

  const pushUrl = (u: string) => {
    const abs = canonicalizeUrl(u);
    if (!urls.includes(abs)) urls.push(abs);
  };

  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string") {
        if (item.trim()) pushUrl(item.trim());
        continue;
      }
      if (isRecord(item)) {
        const u = item.url;
        if (typeof u === "string" && u.trim()) {
          const abs = canonicalizeUrl(u.trim());
          if (!urls.includes(abs)) urls.push(abs);
          rawKrystals.push({ ...item, url: abs });
        }
      }
    }
    return { urls, rawKrystals };
  }

  if (isRecord(value)) {
    const maybeUrls = value.urls;
    if (Array.isArray(maybeUrls)) {
      for (const item of maybeUrls) {
        if (typeof item === "string" && item.trim()) pushUrl(item.trim());
      }
    }

    const u = value.url;
    if (typeof u === "string" && u.trim()) {
      const abs = canonicalizeUrl(u.trim());
      if (!urls.includes(abs)) urls.push(abs);
      rawKrystals.push({ ...value, url: abs });
    }

    return { urls, rawKrystals };
  }

  return { urls, rawKrystals };
}
