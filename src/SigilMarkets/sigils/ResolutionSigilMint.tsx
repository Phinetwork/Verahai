// SigilMarkets/sigils/ResolutionSigilMint.tsx
"use client";

/* eslint-disable @typescript-eslint/consistent-type-definitions */

/**
 * ResolutionSigilMint
 *
 * Mints a portable Resolution Sigil SVG with embedded metadata:
 * - <metadata> contains SM-RES-1 JSON payload
 * - data-* attributes mirror key fields for quick inspection
 *
 * Output:
 * - ResolutionSigilArtifact { svgHash, url?, payload }
 *
 * Storage:
 * - MVP does not persist these globally; callers can export immediately via SigilExport.
 */

import React, { useCallback, useMemo, useState } from "react";
import type { KaiMoment, MarketId, MarketOutcome } from "../types/marketTypes";
import type { ResolutionSigilArtifact, ResolutionSigilPayloadV1 } from "../types/oracleTypes";
import { asSvgHash, type SvgHash } from "../types/vaultTypes";
import { sha256Hex } from "../utils/ids";
import { Button } from "../ui/atoms/Button";
import { Icon } from "../ui/atoms/Icon";
import { useSigilMarketsUi } from "../state/uiStore";

const esc = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Tiny deterministic PRNG (xorshift32) from a string seed */
const seed32 = (seed: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = (h + ((h << 1) >>> 0) + ((h << 4) >>> 0) + ((h << 7) >>> 0) + ((h << 8) >>> 0) + ((h << 24) >>> 0)) >>> 0;
  }
  return h >>> 0;
};

const makeRng = (seed: number) => {
  let x = seed >>> 0;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 0xffffffff;
  };
};

const lissajousPath = (seedStr: string): string => {
  const rnd = makeRng(seed32(seedStr));

  const A = 360 + Math.floor(rnd() * 140);
  const B = 360 + Math.floor(rnd() * 140);
  const a = 3 + Math.floor(rnd() * 4);
  const b = 4 + Math.floor(rnd() * 5);
  const delta = rnd() * Math.PI;

  const cx = 500;
  const cy = 500;

  const steps = 260;
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

const toneForOutcome = (o: MarketOutcome): string => {
  if (o === "YES") return "rgba(120,255,200,0.92)";
  if (o === "NO") return "rgba(255,104,104,0.92)";
  return "rgba(183,163,255,0.92)";
};

const buildResolutionSvg = (payload: ResolutionSigilPayloadV1, seedStr: string): string => {
  const ring = hexRingPath();
  const wave = lissajousPath(seedStr);
  const tone = toneForOutcome(payload.outcome);

  const metaJson = JSON.stringify(payload);

  const title = `SigilMarkets Resolution — ${payload.outcome} — p${payload.finalPulse}`;
  const desc = `Market ${payload.marketId}; Outcome ${payload.outcome}; FinalPulse ${payload.finalPulse}; Oracle ${payload.oracle.provider}`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
  viewBox="0 0 1000 1000"
  width="1000" height="1000"
  role="img"
  aria-label="${esc(title)}"
  data-kind="sigilmarkets-resolution"
  data-v="SM-RES-1"
  data-market-id="${esc(payload.marketId as unknown as string)}"
  data-outcome="${esc(payload.outcome)}"
  data-final-pulse="${esc(String(payload.finalPulse))}"
  data-oracle-provider="${esc(payload.oracle.provider as unknown as string)}">
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

  <path d="${ring}" fill="none" stroke="rgba(255,255,255,0.16)" stroke-width="10"/>
  <path d="${ring}" fill="none" stroke="${tone}" stroke-width="3" opacity="0.78"/>

  <path d="${wave}" fill="none" stroke="${tone}" stroke-width="6" opacity="0.20" filter="url(#glow)"/>
  <path d="${wave}" fill="none" stroke="rgba(255,255,255,0.82)" stroke-width="2.2" opacity="0.70"/>

  <g font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace"
     fill="rgba(255,255,255,0.72)" font-size="22">
    <text x="70" y="90">SM-RES-1</text>
    <text x="70" y="125">OUTCOME: ${esc(payload.outcome)}</text>
    <text x="70" y="160">FINAL PULSE: ${esc(String(payload.finalPulse))}</text>
    <text x="70" y="195">ORACLE: ${esc(payload.oracle.provider as unknown as string)}</text>

    <text x="70" y="930">${esc(String(payload.marketId)).slice(0, 22)}…</text>
  </g>
</svg>`;
};

export type MintResolutionSigilResult =
  | Readonly<{ ok: true; sigil: ResolutionSigilArtifact; svgText: string }>
  | Readonly<{ ok: false; error: string }>;

export const mintResolutionSigil = async (payload: ResolutionSigilPayloadV1): Promise<MintResolutionSigilResult> => {
  try {
    const seedStr = `SM:RES:${payload.marketId}:${payload.outcome}:${payload.finalPulse}:${payload.oracle.provider}`;
    const seed = await sha256Hex(seedStr);

    const svgText = buildResolutionSvg(payload, seed);
    const svgHashHex = await sha256Hex(svgText);
    const svgHash: SvgHash = asSvgHash(svgHashHex);

    const blob = new Blob([svgText], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);

    const sigil: ResolutionSigilArtifact = { svgHash, url, payload };
    return { ok: true, sigil, svgText };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "mint failed";
    return { ok: false, error: msg };
  }
};

/** Optional UI wrapper */
export type ResolutionSigilMintButtonProps = Readonly<{
  payload: ResolutionSigilPayloadV1;
  now: KaiMoment;
  onMinted?: (sigil: ResolutionSigilArtifact) => void;
}>;

export const ResolutionSigilMintButton = (props: ResolutionSigilMintButtonProps) => {
  const { actions: ui } = useSigilMarketsUi();
  const [busy, setBusy] = useState(false);

  const run = useCallback(async () => {
    setBusy(true);
    const res = await mintResolutionSigil(props.payload);
    if (!res.ok) {
      ui.toast("error", "Mint failed", res.error, { atPulse: props.now.pulse });
      setBusy(false);
      return;
    }
    ui.toast("success", "Minted", "Resolution sigil ready", { atPulse: props.now.pulse });
    if (props.onMinted) props.onMinted(res.sigil);
    setBusy(false);
  }, [props, ui]);

  return (
    <Button
      variant="primary"
      onClick={run}
      loading={busy}
      leftIcon={<Icon name="spark" size={14} tone="gold" />}
    >
      Mint resolution sigil
    </Button>
  );
};
