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
 * - In standalone mode, this can be purely local/admin.
 * - In integrated deployments, this will be backed by your Phi Network endpoints.
 *
 * This module intentionally does NOT decide policy.
 * It just transports/normalizes "resolution objects" for stores to apply.
 */

import type { KaiMoment, KaiPulse, MarketId, MarketOutcome } from "../types/marketTypes";
import type {
  EvidenceBundle,
  EvidenceItem,
  OracleResolutionFinal,
  OracleResolutionProposal,
  OracleSig,
  OracleSigner,
  ResolutionSigilArtifact,
  ResolutionSigilPayloadV1,
} from "../types/oracleTypes";
import { asEvidenceBundleHash, asOracleDecisionId, asOracleSig } from "../types/oracleTypes";
import type { MarketOraclePolicy } from "../types/marketTypes";
import type { KaiSignature, SvgHash, UserPhiKey } from "../types/vaultTypes";
import { asKaiSignature, asSvgHash, asUserPhiKey } from "../types/vaultTypes";
import { sha256Hex } from "../utils/ids";

type UnknownRecord = Record<string, unknown>;
const isRecord = (v: unknown): v is UnknownRecord => typeof v === "object" && v !== null;
const isString = (v: unknown): v is string => typeof v === "string";
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

const isEvidenceUrl = (item: EvidenceItem): item is EvidenceItem & { kind: "url" } => item.kind === "url";
const isEvidenceHash = (item: EvidenceItem): item is EvidenceItem & { kind: "hash" } => item.kind === "hash";

export type SigilMarketsOracleApiConfig = Readonly<{
  /** Optional remote base for oracle actions. If absent, oracleApi is local-only. */
  baseUrl?: string;
  /** Endpoint path for posting a resolution proposal. Default: "/oracle/propose" */
  proposePath?: string;
  /** Endpoint path for finalizing a resolution. Default: "/oracle/finalize" */
  finalizePath?: string;
}>;

export type OracleActionResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: string }>;

export const defaultOracleApiConfig = (): SigilMarketsOracleApiConfig => {
  const g = globalThis as unknown as UnknownRecord;
  const base = isString(g["__SIGIL_MARKETS_ORACLE_API_BASE__"]) ? (g["__SIGIL_MARKETS_ORACLE_API_BASE__"] as string) : undefined;
  return { baseUrl: base, proposePath: "/oracle/propose", finalizePath: "/oracle/finalize" };
};

/** Canonicalize minimal evidence bundle and optionally compute a bundle hash. */
export const canonicalizeEvidenceBundle = async (bundle?: EvidenceBundle): Promise<EvidenceBundle | undefined> => {
  if (!bundle) return undefined;

  const items = bundle.items
    .map((it) => {
      if (it.kind === "url") {
        return { kind: "url" as const, url: (it.url as unknown as string).trim(), label: it.label, note: it.note };
      }
      return { kind: "hash" as const, hash: (it.hash as unknown as string).trim(), label: it.label, note: it.note };
    })
    .filter((it) => (it.kind === "url" ? it.url.length > 0 : it.hash.length > 0));

  const data = {
    items: items.map((it) => (it.kind === "url" ? { kind: it.kind, url: it.url } : { kind: it.kind, hash: it.hash })),
    summary: bundle.summary ?? "",
  };

  const bundleHash = await sha256Hex(JSON.stringify(data));
  return { ...bundle, items, bundleHash: asEvidenceBundleHash(bundleHash) };
};

/**
 * Local "proposal" creation:
 * - Generates deterministic decisionId from (marketId, outcome, proposedPulse, oracle provider)
 * - Attestation is optional for MVP
 */
export const createLocalProposal = async (args: Readonly<{
  marketId: MarketId;
  outcome: MarketOutcome;
  proposedPulse: KaiPulse;
  oracle: MarketOraclePolicy;
  evidence?: EvidenceBundle;
  attestations?: readonly Readonly<{ signer: OracleSigner; sig: OracleSig; atPulse: KaiPulse; weight?: number }>[];
}>): Promise<OracleResolutionProposal> => {
  const ev = await canonicalizeEvidenceBundle(args.evidence);

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
}>): Promise<OracleResolutionFinal> => {
  const ev = await canonicalizeEvidenceBundle(args.evidence ?? args.proposal?.evidence);

  const baseKey =
    args.proposal
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
  mintedAt: KaiMoment;
  mintedBy?: Readonly<{ userPhiKey: UserPhiKey; kaiSignature: KaiSignature }>;
  label?: string;
}>): Promise<ResolutionSigilPayloadV1> => {
  const ev = await canonicalizeEvidenceBundle(args.evidence);

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
          urls: ev.items.filter(isEvidenceUrl).map((i) => i.url),
          hashes: ev.items.filter(isEvidenceHash).map((i) => i.hash),
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
 * Placeholder remote calls (optional):
 * - If you configure baseUrl, we can POST proposals/finalizations later.
 * For now, these return a clear error.
 */
export const postProposal = async (_cfg: SigilMarketsOracleApiConfig, _proposal: OracleResolutionProposal): Promise<OracleActionResult<true>> => {
  return { ok: false, error: "remote oracle propose not implemented in MVP" };
};

export const postFinalization = async (_cfg: SigilMarketsOracleApiConfig, _final: OracleResolutionFinal): Promise<OracleActionResult<true>> => {
  return { ok: false, error: "remote oracle finalize not implemented in MVP" };
};
