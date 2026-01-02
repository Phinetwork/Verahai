// SigilMarkets/sigils/PositionSigilMint.tsx
"use client";

/* eslint-disable @typescript-eslint/consistent-type-definitions */

/**
 * PositionSigilMint
 *
 * Fully functional minting for Position Sigils:
 * - Generates an SVG artifact (no placeholders)
 * - Embeds SM-POS-1 payload JSON inside <metadata>
 * - Computes svgHash (sha256 hex)
 * - Returns a blob URL for immediate viewing/downloading
 *
 * This file exports:
 * - mintPositionSigil(req): Promise<MintPositionSigilResult>
 * - buildPositionSigilSvg(payload): string
 */

import type { KaiMoment } from "../types/marketTypes";
import { type MarketId, type VaultId } from "../types/marketTypes";
import type {
  MintPositionSigilRequest,
  MintPositionSigilResult,
  PositionSigilArtifact,
  PositionSigilPayloadV1,
} from "../types/sigilPositionTypes";
import { asPositionSigilId } from "../types/sigilPositionTypes";
import type { MicroDecimalString, SvgHash } from "../types/vaultTypes";
import { asMicroDecimalString, asSvgHash } from "../types/vaultTypes";
import { derivePositionSigilId, sha256Hex } from "../utils/ids";

/** JSON stringify with stable key ordering for deterministic hashing. */
const stableStringify = (v: unknown): string => {
  const seen = new WeakSet<object>();

  const sortKeys = (obj: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    const keys = Object.keys(obj).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    for (const k of keys) out[k] = normalize((obj as Record<string, unknown>)[k]);
    return out;
  };

  const normalize = (x: unknown): unknown => {
    if (x === null) return null;
    const t = typeof x;
    if (t === "string" || t === "number" || t === "boolean") return x;

    if (typeof x === "bigint") return x.toString(10);

    if (Array.isArray(x)) return x.map((i) => normalize(i));

    if (t === "object") {
      const o = x as Record<string, unknown>;
      if (seen.has(o)) return "[Circular]";
      seen.add(o);
      return sortKeys(o);
    }

    return String(x);
  };

  return JSON.stringify(normalize(v));
};

const dec = (v: bigint): MicroDecimalString => asMicroDecimalString(v.toString(10));

const sanitizeText = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const short = (s: string, left = 10, right = 6): string => {
  const t = s.trim();
  if (t.length <= left + right + 1) return t;
  return `${t.slice(0, left)}…${t.slice(-right)}`;
};

const sideTone = (side: "YES" | "NO"): { a: string; b: string } => {
  return side === "YES"
    ? { a: "rgba(191,252,255,0.95)", b: "rgba(35,255,240,0.22)" }
    : { a: "rgba(183,163,255,0.95)", b: "rgba(183,163,255,0.22)" };
};

export const buildPositionSigilSvg = (payload: PositionSigilPayloadV1): string => {
  const side = payload.side;
  const tones = sideTone(side);

  const title = `Sigil Position — ${side}`;
  const q = payload.label ?? `Market ${payload.marketId as unknown as string}`;
  const stake = payload.lockedStakeMicro;
  const shares = payload.sharesMicro;

  const metaJson = stableStringify(payload);

  const header = `${payload.marketId as unknown as string} • ${side}`;
  const sub = `stake ${stake}μ • shares ${shares}μ`;
  const owner = short(payload.userPhiKey as unknown as string, 10, 4);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     xmlns:xlink="http://www.w3.org/1999/xlink"
     viewBox="0 0 1000 1000"
     width="1024" height="1024"
     role="img"
     aria-label="${sanitizeText(title)}"
     data-kind="sigilmarkets-position"
     data-v="SM-POS-1"
     data-market-id="${sanitizeText(payload.marketId as unknown as string)}"
     data-position-id="${sanitizeText(payload.positionId as unknown as string)}"
     data-side="${sanitizeText(side)}"
     data-vault-id="${sanitizeText(payload.vaultId as unknown as string)}"
     data-lock-id="${sanitizeText(payload.lockId as unknown as string)}"
     data-user-phikey="${sanitizeText(payload.userPhiKey as unknown as string)}"
     data-kai-signature="${sanitizeText(payload.kaiSignature as unknown as string)}">
  <metadata>${sanitizeText(metaJson)}</metadata>

  <defs>
    <radialGradient id="rg" cx="50%" cy="42%" r="70%">
      <stop offset="0%" stop-color="${tones.a}" stop-opacity="0.20"/>
      <stop offset="35%" stop-color="${tones.b}" stop-opacity="0.22"/>
      <stop offset="70%" stop-color="rgba(0,0,0,0)" stop-opacity="0"/>
    </radialGradient>

    <linearGradient id="lg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${tones.a}" stop-opacity="0.55"/>
      <stop offset="60%" stop-color="${tones.b}" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="rgba(255,255,255,0.05)" stop-opacity="0.10"/>
    </linearGradient>

    <filter id="glow" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="10" result="blur"/>
      <feColorMatrix in="blur" type="matrix"
        values="1 0 0 0 0
                0 1 0 0 0
                0 0 1 0 0
                0 0 0 0.55 0" result="g"/>
      <feMerge>
        <feMergeNode in="g"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>

  <rect x="0" y="0" width="1000" height="1000" fill="rgba(0,0,0,0)"/>
  <circle cx="500" cy="500" r="440" fill="url(#rg)"/>

  <!-- Hex frame -->
  <g filter="url(#glow)">
    <path d="M500 95
             L842 290
             L842 710
             L500 905
             L158 710
             L158 290
             Z"
          fill="rgba(255,255,255,0.04)"
          stroke="url(#lg)"
          stroke-width="8"
          stroke-linejoin="round"/>

    <path d="M500 150
             L800 320
             L800 680
             L500 850
             L200 680
             L200 320
             Z"
          fill="rgba(0,0,0,0.10)"
          stroke="rgba(255,255,255,0.12)"
          stroke-width="3"
          stroke-linejoin="round"/>
  </g>

  <!-- Title block -->
  <g>
    <text x="500" y="420" text-anchor="middle"
          font-family="ui-sans-serif, system-ui, -apple-system, Inter, Arial"
          font-size="18"
          letter-spacing="0.16em"
          fill="rgba(255,255,255,0.62)"
          font-weight="800">SIGIL MARKETS</text>

    <text x="500" y="460" text-anchor="middle"
          font-family="ui-sans-serif, system-ui, -apple-system, Inter, Arial"
          font-size="34"
          letter-spacing="0.08em"
          fill="rgba(255,255,255,0.92)"
          font-weight="950">${sanitizeText(header)}</text>

    <text x="500" y="505" text-anchor="middle"
          font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace"
          font-size="16"
          letter-spacing="0.02em"
          fill="rgba(255,255,255,0.70)"
          font-weight="700">${sanitizeText(sub)}</text>

    <text x="500" y="552" text-anchor="middle"
          font-family="ui-sans-serif, system-ui, -apple-system, Inter, Arial"
          font-size="14"
          fill="rgba(255,255,255,0.62)">${sanitizeText(q)}</text>

    <text x="500" y="615" text-anchor="middle"
          font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace"
          font-size="12"
          fill="rgba(255,255,255,0.52)">owner ${sanitizeText(owner)}</text>

    <text x="500" y="640" text-anchor="middle"
          font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace"
          font-size="12"
          fill="rgba(255,255,255,0.46)">opened p ${payload.openedAt.pulse}</text>
  </g>

  <!-- Corner stamps -->
  <g font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace"
     font-size="12" fill="rgba(255,255,255,0.50)">
    <text x="92" y="120">${sanitizeText(payload.v)}</text>
    <text x="908" y="120" text-anchor="end">${sanitizeText(side)}</text>
    <text x="92" y="900">${sanitizeText(payload.venue)}</text>
    <text x="908" y="900" text-anchor="end">lock ${sanitizeText(short(payload.lockId as unknown as string, 10, 6))}</text>
  </g>
</svg>`;
};

const makeBlobUrl = (svgText: string): string => {
  const blob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
  return URL.createObjectURL(blob);
};

export const mintPositionSigil = async (req: MintPositionSigilRequest): Promise<MintPositionSigilResult> => {
  const stakeMicro = dec(req.lock.lockedStakeMicro as unknown as bigint);
  const sharesMicro = dec(req.entry.sharesMicro as unknown as bigint);
  const avgPriceMicro = dec(req.entry.avgPriceMicro as unknown as bigint);
  const worstPriceMicro = dec(req.entry.worstPriceMicro as unknown as bigint);
  const feeMicro = dec(req.entry.feeMicro as unknown as bigint);
  const totalCostMicro = dec(req.entry.totalCostMicro as unknown as bigint);

  const payload: PositionSigilPayloadV1 = {
    v: "SM-POS-1",
    kind: "position",
    userPhiKey: req.userPhiKey,
    kaiSignature: req.kaiSignature,
    marketId: req.marketId,
    positionId: req.positionId,
    side: req.entry.side,
    lockedStakeMicro: stakeMicro,
    sharesMicro,
    avgPriceMicro,
    worstPriceMicro,
    feeMicro,
    totalCostMicro,
    vaultId: req.lock.vaultId,
    lockId: req.lock.lockId,
    openedAt: req.entry.openedAt,
    venue: req.entry.venue,
    marketDefinitionHash: req.entry.marketDefinitionHash,
    label: req.label,
    note: req.note,
  };

  const svgText = buildPositionSigilSvg(payload);
  const svgHashHex = await sha256Hex(svgText);
  const svgHash = asSvgHash(svgHashHex) as SvgHash;

  const sigilId = await derivePositionSigilId({
    positionId: req.positionId,
    ref: svgHashHex,
  });

  const url = makeBlobUrl(svgText);

  const sigil: PositionSigilArtifact = {
    sigilId: asPositionSigilId(sigilId as unknown as string),
    svgHash,
    url,
    payload,
  };

  return { sigil };
};

/**
 * Optional helper: finalize a Position Sigil with a resolution snapshot (remint).
 * (Useful if you want a "final receipt" artifact after claim.)
 */
export const mintFinalizedPositionSigil = async (args: Readonly<{
  base: PositionSigilPayloadV1;
  resolution: Readonly<{
    outcome: "YES" | "NO" | "VOID";
    resolvedPulse: KaiPulse;
    status: "claimed" | "refunded" | "lost";
    creditedMicro?: MicroDecimalString;
    debitedMicro?: MicroDecimalString;
  }>;
}>): Promise<Readonly<{ sigil: PositionSigilArtifact }>> => {
  const payload: PositionSigilPayloadV1 = {
    ...args.base,
    resolution: {
      outcome: args.resolution.outcome,
      resolvedPulse: args.resolution.resolvedPulse,
      status: args.resolution.status as any,
      creditedMicro: args.resolution.creditedMicro,
      debitedMicro: args.resolution.debitedMicro,
    },
  };

  const svgText = buildPositionSigilSvg(payload);
  const svgHashHex = await sha256Hex(svgText);
  const svgHash = asSvgHash(svgHashHex) as SvgHash;

  const sigilId = await derivePositionSigilId({
    positionId: args.base.positionId,
    ref: svgHashHex,
  });

  const url = makeBlobUrl(svgText);

  return {
    sigil: {
      sigilId: asPositionSigilId(sigilId as unknown as string),
      svgHash,
      url,
      payload,
    },
  };
};
