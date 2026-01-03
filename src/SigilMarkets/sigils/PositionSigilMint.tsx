// SigilMarkets/sigils/PositionSigilMint.tsx
"use client";

/* eslint-disable @typescript-eslint/consistent-type-definitions */

/**
 * PositionSigilMint
 *
 * Mints a portable Position Sigil SVG with embedded metadata:
 * - <metadata> contains SM-POS-1 JSON payload
 * - data-* attributes mirror key fields for quick inspection
 *
 * Output:
 * - PositionSigilArtifact { sigilId, svgHash, url?, payload }
 *
 * This file does NOT export PNG yet (that’s SigilExport.tsx next).
 */

import { useCallback, useMemo, useState } from "react";
import type { KaiMoment } from "../types/marketTypes";
import type { PositionRecord, PositionSigilArtifact, PositionSigilPayloadV1 } from "../types/sigilPositionTypes";
import { asPositionSigilId } from "../types/sigilPositionTypes";
import type { MicroDecimalString, VaultRecord } from "../types/vaultTypes";
import { asMicroDecimalString, asSvgHash } from "../types/vaultTypes";

import { sha256Hex, derivePositionSigilId } from "../utils/ids";
import { Button } from "../ui/atoms/Button";
import { Icon } from "../ui/atoms/Icon";
import { useSigilMarketsPositionStore } from "../state/positionStore";
import { useSigilMarketsUi } from "../state/uiStore";

type UnknownRecord = Record<string, unknown>;
const isRecord = (v: unknown): v is UnknownRecord => typeof v === "object" && v !== null;

const esc = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const biDec = (v: bigint): MicroDecimalString => asMicroDecimalString(v < 0n ? "0" : v.toString(10));

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

const coerceKaiMoment = (v: unknown): KaiMoment => {
  if (!isRecord(v)) return { pulse: 0, beat: 0, stepIndex: 0 };
  const p = v["pulse"];
  const b = v["beat"];
  const s = v["stepIndex"];

  const pulse = typeof p === "number" && Number.isFinite(p) ? Math.floor(p) : 0;
  const beat = typeof b === "number" && Number.isFinite(b) ? Math.floor(b) : 0;
  const stepIndex = typeof s === "number" && Number.isFinite(s) ? Math.floor(s) : 0;

  return { pulse: pulse < 0 ? 0 : pulse, beat: beat < 0 ? 0 : beat, stepIndex: stepIndex < 0 ? 0 : stepIndex };
};

/** Tiny deterministic PRNG (xorshift32) from hex seed */
const seed32FromHex = (hex: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < hex.length; i += 1) {
    h ^= hex.charCodeAt(i);
    h = (h + ((h << 1) >>> 0) + ((h << 4) >>> 0) + ((h << 7) >>> 0) + ((h << 8) >>> 0) + ((h << 24) >>> 0)) >>> 0;
  }
  return h >>> 0;
};

const makeRng = (seed: number) => {
  let x = seed >>> 0;
  return () => {
    // xorshift32
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 0xffffffff;
  };
};

const lissajousPath = (seedHex: string): string => {
  const seed = seed32FromHex(seedHex);
  const rnd = makeRng(seed);

  const A = 360 + Math.floor(rnd() * 120);
  const B = 360 + Math.floor(rnd() * 120);
  const a = 3 + Math.floor(rnd() * 4);
  const b = 4 + Math.floor(rnd() * 5);
  const delta = rnd() * Math.PI;

  const cx = 500;
  const cy = 500;

  const steps = 240;
  let d = "";
  for (let i = 0; i <= steps; i += 1) {
    const t = (i / steps) * Math.PI * 2;
    const x = cx + A * Math.sin(a * t + delta);
    const y = cy + B * Math.sin(b * t);
    d += i === 0 ? `M ${x.toFixed(2)} ${y.toFixed(2)} ` : `L ${x.toFixed(2)} ${y.toFixed(2)} `;
  }
  d += "Z";
  return d;
};

const hexRingPath = (): string => {
  // A simple hex ring for “artifact” feel
  const pts: Array<[number, number]> = [];
  const cx = 500;
  const cy = 500;
  const r = 430;
  for (let i = 0; i < 6; i += 1) {
    const a = (Math.PI / 3) * i - Math.PI / 6;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  let d = `M ${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)} `;
  for (let i = 1; i < pts.length; i += 1) d += `L ${pts[i][0].toFixed(2)} ${pts[i][1].toFixed(2)} `;
  d += "Z";
  return d;
};

const makePayload = (pos: PositionRecord, vault: VaultRecord): PositionSigilPayloadV1 => {
  return {
    v: "SM-POS-1",
    kind: "position",
    userPhiKey: vault.owner.userPhiKey,
    kaiSignature: vault.owner.kaiSignature,

    marketId: pos.marketId,
    positionId: pos.id,

    side: pos.entry.side,

    lockedStakeMicro: biDec(pos.lock.lockedStakeMicro),
    sharesMicro: biDec(pos.entry.sharesMicro),

    avgPriceMicro: biDec(pos.entry.avgPriceMicro),
    worstPriceMicro: biDec(pos.entry.worstPriceMicro),

    feeMicro: biDec(pos.entry.feeMicro),
    totalCostMicro: biDec(pos.entry.totalCostMicro),

    vaultId: pos.lock.vaultId,
    lockId: pos.lock.lockId,

    openedAt: coerceKaiMoment(pos.entry.openedAt as unknown),
    venue: pos.entry.venue,

    marketDefinitionHash: pos.entry.marketDefinitionHash,

    resolution: pos.resolution
      ? {
          outcome: pos.resolution.outcome,
          resolvedPulse: pos.resolution.resolvedPulse,
          status: pos.status,
          creditedMicro: pos.settlement ? biDec(pos.settlement.creditedMicro) : undefined,
          debitedMicro: pos.settlement ? biDec(pos.settlement.debitedMicro) : undefined,
        }
      : undefined,

    label: `Position ${pos.entry.side}`,
    note: undefined,
  };
};

const buildSvg = (payload: PositionSigilPayloadV1, svgHashSeed: string): string => {
  const ring = hexRingPath();
  const wave = lissajousPath(svgHashSeed);

  const yesTone = "rgba(191,252,255,0.92)";
  const noTone = "rgba(183,163,255,0.92)";
  const tone = payload.side === "YES" ? yesTone : noTone;

  const stake = payload.lockedStakeMicro;
  const shares = payload.sharesMicro;

  // Deterministic style accents (seeded by svgHashSeed + side)
  const styleRnd = makeRng(seed32FromHex(`${svgHashSeed}:${payload.side}`));
  const ringOuterOpacity = clamp01(0.12 + styleRnd() * 0.18);
  const ringToneOpacity = clamp01(0.55 + styleRnd() * 0.35);
  const waveGlowOpacity = clamp01(0.10 + styleRnd() * 0.20);
  const waveCoreOpacity = clamp01(0.62 + styleRnd() * 0.30);
  const labelOpacity = clamp01(0.62 + styleRnd() * 0.20);

  const metaJson = JSON.stringify(payload);

  const title = `SigilMarkets Position — ${payload.side} — p${payload.openedAt.pulse}`;
  const desc = `Market ${payload.marketId}; Stake ${stake}; Shares ${shares}; Vault ${payload.vaultId}; Lock ${payload.lockId}`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
  viewBox="0 0 1000 1000"
  width="1000" height="1000"
  role="img"
  aria-label="${esc(title)}"
  data-kind="sigilmarkets-position"
  data-v="SM-POS-1"
  data-market-id="${esc(payload.marketId as unknown as string)}"
  data-position-id="${esc(payload.positionId as unknown as string)}"
  data-side="${esc(payload.side)}"
  data-vault-id="${esc(payload.vaultId as unknown as string)}"
  data-lock-id="${esc(payload.lockId as unknown as string)}"
  data-user-phikey="${esc(payload.userPhiKey as unknown as string)}"
  data-kai-signature="${esc(payload.kaiSignature as unknown as string)}"
  data-pulse="${esc(String(payload.openedAt.pulse))}"
  data-beat="${esc(String(payload.openedAt.beat))}"
  data-step-index="${esc(String(payload.openedAt.stepIndex))}">
  <title>${esc(title)}</title>
  <desc>${esc(desc)}</desc>
  <metadata>${esc(metaJson)}</metadata>

  <defs>
    <radialGradient id="bg" cx="50%" cy="38%" r="70%">
      <stop offset="0%" stop-color="rgba(255,255,255,0.10)"/>
      <stop offset="60%" stop-color="rgba(0,0,0,0.00)"/>
      <stop offset="100%" stop-color="rgba(0,0,0,0.22)"/>
    </radialGradient>

    <filter id="glow" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="8" result="b"/>
      <feColorMatrix in="b" type="matrix"
        values="1 0 0 0 0
                0 1 0 0 0
                0 0 1 0 0
                0 0 0 0.45 0"/>
      <feMerge>
        <feMergeNode/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>

  <rect x="0" y="0" width="1000" height="1000" fill="rgba(8,10,18,1)"/>
  <rect x="0" y="0" width="1000" height="1000" fill="url(#bg)"/>

  <path d="${ring}" fill="none" stroke="rgba(255,255,255,${ringOuterOpacity.toFixed(3)})" stroke-width="10"/>
  <path d="${ring}" fill="none" stroke="${tone}" stroke-width="3" opacity="${ringToneOpacity.toFixed(3)}"/>

  <path d="${wave}" fill="none" stroke="${tone}" stroke-width="6" opacity="${waveGlowOpacity.toFixed(3)}" filter="url(#glow)"/>
  <path d="${wave}" fill="none" stroke="rgba(255,255,255,0.82)" stroke-width="2.2" opacity="${waveCoreOpacity.toFixed(3)}"/>

  <g font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace"
     fill="rgba(255,255,255,${labelOpacity.toFixed(3)})" font-size="22">
    <text x="70" y="90">SM-POS-1</text>
    <text x="70" y="125">SIDE: ${esc(payload.side)}</text>
    <text x="70" y="160">STAKE μΦ: ${esc(payload.lockedStakeMicro as unknown as string)}</text>
    <text x="70" y="195">SHARES μ: ${esc(payload.sharesMicro as unknown as string)}</text>

    <text x="70" y="930">p${esc(String(payload.openedAt.pulse))} • ${esc(payload.marketId as unknown as string).slice(0, 20)}…</text>
  </g>
</svg>`;
};

export const buildPositionSigilSvgFromPayload = async (payload: PositionSigilPayloadV1): Promise<string> => {
  const seed = await sha256Hex(`SM:POS:SEED:${payload.positionId}:${payload.lockId}:${payload.userPhiKey}`);
  return buildSvg(payload, seed);
};

export type MintPositionSigilResult =
  | Readonly<{ ok: true; sigil: PositionSigilArtifact; svgText: string }>
  | Readonly<{ ok: false; error: string }>;

export const mintPositionSigil = async (pos: PositionRecord, vault: VaultRecord): Promise<MintPositionSigilResult> => {
  try {
    const payload = makePayload(pos, vault);

    // Seed hash from deterministic inputs (position + lock)
    const svgText = await buildPositionSigilSvgFromPayload(payload);
    const svgHashHex = await sha256Hex(svgText);
    const svgHash = asSvgHash(svgHashHex);

    const rawSigilId = await derivePositionSigilId({ positionId: pos.id, ref: svgHashHex.slice(0, 24) });
    const sigilId = asPositionSigilId(String(rawSigilId));

    const blob = new Blob([svgText], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);

    const sigil: PositionSigilArtifact = {
      sigilId,
      svgHash,
      url,
      payload,
    };

    return { ok: true, sigil, svgText };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "mint failed";
    return { ok: false, error: msg };
  }
};

/** Optional UI component wrapper (drop-in) */
export type PositionSigilMintProps = Readonly<{
  position: PositionRecord;
  vault: VaultRecord;
  now: KaiMoment;
  onMinted?: (sigil: PositionSigilArtifact) => void;
}>;

export const PositionSigilMint = (props: PositionSigilMintProps) => {
  const { actions: ui } = useSigilMarketsUi();
  const { actions: posStore } = useSigilMarketsPositionStore();

  const [busy, setBusy] = useState(false);

  const can = useMemo(() => !props.position.sigil, [props.position.sigil]);

  const run = useCallback(async () => {
    if (!can) return;

    setBusy(true);
    const res = await mintPositionSigil(props.position, props.vault);
    if (!res.ok) {
      ui.toast("error", "Mint failed", res.error, { atPulse: props.now.pulse });
      setBusy(false);
      return;
    }

    posStore.attachSigil(props.position.id, res.sigil, props.now.pulse);
    ui.toast("success", "Minted", "Position sigil ready", { atPulse: props.now.pulse });

    if (props.onMinted) props.onMinted(res.sigil);

    setBusy(false);
  }, [can, posStore, props, ui]);

  return (
    <Button
      variant="primary"
      onClick={run}
      disabled={!can || busy}
      loading={busy}
      leftIcon={<Icon name="spark" size={14} tone="gold" />}
    >
      {props.position.sigil ? "Minted" : "Mint sigil"}
    </Button>
  );
};
