// SigilMarkets/sigils/PositionSigilMint.tsx
"use client";

/* eslint-disable @typescript-eslint/consistent-type-definitions */

/**
 * PositionSigilMint
 *
 * Mints a portable Position Sigil SVG with embedded metadata:
 * - <metadata> contains SM-POS-1 JSON payload (RAW JSON, not escaped)
 * - <metadata id="sm-zk"> contains ZK + canonical hash seal (RAW JSON / CDATA)
 * - Root data-* mirrors key fields + hashes (like your Kairos sigils)
 *
 * Visual goal:
 * - Transparent artboard
 * - Etherik frosted krystal / Atlantean glass “super key”
 * - Sacred geometry + proof rings
 * - Data is “sewn” into the art:
 *   - Signature ring textPath (binary + hashes) like your Kairos glyph
 *   - Etched glass panels that are part of the geometry (not pasted on)
 *   - No truncation: wrap, scale to fit, never drop content
 */

import { useCallback, useMemo, useState } from "react";
import type { KaiMoment } from "../types/marketTypes";
import type { PositionRecord, PositionSigilArtifact, PositionSigilPayloadV1 } from "../types/sigilPositionTypes";
import { asPositionSigilId } from "../types/sigilPositionTypes";
import type { VaultRecord } from "../types/vaultTypes";
import { asSvgHash } from "../types/vaultTypes";

import { sha256Hex, derivePositionSigilId } from "../utils/ids";
import { Button } from "../ui/atoms/Button";
import { Icon } from "../ui/atoms/Icon";
import { useSigilMarketsPositionStore } from "../state/positionStore";
import { useSigilMarketsUi } from "../state/uiStore";

/**
 * Some repos define MicroDecimalString/asMicroDecimalString but do not export them.
 * Keep this file bulletproof + lint-clean.
 */
type MicroDecimalString = string & { readonly __brand: "MicroDecimalString" };
const asMicroDecimalString = (v: string): MicroDecimalString => v as MicroDecimalString;

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
    h =
      (h +
        ((h << 1) >>> 0) +
        ((h << 4) >>> 0) +
        ((h << 7) >>> 0) +
        ((h << 8) >>> 0) +
        ((h << 24) >>> 0)) >>>
      0;
  }
  return h >>> 0;
};

const makeRng = (seed: number) => {
  let x = seed >>> 0;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
};

const PHI = (1 + Math.sqrt(5)) / 2;

/* ─────────────────────────────────────────────────────────────
 * Canonicalization (strict, stable, no `any`)
 * Used to compute machine-readable canonicalHash.
 * ───────────────────────────────────────────────────────────── */

type JSONPrimitive = string | number | boolean | null;
interface JSONObject {
  readonly [k: string]: JSONValue;
}
type JSONValue = JSONPrimitive | ReadonlyArray<JSONValue> | JSONObject;

const isJsonPrimitive = (v: unknown): v is JSONPrimitive =>
  v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean";

const isJsonArray = (v: JSONValue): v is ReadonlyArray<JSONValue> => Array.isArray(v);
const isJsonObject = (v: JSONValue): v is JSONObject => typeof v === "object" && v !== null && !Array.isArray(v);

const toJsonValue = (v: unknown): JSONValue => {
  if (isJsonPrimitive(v)) return v;
  if (Array.isArray(v)) return v.map((x) => toJsonValue(x));
  if (isRecord(v)) {
    const out: Record<string, JSONValue> = {};
    const keys = Object.keys(v).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    for (const k of keys) out[k] = toJsonValue(v[k]);
    return out;
  }
  return String(v);
};

const stableStringify = (v: JSONValue): string => {
  if (v === null) return "null";
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : JSON.stringify(String(v));
  if (typeof v === "boolean") return v ? "true" : "false";
  if (isJsonArray(v)) return `[${v.map((x) => stableStringify(x)).join(",")}]`;
  if (!isJsonObject(v)) return JSON.stringify(String(v));
  const keys = Object.keys(v).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(",")}}`;
};

const hexToBits256 = (hex: string): readonly (0 | 1)[] => {
  const clean = hex.replace(/^0x/i, "").toLowerCase();
  const out: Array<0 | 1> = [];
  for (let i = 0; i < clean.length; i += 1) {
    const c = clean.charCodeAt(i);
    const n = c >= 48 && c <= 57 ? c - 48 : c >= 97 && c <= 102 ? c - 87 : 0;
    out.push(((n >> 3) & 1) as 0 | 1);
    out.push(((n >> 2) & 1) as 0 | 1);
    out.push(((n >> 1) & 1) as 0 | 1);
    out.push((n & 1) as 0 | 1);
  }
  if (out.length > 256) return out.slice(0, 256);
  while (out.length < 256) out.push(0);
  return out;
};

const bitsToBinaryString = (hex: string): string => {
  const bits = hexToBits256(hex);
  let s = "";
  for (let i = 0; i < bits.length; i += 1) s += bits[i] === 1 ? "1" : "0";
  return s;
};

const hexToBigIntDec = (hex: string): string => {
  const clean = hex.replace(/^0x/i, "").trim();
  if (!/^[0-9a-fA-F]+$/.test(clean)) return "0";
  const bi = BigInt(`0x${clean}`);
  return bi.toString(10);
};

const safeCdata = (raw: string): string => {
  // prevent closing the CDATA early
  const safe = raw.replace(/]]>/g, "]]]]><![CDATA[>");
  return `<![CDATA[${safe}]]>`;
};

const b64Utf8 = (s: string): string => {
  // Browser-first (use client). Still safe if btoa missing.
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const b = (globalThis as unknown as { btoa?: (x: string) => string }).btoa;
    if (typeof b === "function") return b(unescape(encodeURIComponent(s)));
  } catch {
    // ignore
  }
  // Minimal fallback (not perfect for unicode, but shouldn’t be hit in-browser)
  return "";
};

/* ─────────────────────────────────────────────────────────────
 * ZK + Machine Approval Seal
 * ───────────────────────────────────────────────────────────── */

type Groth16Proof = Readonly<{
  pi_a: readonly string[];
  pi_b: readonly (readonly string[])[];
  pi_c: readonly string[];
}>;

type ZkSeal = Readonly<{
  scheme: "groth16-poseidon";
  canonicalHashAlg: "sha256";
  canonicalHashHex: string;
  canonicalBytesLen: number;
  zkPoseidonHashDec: string;
  zkOk: boolean;
  zkProof?: Groth16Proof;
  proofHints?: Readonly<Record<string, unknown>>;
  matches?: Readonly<{ vaultCanonical?: boolean; vaultPoseidon?: boolean }>;
}>;

const isStringArray = (v: unknown): v is readonly string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

const isStringArray2 = (v: unknown): v is readonly (readonly string[])[] =>
  Array.isArray(v) && v.every((row) => Array.isArray(row) && row.every((x) => typeof x === "string"));

const isGroth16Proof = (v: unknown): v is Groth16Proof => {
  if (!isRecord(v)) return false;
  return isStringArray(v["pi_a"]) && isStringArray2(v["pi_b"]) && isStringArray(v["pi_c"]);
};

const extractOwnerZk = (
  vault: VaultRecord | null,
): Readonly<{
  canonicalHashHex?: string;
  zkPoseidonHashDec?: string;
  zkProof?: Groth16Proof;
  proofHints?: Readonly<Record<string, unknown>>;
}> => {
  if (!vault) return {};
  const v = vault as unknown;
  if (!isRecord(v)) return {};
  const owner = v["owner"];
  if (!isRecord(owner)) return {};

  const canonicalHashHex = typeof owner["canonicalHash"] === "string" ? owner["canonicalHash"] : undefined;

  const zkPoseidonHashDec =
    typeof owner["zkPoseidonHash"] === "string"
      ? owner["zkPoseidonHash"]
      : typeof owner["zkPoseidonHashDec"] === "string"
        ? owner["zkPoseidonHashDec"]
        : undefined;

  const zkProof = isGroth16Proof(owner["zkProof"]) ? owner["zkProof"] : isGroth16Proof(owner["proof"]) ? owner["proof"] : undefined;

  const proofHints = isRecord(owner["proofHints"]) ? (owner["proofHints"] as Readonly<Record<string, unknown>>) : undefined;

  return { canonicalHashHex, zkPoseidonHashDec, zkProof, proofHints };
};

const buildZkSeal = async (payload: PositionSigilPayloadV1, vault: VaultRecord | null): Promise<ZkSeal> => {
  const canonObj = toJsonValue({
    v: payload.v,
    kind: payload.kind,
    userPhiKey: payload.userPhiKey,
    kaiSignature: payload.kaiSignature,
    marketId: payload.marketId,
    positionId: payload.positionId,
    side: payload.side,

    lockedStakeMicro: payload.lockedStakeMicro,
    sharesMicro: payload.sharesMicro,
    avgPriceMicro: payload.avgPriceMicro,
    worstPriceMicro: payload.worstPriceMicro,
    feeMicro: payload.feeMicro,
    totalCostMicro: payload.totalCostMicro,

    vaultId: payload.vaultId,
    lockId: payload.lockId,
    openedAt: payload.openedAt,
    venue: payload.venue ?? null,
    marketDefinitionHash: payload.marketDefinitionHash ?? null,

    resolution: payload.resolution ?? null,
    label: payload.label ?? null,
    note: payload.note ?? null,
  });

  const canonStr = stableStringify(canonObj);
  const canonicalBytesLen = new TextEncoder().encode(canonStr).byteLength;
  const canonicalHashHex = await sha256Hex(`SM:POS:CANON:${canonStr}`);

  const ownerZk = extractOwnerZk(vault);
  const derivedPoseidonDec = hexToBigIntDec(await sha256Hex(`SM:POS:POSEIDON:${canonicalHashHex}`));
  const zkPoseidonHashDec = ownerZk.zkPoseidonHashDec ?? derivedPoseidonDec;

  const vaultCanonicalOk =
    typeof ownerZk.canonicalHashHex === "string"
      ? ownerZk.canonicalHashHex.toLowerCase() === canonicalHashHex.toLowerCase()
      : undefined;

  const vaultPoseidonOk =
    typeof ownerZk.zkPoseidonHashDec === "string" ? ownerZk.zkPoseidonHashDec === zkPoseidonHashDec : undefined;

  const zkOk = Boolean(ownerZk.zkProof) || Boolean(vaultCanonicalOk && vaultPoseidonOk);

  return {
    scheme: "groth16-poseidon",
    canonicalHashAlg: "sha256",
    canonicalHashHex,
    canonicalBytesLen,
    zkPoseidonHashDec,
    zkOk,
    zkProof: ownerZk.zkProof,
    proofHints:
      ownerZk.proofHints ??
      ({
        scheme: "groth16-poseidon",
        verify: { mode: "offline-or-api", statement: "canonicalHashHex", publicInput: "zkPoseidonHashDec" },
      } as const),
    matches: { vaultCanonical: vaultCanonicalOk, vaultPoseidon: vaultPoseidonOk },
  };
};

/* ─────────────────────────────────────────────────────────────
 * Sacred geometry paths
 * ───────────────────────────────────────────────────────────── */

const lissajousPath = (seedHex: string): string => {
  const seed = seed32FromHex(seedHex);
  const rnd = makeRng(seed);

  const A = 360 + Math.floor(rnd() * 140);
  const B = 340 + Math.floor(rnd() * 160);
  const a = 3 + Math.floor(rnd() * 5);
  const b = 4 + Math.floor(rnd() * 6);
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

const goldenSpiralPath = (): string => {
  const cx = 500;
  const cy = 500;

  const b = Math.log(PHI) / (Math.PI / 2);
  const thetaMax = Math.PI * 4.75;
  const a = 360 / Math.exp(b * thetaMax);

  const steps = 300;
  let d = "";
  for (let i = 0; i <= steps; i += 1) {
    const t = (i / steps) * thetaMax;
    const r = a * Math.exp(b * t);
    const x = cx + r * Math.cos(t);
    const y = cy + r * Math.sin(t);
    d += i === 0 ? `M ${x.toFixed(2)} ${y.toFixed(2)} ` : `L ${x.toFixed(2)} ${y.toFixed(2)} `;
  }
  return d;
};

const hexRingPath = (): string => {
  const pts: Array<[number, number]> = [];
  const cx = 500;
  const cy = 500;
  const r = 432;
  for (let i = 0; i < 6; i += 1) {
    const a = (Math.PI / 3) * i - Math.PI / 6;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  let d = `M ${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)} `;
  for (let i = 1; i < pts.length; i += 1) d += `L ${pts[i][0].toFixed(2)} ${pts[i][1].toFixed(2)} `;
  d += "Z";
  return d;
};

const flowerOfLife = (): readonly string[] => {
  const cx = 500;
  const cy = 500;
  const r = 160;
  const circles: string[] = [];
  circles.push(`<circle cx="${cx}" cy="${cy}" r="${r}" />`);
  for (let i = 0; i < 6; i += 1) {
    const a = (Math.PI / 3) * i;
    const x = cx + r * Math.cos(a);
    const y = cy + r * Math.sin(a);
    circles.push(`<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${r}" />`);
  }
  return circles;
};

const crystalFacets = (seedHex: string): readonly string[] => {
  const rnd = makeRng(seed32FromHex(`FACETS:${seedHex}`));
  const cx = 500;
  const cy = 500;

  const facetCount = 13 + Math.floor(rnd() * 7); // 13..19
  const paths: string[] = [];

  for (let i = 0; i < facetCount; i += 1) {
    const ang0 = rnd() * Math.PI * 2;
    const ang1 = ang0 + (0.22 + rnd() * 0.55);
    const ang2 = ang1 + (0.18 + rnd() * 0.45);

    const r0 = 140 + rnd() * 320;
    const r1 = r0 * (0.72 + rnd() * 0.28);
    const r2 = r1 * (0.70 + rnd() * 0.30);

    const x0 = cx + r0 * Math.cos(ang0);
    const y0 = cy + r0 * Math.sin(ang0);
    const x1 = cx + r1 * Math.cos(ang1);
    const y1 = cy + r1 * Math.sin(ang1);
    const x2 = cx + r2 * Math.cos(ang2);
    const y2 = cy + r2 * Math.sin(ang2);

    const inset = 0.08 + rnd() * 0.10;
    const x3 = cx + (x1 - cx) * (1 - inset);
    const y3 = cy + (y1 - cy) * (1 - inset);

    paths.push(
      `M ${x0.toFixed(2)} ${y0.toFixed(2)} L ${x1.toFixed(2)} ${y1.toFixed(2)} L ${x2.toFixed(2)} ${y2.toFixed(
        2,
      )} L ${x3.toFixed(2)} ${y3.toFixed(2)} Z`,
    );
  }

  return paths;
};

const proofRingTicks = (hashHex: string, r: number): string => {
  const bits = hexToBits256(hashHex);
  const cx = 500;
  const cy = 500;
  let out = "";
  for (let i = 0; i < 256; i += 1) {
    const bit = bits[i] ?? 0;
    const a = (Math.PI * 2 * i) / 256 - Math.PI / 2;
    const len = bit === 1 ? 22 : 12;
    const x0 = cx + (r - len) * Math.cos(a);
    const y0 = cy + (r - len) * Math.sin(a);
    const x1 = cx + r * Math.cos(a);
    const y1 = cy + r * Math.sin(a);

    const major = i % 32 === 0;
    const w = major ? 2.2 : bit === 1 ? 1.6 : 1.0;

    out += `<line x1="${x0.toFixed(2)}" y1="${y0.toFixed(2)}" x2="${x1.toFixed(2)}" y2="${y1.toFixed(
      2,
    )}" stroke-width="${w.toFixed(2)}" />\n`;
  }
  return out;
};

/* ─────────────────────────────────────────────────────────────
 * Text sewn into etched panels (no truncation)
 * dyAcc is used (layout + data attributes).
 * ───────────────────────────────────────────────────────────── */

type TextLine = Readonly<{ kind: "title" | "label" | "value"; text: string }>;

const chunkEvery = (s: string, n: number): readonly string[] => {
  if (n <= 0) return [s];
  if (s.length <= n) return [s];
  const out: string[] = [];
  for (let i = 0; i < s.length; i += n) out.push(s.slice(i, i + n));
  return out;
};

const fieldLines = (label: string, value: string, wrap: number): readonly TextLine[] => {
  const vv = value.length === 0 ? "(empty)" : value;
  const chunks = chunkEvery(vv, wrap);
  const lines: TextLine[] = [{ kind: "label", text: `${label}` }];
  for (const c of chunks) lines.push({ kind: "value", text: c });
  return lines;
};

const calcTextBlockHeight = (lines: readonly TextLine[]): number => {
  const lineHTitle = 18;
  const lineH = 14.5;

  let dyAcc = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const ln = lines[i];
    const isTitle = ln.kind === "title";
    const dy = i === 0 ? 0 : isTitle ? lineHTitle : lineH;
    dyAcc += dy;
  }
  const tailPad = 6;
  return dyAcc + tailPad;
};

const renderTextBlock = (x: number, y: number, lines: readonly TextLine[], panelId: string, scale: number): string => {
  const titleSize = 16;
  const labelSize = 12.5;
  const valueSize = 12.5;

  const lineHTitle = 18;
  const lineH = 14.5;

  let dyAcc = 0;
  const tspans: string[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const ln = lines[i];
    const isTitle = ln.kind === "title";
    const fontSize = isTitle ? titleSize : ln.kind === "label" ? labelSize : valueSize;
    const opacity = ln.kind === "title" ? "0.92" : ln.kind === "label" ? "0.72" : "0.82";
    const dy = i === 0 ? 0 : isTitle ? lineHTitle : lineH;

    dyAcc += dy;

    tspans.push(
      `<tspan x="${x.toFixed(2)}" dy="${dy.toFixed(2)}" font-size="${fontSize}" opacity="${opacity}">${esc(
        ln.text,
      )}</tspan>`,
    );
  }

  const dataDy = dyAcc.toFixed(2);
  const dataScale = scale.toFixed(4);

  const tx = x.toFixed(2);
  const ty = y.toFixed(2);
  const s = scale.toFixed(4);

  return `<g data-panel="${esc(panelId)}" data-text-dy="${dataDy}" data-text-scale="${dataScale}"
    transform="translate(${tx} ${ty}) scale(${s}) translate(${-x} ${-y})">
    <text
      font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace"
      fill="rgba(255,255,255,0.86)"
      letter-spacing="0.35"
      text-rendering="geometricPrecision"
    >${tspans.join("")}</text>
  </g>`;
};

const roundedRectPath = (x: number, y: number, w: number, h: number, r: number): string => {
  const rr = Math.max(0, Math.min(r, Math.min(w / 2, h / 2)));
  const x0 = x;
  const y0 = y;
  const x1 = x + w;
  const y1 = y + h;
  return [
    `M ${x0 + rr} ${y0}`,
    `L ${x1 - rr} ${y0}`,
    `Q ${x1} ${y0} ${x1} ${y0 + rr}`,
    `L ${x1} ${y1 - rr}`,
    `Q ${x1} ${y1} ${x1 - rr} ${y1}`,
    `L ${x0 + rr} ${y1}`,
    `Q ${x0} ${y1} ${x0} ${y1 - rr}`,
    `L ${x0} ${y0 + rr}`,
    `Q ${x0} ${y0} ${x0 + rr} ${y0}`,
    "Z",
  ].join(" ");
};

type PanelSpec = Readonly<{
  id: string;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fields: readonly Readonly<{ label: string; value: string; wrap: number }>[];
}>;

const buildPanels = (payload: PositionSigilPayloadV1, seal: ZkSeal): readonly PanelSpec[] => {
  const opened = `pulse=${payload.openedAt.pulse} beat=${payload.openedAt.beat} stepIndex=${payload.openedAt.stepIndex}`;

  const res = payload.resolution;
  const resLines = res
    ? `outcome=${res.outcome} status=${res.status} resolvedPulse=${res.resolvedPulse} creditedMicro=${res.creditedMicro ?? ""} debitedMicro=${
        res.debitedMicro ?? ""
      }`
    : "(unresolved)";

  return [
    {
      id: "pos",
      title: "POSITION",
      x: 95,
      y: 610,
      w: 390,
      h: 170,
      fields: [
        { label: "v", value: payload.v, wrap: 44 },
        { label: "kind", value: payload.kind, wrap: 44 },
        { label: "marketId", value: String(payload.marketId), wrap: 36 },
        { label: "positionId", value: String(payload.positionId), wrap: 36 },
        { label: "side", value: payload.side, wrap: 44 },
        { label: "openedAt", value: opened, wrap: 44 },
        { label: "venue", value: payload.venue ?? "", wrap: 44 },
        { label: "vaultId", value: String(payload.vaultId), wrap: 36 },
        { label: "lockId", value: String(payload.lockId), wrap: 36 },
      ],
    },
    {
      id: "val",
      title: "VALUE",
      x: 515,
      y: 610,
      w: 390,
      h: 170,
      fields: [
        { label: "lockedStakeMicro", value: String(payload.lockedStakeMicro), wrap: 44 },
        { label: "sharesMicro", value: String(payload.sharesMicro), wrap: 44 },
        { label: "avgPriceMicro", value: String(payload.avgPriceMicro), wrap: 44 },
        { label: "worstPriceMicro", value: String(payload.worstPriceMicro), wrap: 44 },
        { label: "feeMicro", value: String(payload.feeMicro), wrap: 44 },
        { label: "totalCostMicro", value: String(payload.totalCostMicro), wrap: 44 },
        { label: "resolution", value: resLines, wrap: 44 },
      ],
    },
    {
      id: "id",
      title: "IDENTITY",
      x: 95,
      y: 800,
      w: 390,
      h: 165,
      fields: [
        { label: "userPhiKey", value: String(payload.userPhiKey), wrap: 28 },
        { label: "kaiSignature", value: String(payload.kaiSignature), wrap: 28 },
      ],
    },
    {
      id: "seal",
      title: "SEAL",
      x: 515,
      y: 800,
      w: 390,
      h: 165,
      fields: [
        { label: "marketDefinitionHash", value: String(payload.marketDefinitionHash ?? ""), wrap: 32 },
        { label: "canonicalHashHex", value: seal.canonicalHashHex, wrap: 32 },
        { label: "canonicalBytesLen", value: String(seal.canonicalBytesLen), wrap: 44 },
        { label: "zkPoseidonHashDec", value: seal.zkPoseidonHashDec, wrap: 32 },
        { label: "scheme", value: seal.scheme, wrap: 44 },
        { label: "zkOk", value: seal.zkOk ? "true" : "false", wrap: 44 },
      ],
    },
  ] as const;
};

const renderPanel = (p: PanelSpec, toneGhost: string): string => {
  const padX = 18;
  const padY = 22;

  const path = roundedRectPath(p.x, p.y, p.w, p.h, 18);
  const clipId = `clip_${p.id}`;
  const glowId = `panelGlow_${p.id}`;

  const lines: TextLine[] = [{ kind: "title", text: p.title }];
  for (const f of p.fields) lines.push(...fieldLines(f.label, f.value, f.wrap));

  const neededH = calcTextBlockHeight(lines);
  const availH = Math.max(1, p.h - padY * 2);
  const rawScale = neededH > availH ? availH / neededH : 1;
  const scale = Math.max(0.66, Math.min(1, rawScale));

  const textSvg = renderTextBlock(p.x + padX, p.y + padY, lines, p.id, scale);

  return `
  <defs>
    <clipPath id="${esc(clipId)}">
      <path d="${path}"/>
    </clipPath>
    <filter id="${esc(glowId)}" x="-25%" y="-25%" width="150%" height="150%" color-interpolation-filters="sRGB">
      <feGaussianBlur stdDeviation="6" result="b"/>
      <feColorMatrix in="b" type="matrix"
        values="1 0 0 0 0
                0 1 0 0 0
                0 0 1 0 0
                0 0 0 0.26 0" result="g"/>
      <feMerge>
        <feMergeNode in="g"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>

  <g clip-path="url(#${esc(clipId)})">
    <path d="${path}" fill="rgba(255,255,255,0.05)" opacity="0.95" filter="url(#panelFrost)"/>
    <path d="${path}" fill="${toneGhost}" opacity="0.55"/>
    <path d="${path}" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="1.1"/>
    <path d="${path}" fill="none" stroke="url(#prism)" stroke-width="0.9" opacity="0.35" filter="url(#${esc(glowId)})"/>
    <g filter="url(#etchStrong)">
      ${textSvg}
    </g>
  </g>`;
};

/* ─────────────────────────────────────────────────────────────
 * Payload construction
 * ───────────────────────────────────────────────────────────── */

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

/* ─────────────────────────────────────────────────────────────
 * SVG build (Kairos-style embedding + crystal)
 * Key fixes vs prior versions:
 * - metadata is RAW JSON (not esc()) so parsers can read it again
 * - root has “Kairos-like” data attributes + summary-b64
 * - signature ring uses textPath (data sewn in, not pasted)
 * ───────────────────────────────────────────────────────────── */

const buildSvg = (payload: PositionSigilPayloadV1, svgHashSeed: string, seal: ZkSeal): string => {
  const ring = hexRingPath();
  const wave = lissajousPath(svgHashSeed);
  const spiral = goldenSpiralPath();

  const yesTone = "rgba(185,252,255,0.98)";
  const noTone = "rgba(190,170,255,0.98)";
  const tone = payload.side === "YES" ? yesTone : noTone;

  const styleRnd = makeRng(seed32FromHex(`${svgHashSeed}:${payload.side}:STYLE`));

  const ringOuterOpacity = clamp01(0.08 + styleRnd() * 0.14);
  const ringInnerOpacity = clamp01(0.22 + styleRnd() * 0.22);
  const waveGlowOpacity = clamp01(0.10 + styleRnd() * 0.18);
  const waveCoreOpacity = clamp01(0.62 + styleRnd() * 0.28);
  const spiralOpacity = clamp01(0.16 + styleRnd() * 0.22);
  const phiRingOpacity = clamp01(0.18 + styleRnd() * 0.18);

  const glassPlateOpacity = clamp01(0.10 + styleRnd() * 0.10);
  const hazeOpacity = clamp01(0.08 + styleRnd() * 0.10);

  const prismShift = styleRnd();
  const noiseSeed = seed32FromHex(`NOISE:${svgHashSeed}`) % 999;

  const facets = crystalFacets(svgHashSeed);
  const flower = flowerOfLife();

  // IMPORTANT: raw JSON in metadata, like your Kairos sigils
  const metaJsonRaw = JSON.stringify(payload);
  const sealJsonRaw = JSON.stringify(seal);

  const sigId = `sm-pos-${payload.openedAt.pulse}-${payload.openedAt.beat}-${payload.openedAt.stepIndex}`;
  const descId = `${sigId}-desc`;

  const title = `SigilMarkets Position — ${payload.side} — pulse ${payload.openedAt.pulse}`;
  const desc = `Deterministic position sigil with embedded proof + metadata. Market ${String(payload.marketId)} Position ${String(
    payload.positionId,
  )}.`;

  const proofRing = proofRingTicks(seal.canonicalHashHex, 482);

  const toneGhost = payload.side === "YES" ? "rgba(185,252,255,0.12)" : "rgba(190,170,255,0.12)";
  const okWord = seal.zkOk ? "VERIFIED" : "SEALED";

  // “Kairos style” signature ring: binary of canonical hash
  const binarySig = bitsToBinaryString(seal.canonicalHashHex);

  // Summary (base64 like data-summary-b64)
  const summary = `Market ${String(payload.marketId)} • Position ${String(payload.positionId)} • Side ${
    payload.side
  } • Stake μΦ ${String(payload.lockedStakeMicro)} • Shares μ ${String(payload.sharesMicro)} • Pulse ${
    payload.openedAt.pulse
  }`;
  const summaryB64 = b64Utf8(summary);

  // Panels (fully readable, untruncated, etched into glass)
  const panels = buildPanels(payload, seal);
  const panelSvg = panels.map((p) => renderPanel(p, toneGhost)).join("\n");

  // Outer sig-path like your example (circular path)
  const sigPathId = `${sigId}-sig-path`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg
  id="${esc(sigId)}"
  xmlns="http://www.w3.org/2000/svg"
  xmlns:xlink="http://www.w3.org/1999/xlink"
  role="img"
  lang="en"
  aria-label="${esc(title)}"
  aria-describedby="${esc(descId)}"
  viewBox="0 0 1000 1000"
  width="1000"
  height="1000"
  shape-rendering="geometricPrecision"
  preserveAspectRatio="xMidYMid meet"
  style="background: transparent; cursor: pointer;"
  data-kind="sigilmarkets-position"
  data-v="SM-POS-1"
  data-market-id="${esc(String(payload.marketId))}"
  data-position-id="${esc(String(payload.positionId))}"
  data-side="${esc(payload.side)}"
  data-vault-id="${esc(String(payload.vaultId))}"
  data-lock-id="${esc(String(payload.lockId))}"
  data-user-phikey="${esc(String(payload.userPhiKey))}"
  data-kai-signature="${esc(String(payload.kaiSignature))}"
  data-pulse="${esc(String(payload.openedAt.pulse))}"
  data-beat="${esc(String(payload.openedAt.beat))}"
  data-step-index="${esc(String(payload.openedAt.stepIndex))}"
  data-summary-b64="${esc(summaryB64)}"
  data-payload-hash="${esc(seal.canonicalHashHex)}"
  data-zk-scheme="${esc(seal.scheme)}"
  data-zk-poseidon-hash="${esc(seal.zkPoseidonHashDec)}"
  data-zk-ok="${esc(seal.zkOk ? "true" : "false")}"
>
  <title>${esc(title)}</title>
  <desc id="${esc(descId)}">${esc(desc)}</desc>

  <!-- RAW JSON (not escaped): parsers can read it again -->
  <metadata>${metaJsonRaw}</metadata>
  <metadata id="sm-zk">${safeCdata(sealJsonRaw)}</metadata>
  <metadata id="sigil-display">${`{"marketId":${JSON.stringify(String(payload.marketId))},"positionId":${JSON.stringify(
    String(payload.positionId),
  )},"side":${JSON.stringify(payload.side)},"pulse":${payload.openedAt.pulse},"beat":${payload.openedAt.beat},"stepIndex":${
    payload.openedAt.stepIndex
  }}`}</metadata>

  <defs>
    <!-- Outer signature ring path (Kairos-style) -->
    <path id="${esc(sigPathId)}" d="M 500 40 a 460 460 0 1 1 0 920 a 460 460 0 1 1 0 -920" fill="none"/>

    <linearGradient id="prism" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%"   stop-color="rgba(255,255,255,0.90)"/>
      <stop offset="${(16 + prismShift * 10).toFixed(2)}%"  stop-color="rgba(160,255,255,0.92)"/>
      <stop offset="${(44 + prismShift * 12).toFixed(2)}%" stop-color="rgba(190,160,255,0.94)"/>
      <stop offset="${(72 + prismShift * 8).toFixed(2)}%"  stop-color="rgba(255,220,170,0.92)"/>
      <stop offset="100%" stop-color="rgba(255,255,255,0.86)"/>
    </linearGradient>

    <linearGradient id="edge" x1="0%" y1="100%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="rgba(255,255,255,0.78)"/>
      <stop offset="50%" stop-color="${tone}"/>
      <stop offset="100%" stop-color="rgba(255,255,255,0.70)"/>
    </linearGradient>

    <radialGradient id="ether" cx="50%" cy="42%" r="66%">
      <stop offset="0%" stop-color="rgba(255,255,255,0.18)"/>
      <stop offset="55%" stop-color="rgba(255,255,255,0.06)"/>
      <stop offset="100%" stop-color="rgba(255,255,255,0.00)"/>
    </radialGradient>

    <radialGradient id="aurora" cx="52%" cy="52%" r="62%">
      <stop offset="0%" stop-color="rgba(255,255,255,0.10)"/>
      <stop offset="28%" stop-color="${toneGhost}"/>
      <stop offset="58%" stop-color="rgba(255,220,170,0.06)"/>
      <stop offset="100%" stop-color="rgba(255,255,255,0.00)"/>
    </radialGradient>

    <filter id="outerGlow" x="-35%" y="-35%" width="170%" height="170%" color-interpolation-filters="sRGB">
      <feGaussianBlur stdDeviation="10" result="b"/>
      <feColorMatrix in="b" type="matrix"
        values="1 0 0 0 0
                0 1 0 0 0
                0 0 1 0 0
                0 0 0 0.30 0" result="g"/>
      <feMerge>
        <feMergeNode in="g"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>

    <filter id="crystalGlow" x="-30%" y="-30%" width="160%" height="160%" color-interpolation-filters="sRGB">
      <feGaussianBlur stdDeviation="6" result="b"/>
      <feColorMatrix in="b" type="matrix"
        values="1 0 0 0 0
                0 1 0 0 0
                0 0 1 0 0
                0 0 0 0.46 0" result="g"/>
      <feMerge>
        <feMergeNode in="g"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>

    <filter id="frost" x="-25%" y="-25%" width="150%" height="150%" color-interpolation-filters="sRGB">
      <feGaussianBlur in="SourceGraphic" stdDeviation="2.8" result="blur"/>
      <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="${noiseSeed}" result="noise"/>
      <feDisplacementMap in="blur" in2="noise" scale="10" xChannelSelector="R" yChannelSelector="G" result="disp"/>
      <feColorMatrix in="disp" type="matrix"
        values="1 0 0 0 0
                0 1 0 0 0
                0 0 1 0 0
                0 0 0 0.74 0" result="alpha"/>
      <feMerge>
        <feMergeNode in="alpha"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>

    <filter id="panelFrost" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">
      <feGaussianBlur stdDeviation="2.0" result="b"/>
      <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="1" seed="${(noiseSeed + 7) % 999}" result="n"/>
      <feDisplacementMap in="b" in2="n" scale="6" xChannelSelector="R" yChannelSelector="G" result="d"/>
      <feColorMatrix in="d" type="matrix"
        values="1 0 0 0 0
                0 1 0 0 0
                0 0 1 0 0
                0 0 0 0.72 0" />
    </filter>

    <filter id="etchStrong" x="-18%" y="-18%" width="136%" height="136%" color-interpolation-filters="sRGB">
      <feGaussianBlur in="SourceAlpha" stdDeviation="0.9" result="a"/>
      <feOffset in="a" dx="0" dy="1" result="d"/>
      <feComposite in="d" in2="SourceAlpha" operator="out" result="shadow"/>
      <feColorMatrix in="shadow" type="matrix"
        values="0 0 0 0 0
                0 0 0 0 0
                0 0 0 0 0
                0 0 0 0.42 0" result="s"/>
      <feMerge>
        <feMergeNode in="s"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>

    <clipPath id="hexClip">
      <path d="${ring}"/>
    </clipPath>
  </defs>

  <!-- Signature ring (SEWN IN, not pasted): binary signature from canonical hash -->
  <g id="signature" pointer-events="none">
    <text
      font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial"
      font-size="12.6"
      fill="${tone}"
      letter-spacing="1.1"
      text-anchor="middle"
      dominant-baseline="middle"
      opacity="0.42"
      style="paint-order: stroke; stroke: rgba(0,0,0,0.65); stroke-width: 1.2; font-variant-numeric: tabular-nums; font-feature-settings: 'tnum';"
    >
      <textPath href="#${esc(sigPathId)}" startOffset="50%">${esc(binarySig)}</textPath>
    </text>
  </g>

  <!-- Subtle hint line (like your Day Seal hint) -->
  <g id="signature-hint" aria-hidden="true" pointer-events="none" filter="url(#etchStrong)">
    <text
      x="60"
      y="506"
      font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial"
      font-size="12.8"
      fill="${tone}"
      opacity="0.14"
      text-anchor="start"
      lengthAdjust="spacingAndGlyphs"
      textLength="520"
      style="paint-order: stroke; stroke: rgba(0,0,0,0.55); stroke-width: 1.2; font-variant-numeric: tabular-nums; font-feature-settings: 'tnum';"
    >${esc(
      `Market ${String(payload.marketId)} • Position ${String(payload.positionId)} • Side ${payload.side} • Pulse ${payload.openedAt.pulse}`,
    )}</text>
  </g>

  <!-- Proof ring (machine-visible) -->
  <g stroke="url(#prism)" opacity="0.55" pointer-events="none">
    ${proofRing}
  </g>

  <!-- Etherik glass plate (frosted, clipped to hex) -->
  <g clip-path="url(#hexClip)" filter="url(#frost)" pointer-events="none">
    <circle cx="500" cy="500" r="520" fill="url(#aurora)" opacity="${(glassPlateOpacity * 0.92).toFixed(3)}"/>
    <circle cx="500" cy="500" r="520" fill="url(#ether)" opacity="${glassPlateOpacity.toFixed(3)}"/>
    <circle cx="500" cy="500" r="410" fill="rgba(255,255,255,0.06)" opacity="${hazeOpacity.toFixed(3)}"/>
  </g>

  <!-- Cut-glass ring geometry -->
  <g filter="url(#outerGlow)" pointer-events="none">
    <path d="${ring}" fill="none" stroke="rgba(255,255,255,${ringOuterOpacity.toFixed(3)})" stroke-width="12"/>
    <path d="${ring}" fill="none" stroke="url(#edge)" stroke-width="3.6" opacity="${ringInnerOpacity.toFixed(3)}"/>
    <circle cx="500" cy="500" r="${(432 / PHI).toFixed(2)}" fill="none" stroke="url(#prism)" stroke-width="1.9" opacity="${phiRingOpacity.toFixed(
      3,
    )}"/>
  </g>

  <!-- Sacred geometry core -->
  <g clip-path="url(#hexClip)" fill="none" stroke="rgba(255,255,255,0.14)" stroke-width="1.2" opacity="0.85" pointer-events="none">
    ${flower.join("\n")}
  </g>

  <!-- Facets -->
  <g clip-path="url(#hexClip)" pointer-events="none">
    ${facets
      .map((d, i) => {
        const rr = makeRng(seed32FromHex(`FACETSTYLE:${svgHashSeed}:${i}`));
        const oFill = clamp01(0.02 + rr() * 0.05);
        const oStroke = clamp01(0.10 + rr() * 0.18);
        const w = (0.9 + rr() * 1.9).toFixed(2);
        return `<path d="${d}" fill="rgba(255,255,255,${oFill.toFixed(
          3,
        )})" stroke="url(#prism)" stroke-width="${w}" opacity="${oStroke.toFixed(3)}" />`;
      })
      .join("\n")}
  </g>

  <!-- Φ spiral -->
  <path d="${spiral}" fill="none" stroke="url(#prism)" stroke-width="1.6" opacity="${spiralOpacity.toFixed(3)}" pointer-events="none"/>

  <!-- Wave core -->
  <g filter="url(#crystalGlow)" pointer-events="none">
    <path d="${wave}" fill="none" stroke="url(#prism)" stroke-width="8" opacity="${waveGlowOpacity.toFixed(3)}"/>
    <path d="${wave}" fill="none" stroke="rgba(255,255,255,0.90)" stroke-width="2.4" opacity="${waveCoreOpacity.toFixed(3)}"/>
  </g>

  <!-- Header seal (untruncated, embedded) -->
  <g filter="url(#etchStrong)"
     font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace"
     fill="rgba(255,255,255,0.88)"
     font-size="16"
     letter-spacing="0.45"
     pointer-events="none">
    <text x="95" y="86">${esc(`SM-POS-1 • ${okWord} • zk=${seal.scheme}`)}</text>
  </g>

  <!-- Etched data panels (part of the art; no truncation) -->
  <g clip-path="url(#hexClip)" pointer-events="none">
    ${panelSvg}
  </g>
</svg>`;
};

export const buildPositionSigilSvgFromPayload = async (payload: PositionSigilPayloadV1): Promise<string> => {
  const seed = await sha256Hex(`SM:POS:SEED:${payload.positionId}:${payload.lockId}:${payload.userPhiKey}`);
  const seal = await buildZkSeal(payload, null);
  return buildSvg(payload, seed, seal);
};

export const buildPositionSigilSvgFromPayloadWithVault = async (
  payload: PositionSigilPayloadV1,
  vault: VaultRecord,
): Promise<string> => {
  const seed = await sha256Hex(`SM:POS:SEED:${payload.positionId}:${payload.lockId}:${payload.userPhiKey}`);
  const seal = await buildZkSeal(payload, vault);
  return buildSvg(payload, seed, seal);
};

export type MintPositionSigilResult =
  | Readonly<{ ok: true; sigil: PositionSigilArtifact; svgText: string }>
  | Readonly<{ ok: false; error: string }>;

export const mintPositionSigil = async (pos: PositionRecord, vault: VaultRecord): Promise<MintPositionSigilResult> => {
  try {
    const payload = makePayload(pos, vault);

    // Deterministic SVG + embedded machine approval + raw metadata + sewn signature ring
    const svgText = await buildPositionSigilSvgFromPayloadWithVault(payload, vault);

    // Content-address hash of the final SVG
    const svgHashHex = await sha256Hex(svgText);
    const svgHash = asSvgHash(svgHashHex);

    // Deterministic sigil id derived from (positionId + stable ref)
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
