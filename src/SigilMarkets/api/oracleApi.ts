// SigilMarkets/api/oracleApi.ts
"use client";

/* eslint-disable @typescript-eslint/consistent-type-definitions */

/**
 * SigilMarkets — oracleApi
 *
 * MVP responsibilities:
 * - Provide a simple interface for:
 *   - proposing a resolution (optional)
 *   - finalizing a resolution
 *
 * This module intentionally does NOT decide policy.
 * It just transports/normalizes "resolution objects" for stores to apply.
 */

import type { KaiMoment, KaiPulse, MarketId, MarketOutcome } from "../types/marketTypes";
import { asEvidenceHash } from "../types/marketTypes";

import type {
  EvidenceBundle,
  EvidenceItem,
  OracleResolutionFinal,
  OracleResolutionProposal,
  OracleSig,
  OracleSigner,
  ResolutionSigilPayloadV1,
  EvidenceUrl,
} from "../types/oracleTypes";

import { asEvidenceBundleHash, asEvidenceUrl, asOracleDecisionId } from "../types/oracleTypes";
import type { MarketOraclePolicy } from "../types/marketTypes";
import type { KaiSignature, UserPhiKey } from "../types/vaultTypes";
import { sha256Hex } from "../utils/ids";

type UnknownRecord = Record<string, unknown>;
const isString = (v: unknown): v is string => typeof v === "string";

/** Typed guards (safe + clean) */
const isUrlItem = (item: EvidenceItem): item is Extract<EvidenceItem, { kind: "url" }> => item.kind === "url";
const isHashItem = (item: EvidenceItem): item is Extract<EvidenceItem, { kind: "hash" }> => item.kind === "hash";

export type SigilMarketsOracleApiConfig = Readonly<{
  /** Optional remote base for oracle actions. If absent, oracleApi is local-only. */
  baseUrl?: string;
  /** Endpoint path for posting a resolution proposal. Default: "/oracle/propose" */
  proposePath?: string;
  /** Endpoint path for finalizing a resolution. Default: "/oracle/finalize" */
  finalizePath?: string;
  /**
   * Optional request auth hook for remote oracle actions.
   * Allows adding headers like signatures or identities.
   */
  buildAuthHeaders?: (args: Readonly<{ url: string; body: unknown; bodyHash: string; method: "POST" }>) => Promise<Record<string, string>>;
  /** Optional request timeout in ms. Default: 8_000 */
  requestTimeoutMs?: number;
  /** Optional request retry count (retries only for transient failures). Default: 2 */
  requestMaxRetries?: number;
  /** Optional retry delay in ms. Default: 500 */
  requestRetryDelayMs?: number;
  /** Wire format for payloads. Default: "wrapped" */
  wireFormat?: "wrapped" | "raw";
}>;

export type OracleActionResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: string }>;

export const defaultOracleApiConfig = (): SigilMarketsOracleApiConfig => {
  const g = globalThis as unknown as UnknownRecord;
  const base = isString(g["__SIGIL_MARKETS_ORACLE_API_BASE__"])
    ? (g["__SIGIL_MARKETS_ORACLE_API_BASE__"] as string)
    : undefined;

  return { baseUrl: base, proposePath: "/oracle/propose", finalizePath: "/oracle/finalize" };
};

const normalizeOracleCfg = (cfg: SigilMarketsOracleApiConfig): Required<Pick<SigilMarketsOracleApiConfig, "proposePath" | "finalizePath">> &
  Pick<SigilMarketsOracleApiConfig, "baseUrl"> => {
  return {
    baseUrl: cfg.baseUrl,
    proposePath: cfg.proposePath ?? "/oracle/propose",
    finalizePath: cfg.finalizePath ?? "/oracle/finalize",
  };
};

const joinUrl = (baseUrl: string, path: string): string => {
  const base = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
};

const safeReadText = async (r: Response): Promise<string> => {
  try {
    return await r.text();
  } catch {
    return "";
  }
};

const DEFAULT_REQUEST_TIMEOUT_MS = 8_000;
const DEFAULT_REQUEST_MAX_RETRIES = 2;
const DEFAULT_REQUEST_RETRY_DELAY_MS = 500;

const stableNormalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map((v) => stableNormalize(v));
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const out: Record<string, unknown> = {};
    for (const key of keys) {
      const v = obj[key];
      if (v === undefined) continue;
      out[key] = stableNormalize(v);
    }
    return out;
  }
  return value;
};

const stableStringify = (value: unknown): string => {
  return JSON.stringify(stableNormalize(value)) ?? "null";
};

const isRetryableStatus = (status: number): boolean => status === 502 || status === 503 || status === 504;

const delay = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const postJsonWithRetry = async (
  url: string,
  body: unknown,
  opts?: Readonly<{
    timeoutMs?: number;
    maxRetries?: number;
    retryDelayMs?: number;
    buildAuthHeaders?: (args: Readonly<{ url: string; body: unknown; bodyHash: string; method: "POST" }>) => Promise<Record<string, string>>;
  }>
): Promise<OracleActionResult<true>> => {
  if (typeof fetch !== "function") {
    return { ok: false, error: "fetch is not available in this environment" };
  }

  const timeoutMs = typeof opts?.timeoutMs === "number" ? Math.max(0, Math.trunc(opts.timeoutMs)) : DEFAULT_REQUEST_TIMEOUT_MS;
  const maxRetries =
    typeof opts?.maxRetries === "number" ? Math.max(0, Math.trunc(opts.maxRetries)) : DEFAULT_REQUEST_MAX_RETRIES;
  const retryDelayMs =
    typeof opts?.retryDelayMs === "number" ? Math.max(0, Math.trunc(opts.retryDelayMs)) : DEFAULT_REQUEST_RETRY_DELAY_MS;

  let bodyString: string;
  let bodyHash: string;
  try {
    bodyString = JSON.stringify(body);
    bodyHash = await sha256Hex(stableStringify(body));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return { ok: false, error: `oracle request body stringify failed: ${msg}` };
  }

  let lastError = "";

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeoutId =
      controller && timeoutMs > 0
        ? setTimeout(() => {
            controller.abort();
          }, timeoutMs)
        : null;

    try {
      const authHeaders = opts?.buildAuthHeaders
        ? await opts.buildAuthHeaders({ url, body, bodyHash, method: "POST" })
        : undefined;

      const headers: Record<string, string> = {
        "content-type": "application/json",
        "x-sm-body-hash": bodyHash,
        ...(authHeaders ?? {}),
      };

      const res = await fetch(url, {
        method: "POST",
        headers,
        body: bodyString,
        signal: controller?.signal,
      });

      if (timeoutId != null) clearTimeout(timeoutId);

      if (!res.ok) {
        const t = await safeReadText(res);
        const err = `oracle remote error ${res.status}: ${t || res.statusText}`;
        lastError = err;
        if (isRetryableStatus(res.status) && attempt < maxRetries) {
          if (retryDelayMs > 0) await delay(retryDelayMs);
          continue;
        }
        return { ok: false, error: err };
      }

      // Allow either empty 204 or JSON/text bodies.
      return { ok: true, value: true };
    } catch (e) {
      if (timeoutId != null) clearTimeout(timeoutId);
      const msg =
        e instanceof Error
          ? e.name === "AbortError"
            ? `timeout after ${timeoutMs}ms`
            : e.message
          : "unknown error";
      const err = `oracle remote request failed: ${msg}`;
      lastError = err;
      if (attempt < maxRetries) {
        if (retryDelayMs > 0) await delay(retryDelayMs);
        continue;
      }
      return { ok: false, error: err };
    }
  }

  return { ok: false, error: lastError || "oracle remote request failed" };
};

/**
 * Canonicalize minimal evidence bundle and optionally compute a bundle hash.
 *
 * Fix:
 * - Produces real EvidenceItem types (EvidenceUrl / EvidenceHash branded values).
 * - Uses EvidenceUrl explicitly (no unused import).
 */
export const canonicalizeEvidenceBundle = async (bundle?: EvidenceBundle): Promise<EvidenceBundle | undefined> => {
  if (!bundle) return undefined;

  const normalized: EvidenceItem[] = [];

  for (const it of bundle.items) {
    if (it.kind === "url") {
      const raw = (it.url as unknown as string).trim();
      if (raw.length === 0) continue;

      // ✅ Use the branded EvidenceUrl type explicitly
      const url: EvidenceUrl = asEvidenceUrl(raw);

      normalized.push({
        kind: "url",
        url,
        label: it.label,
        note: it.note,
      });
      continue;
    }

    // hash
    const raw = (it.hash as unknown as string).trim();
    if (raw.length === 0) continue;

    normalized.push({
      kind: "hash",
      hash: asEvidenceHash(raw),
      label: it.label,
      note: it.note,
    });
  }

  // Data used for hashing: stable minimal representation (no label/note).
  const data = {
    items: normalized.map((it) =>
      it.kind === "url"
        ? { kind: "url" as const, url: it.url }
        : { kind: "hash" as const, hash: it.hash },
    ),
    summary: bundle.summary ?? "",
  };

  const bundleHash = await sha256Hex(JSON.stringify(data));

  return {
    items: normalized,
    summary: bundle.summary,
    bundleHash: asEvidenceBundleHash(bundleHash),
  };
};

/**
 * Canonicalize evidence bundle (V2):
 * - Sorts and dedupes url/hash items before hashing.
 * - Keeps v1 behavior intact for legacy verification.
 */
export const canonicalizeEvidenceBundleV2 = async (bundle?: EvidenceBundle): Promise<EvidenceBundle | undefined> => {
  if (!bundle) return undefined;

  const normalized: EvidenceItem[] = [];
  for (const it of bundle.items) {
    if (it.kind === "url") {
      const raw = (it.url as unknown as string).trim();
      if (raw.length === 0) continue;
      const url: EvidenceUrl = asEvidenceUrl(raw);
      normalized.push({
        kind: "url",
        url,
        label: it.label,
        note: it.note,
      });
      continue;
    }

    const raw = (it.hash as unknown as string).trim();
    if (raw.length === 0) continue;

    normalized.push({
      kind: "hash",
      hash: asEvidenceHash(raw),
      label: it.label,
      note: it.note,
    });
  }

  const byKey = new Map<string, EvidenceItem>();
  for (const it of normalized) {
    const key = it.kind === "url" ? `url:${it.url}` : `hash:${it.hash}`;
    if (!byKey.has(key)) byKey.set(key, it);
  }

  const deduped = Array.from(byKey.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, it]) => it);

  const data = {
    items: deduped.map((it) =>
      it.kind === "url"
        ? { kind: "url" as const, url: it.url }
        : { kind: "hash" as const, hash: it.hash },
    ),
    summary: bundle.summary ?? "",
  };

  const bundleHash = await sha256Hex(JSON.stringify(data));

  return {
    items: deduped,
    summary: bundle.summary,
    bundleHash: asEvidenceBundleHash(bundleHash),
  };
};

const canonicalizeEvidenceBundleByVersion = async (
  evidence: EvidenceBundle | undefined,
  version?: "v1" | "v2"
): Promise<EvidenceBundle | undefined> => {
  return version === "v2" ? canonicalizeEvidenceBundleV2(evidence) : canonicalizeEvidenceBundle(evidence);
};

/**
 * Local "proposal" creation:
 * - Generates deterministic decisionId from (marketId, outcome, proposedPulse, oracle provider)
 */
export const createLocalProposal = async (args: Readonly<{
  marketId: MarketId;
  outcome: MarketOutcome;
  proposedPulse: KaiPulse;
  oracle: MarketOraclePolicy;
  evidence?: EvidenceBundle;
  attestations?: readonly Readonly<{ signer: OracleSigner; sig: OracleSig; atPulse: KaiPulse; weight?: number }>[];
  evidenceHashVersion?: "v1" | "v2";
}>): Promise<OracleResolutionProposal> => {
  const ev = await canonicalizeEvidenceBundleByVersion(args.evidence, args.evidenceHashVersion);

  const key = `SM:ORACLE:PROPOSE:${args.marketId}:${args.outcome}:${args.proposedPulse}:${args.oracle.provider}:${args.oracle.oracleId ?? ""}`;
  const h = await sha256Hex(key);

  return {
    decisionId: asOracleDecisionId(`dec_${h.slice(0, 40)}`),
    marketId: args.marketId,
    outcome: args.outcome,
    proposedPulse: args.proposedPulse,
    oracle: args.oracle,
    evidence: ev,
    attestations: args.attestations,
  };
};

/**
 * Local "finalization" creation:
 * - Can reference a proposal or finalize directly
 */
export const createLocalFinalization = async (args: Readonly<{
  proposal?: OracleResolutionProposal;
  marketId: MarketId;
  outcome: MarketOutcome;
  finalPulse: KaiPulse;
  oracle: MarketOraclePolicy;
  evidence?: EvidenceBundle;
  finalAttestations?: readonly Readonly<{ signer: OracleSigner; sig: OracleSig; atPulse: KaiPulse; weight?: number }>[];
  dispute?: OracleResolutionFinal["dispute"];
  evidenceHashVersion?: "v1" | "v2";
}>): Promise<OracleResolutionFinal> => {
  const ev = await canonicalizeEvidenceBundleByVersion(args.evidence ?? args.proposal?.evidence, args.evidenceHashVersion);

  const baseKey = args.proposal
    ? `SM:ORACLE:FINAL:${args.proposal.decisionId}:${args.finalPulse}`
    : `SM:ORACLE:FINAL:${args.marketId}:${args.outcome}:${args.finalPulse}:${args.oracle.provider}:${args.oracle.oracleId ?? ""}`;

  const h = await sha256Hex(baseKey);
  const decisionId = args.proposal ? args.proposal.decisionId : asOracleDecisionId(`dec_${h.slice(0, 40)}`);

  return {
    decisionId,
    marketId: args.marketId,
    outcome: args.outcome,
    finalPulse: args.finalPulse,
    oracle: args.oracle,
    proposedPulse: args.proposal?.proposedPulse,
    evidence: ev,
    dispute: args.dispute,
    finalAttestations: args.finalAttestations,
  };
};

/**
 * Mint a Resolution Sigil payload (portable proof).
 * Rendering the SVG happens in sigils/ResolutionSigilMint.tsx.
 */
export const makeResolutionSigilPayload = async (args: Readonly<{
  marketId: MarketId;
  outcome: MarketOutcome;
  oracle: MarketOraclePolicy;
  proposedPulse?: KaiPulse;
  finalPulse: KaiPulse;
  evidence?: EvidenceBundle;
  evidenceHashVersion?: "v1" | "v2";
  mintedAt: KaiMoment;
  mintedBy?: Readonly<{ userPhiKey: UserPhiKey; kaiSignature: KaiSignature }>;
  label?: string;
}>): Promise<ResolutionSigilPayloadV1> => {
  const ev = await canonicalizeEvidenceBundleByVersion(args.evidence, args.evidenceHashVersion);

  return {
    v: "SM-RES-1",
    kind: "resolution",
    marketId: args.marketId,
    outcome: args.outcome,
    oracle: args.oracle,
    proposedPulse: args.proposedPulse,
    finalPulse: args.finalPulse,
    evidence: ev
      ? {
          bundleHash: ev.bundleHash,
          urls: ev.items.filter(isUrlItem).map((i) => (i.url as unknown as string)),
          hashes: ev.items.filter(isHashItem).map((i) => (i.hash as unknown as string)),
          summary: ev.summary,
        }
      : undefined,
    attestations: undefined,
    mintedBy: args.mintedBy ? { userPhiKey: args.mintedBy.userPhiKey, kaiSignature: args.mintedBy.kaiSignature } : undefined,
    mintedAt: args.mintedAt,
    label: args.label,
  };
};

/**
 * Remote calls (optional):
 * - If cfg.baseUrl is present, POST the proposal/finalization to the configured endpoints.
 * - If absent, return a clear offline/local-only error (still MVP-safe).
 *
 * NOTE: We intentionally keep the response contract minimal (true/false) so
 * stores can stay deterministic/offline-first while still enabling "remote-ready".
 */
export const postProposal = async (
  cfg: SigilMarketsOracleApiConfig,
  proposal: OracleResolutionProposal,
): Promise<OracleActionResult<true>> => {
  const c = normalizeOracleCfg(cfg);
  if (!c.baseUrl) return { ok: false, error: "oracleApi is local-only (no baseUrl configured)" };

  const url = joinUrl(c.baseUrl, c.proposePath);

  const wireFormat = cfg.wireFormat ?? "wrapped";
  const body = wireFormat === "raw" ? proposal : { proposal };
  return await postJsonWithRetry(url, body, {
    timeoutMs: cfg.requestTimeoutMs,
    maxRetries: cfg.requestMaxRetries,
    retryDelayMs: cfg.requestRetryDelayMs,
    buildAuthHeaders: cfg.buildAuthHeaders,
  });
};

export const postFinalization = async (
  cfg: SigilMarketsOracleApiConfig,
  finalization: OracleResolutionFinal,
): Promise<OracleActionResult<true>> => {
  const c = normalizeOracleCfg(cfg);
  if (!c.baseUrl) return { ok: false, error: "oracleApi is local-only (no baseUrl configured)" };

  const url = joinUrl(c.baseUrl, c.finalizePath);

  const wireFormat = cfg.wireFormat ?? "wrapped";
  const body = wireFormat === "raw" ? finalization : { finalization };
  return await postJsonWithRetry(url, body, {
    timeoutMs: cfg.requestTimeoutMs,
    maxRetries: cfg.requestMaxRetries,
    retryDelayMs: cfg.requestRetryDelayMs,
    buildAuthHeaders: cfg.buildAuthHeaders,
  });
};
