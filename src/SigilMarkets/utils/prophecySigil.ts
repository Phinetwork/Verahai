// SigilMarkets/utils/prophecySigil.ts
"use client";

import type { EvidenceBundle } from "../types/oracleTypes";
import type { ProphecyId, ProphecySigilPayloadV1, ProphecySigilZkBundle } from "../types/prophecySigilTypes";
import { asProphecyId } from "../types/prophecySigilTypes";
import type { KaiPulse, MicroDecimalString, PhiMicro } from "../types/marketTypes";
import type { KaiMoment as KaiMomentExact } from "../../utils/kai_pulse";
import { STEPS_BEAT } from "../../utils/kai_pulse";
import { stepIndexFromPulse, stepProgressWithinStepFromPulse } from "../../utils/kaiMath";
import { asMicroDecimalString } from "../types/marketTypes";
import type { KaiSignature, UserPhiKey } from "../types/vaultTypes";
import { sha256Hex } from "./ids";

/* ───────────────────────── JSON canonicalization ───────────────────────── */

type JSONPrimitive = string | number | boolean | null;
interface JSONObject {
  readonly [k: string]: JSONValue;
}
type JSONValue = JSONPrimitive | ReadonlyArray<JSONValue> | JSONObject;

type UnknownRecord = Record<string, unknown>;
const isRecord = (v: unknown): v is UnknownRecord => typeof v === "object" && v !== null;

const isJsonPrimitive = (v: unknown): v is JSONPrimitive =>
  v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean";

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

export const stableStringify = (v: JSONValue): string => {
  if (v === null) return "null";
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : JSON.stringify(String(v));
  if (typeof v === "boolean") return v ? "true" : "false";
  if (Array.isArray(v)) return `[${v.map((x) => stableStringify(x)).join(",")}]`;
  if (typeof v !== "object" || v === null) return JSON.stringify(String(v));
  const keys = Object.keys(v).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const obj = v as JSONObject;
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
};

const esc = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const safeCdata = (raw: string): string => {
  const safe = raw.replace(/]]>/g, "]]]]><![CDATA[>");
  return `<![CDATA[${safe}]]>`;
};

/* ───────────────────────── text encoding ───────────────────────── */

export type ProphecyTextEncoding = "uri";

export const encodeProphecyText = (text: string): Readonly<{ enc: ProphecyTextEncoding; encoded: string }> => ({
  enc: "uri",
  encoded: encodeURIComponent(text),
});

export const decodeProphecyText = (text: string, enc: ProphecyTextEncoding | string | undefined): string => {
  if (enc === "uri") {
    try {
      return decodeURIComponent(text);
    } catch {
      return text;
    }
  }
  return text;
};

/* ───────────────────────── canonical hashing ───────────────────────── */

export const deriveProphecyId = async (args: Readonly<{
  userPhiKey: UserPhiKey;
  pulse: KaiPulse;
  text: string;
}>): Promise<ProphecyId> => {
  const base = `SM:PROPHECY:ID:${args.userPhiKey}:${args.pulse}:${args.text}`;
  const h = await sha256Hex(base);
  return asProphecyId(`prophecy_${h.slice(0, 40)}`);
};

export const toMicroDecimal = (v: PhiMicro | undefined): MicroDecimalString | undefined => {
  if (v === undefined) return undefined;
  const s = (v as unknown as bigint).toString(10);
  return asMicroDecimalString(s);
};

export const canonicalPayloadForProphecy = (payload: Omit<ProphecySigilPayloadV1, "canonicalHash" | "zk">): JSONValue =>
  toJsonValue({
    v: payload.v,
    kind: payload.kind,
    prophecyId: payload.prophecyId,
    text: payload.text,
    textEnc: payload.textEnc,
    category: payload.category ?? null,
    expirationPulse: payload.expirationPulse ?? null,
    escrowPhiMicro: payload.escrowPhiMicro ?? null,
    evidence: payload.evidence ?? null,
    userPhiKey: payload.userPhiKey,
    kaiSignature: payload.kaiSignature,
    pulse: payload.pulse,
    beat: payload.beat,
    stepIndex: payload.stepIndex,
    stepPct: payload.stepPct,
    chakraDay: payload.chakraDay,
    createdAtPulse: payload.createdAtPulse,
  });

export const computeProphecyCanonicalHash = async (
  payload: Omit<ProphecySigilPayloadV1, "canonicalHash" | "zk">
): Promise<string> => {
  const canon = canonicalPayloadForProphecy(payload);
  const canonStr = stableStringify(canon);
  return (await sha256Hex(`SM:PROPHECY:CANON:${canonStr}`)).toLowerCase();
};

/* ───────────────────────── SVG parsing ───────────────────────── */

const getAttr = (svg: Element, key: string): string | undefined => {
  const v = svg.getAttribute(key);
  return v && v.trim().length > 0 ? v.trim() : undefined;
};

const getFirstMetadataJson = (doc: Document): Record<string, unknown> | null => {
  const meta = doc.querySelector("metadata#sm-prophecy") ?? doc.querySelector("metadata");
  const raw = meta?.textContent ?? "";
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
};

export type ParsedProphecySigil = Readonly<{
  payload: Partial<ProphecySigilPayloadV1>;
  textDecoded?: string;
  zk?: ProphecySigilZkBundle;
}>;

export const parseProphecySigilSvg = (svgText: string): ParsedProphecySigil => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, "image/svg+xml");
  const svg = doc.documentElement;

  const payload: Partial<ProphecySigilPayloadV1> = {};
  const meta = getFirstMetadataJson(doc);
  if (meta && isRecord(meta)) {
    Object.assign(payload, meta as Partial<ProphecySigilPayloadV1>);
  }

  payload.kind ??= getAttr(svg, "data-kind") as "prophecy" | undefined;
  payload.v ??= getAttr(svg, "data-v") as "SM-PROPHECY-1" | undefined;
  payload.prophecyId ??= getAttr(svg, "data-prophecy-id") as ProphecyId | undefined;
  payload.userPhiKey ??= getAttr(svg, "data-phikey") as UserPhiKey | undefined;
  payload.kaiSignature ??= getAttr(svg, "data-kai-signature") as KaiSignature | undefined;

  const textEnc = (payload.textEnc ?? getAttr(svg, "data-text-enc")) as string | undefined;
  const textEncoded = getAttr(svg, "data-text") ?? (payload as { textEncoded?: string }).textEncoded;
  if (textEncoded && typeof payload.text !== "string") {
    payload.text = decodeProphecyText(textEncoded, textEnc);
  }
  if (textEnc && typeof payload.textEnc !== "string") {
    payload.textEnc = textEnc as ProphecyTextEncoding;
  }

  const categoryAttr = getAttr(svg, "data-category");
  if (categoryAttr && typeof payload.category !== "string") payload.category = categoryAttr;

  const expirationAttr = getAttr(svg, "data-expiration");
  if (expirationAttr && typeof payload.expirationPulse !== "number") {
    const n = Number(expirationAttr);
    if (Number.isFinite(n)) payload.expirationPulse = n as KaiPulse;
  }

  const escrowAttr = getAttr(svg, "data-phi-escrow-micro");
  if (escrowAttr && typeof payload.escrowPhiMicro !== "string") {
    payload.escrowPhiMicro = escrowAttr as MicroDecimalString;
  }

  const pulseRaw = getAttr(svg, "data-pulse");
  const beatRaw = getAttr(svg, "data-beat");
  const stepRaw = getAttr(svg, "data-step-index");
  const stepPctRaw = getAttr(svg, "data-step-pct");

  if (pulseRaw && !payload.pulse) payload.pulse = Number(pulseRaw) as KaiPulse;
  if (beatRaw && payload.beat == null) payload.beat = Number(beatRaw);
  if (stepRaw && payload.stepIndex == null) payload.stepIndex = Number(stepRaw);
  if (stepPctRaw && payload.stepPct == null) payload.stepPct = Number(stepPctRaw);

  const chakraDay = getAttr(svg, "data-chakra-day");
  if (chakraDay && !payload.chakraDay) payload.chakraDay = chakraDay;

  const canonicalHash = getAttr(svg, "data-payload-hash") ?? getAttr(svg, "data-canonical-hash");
  if (canonicalHash && !payload.canonicalHash) payload.canonicalHash = canonicalHash;

  const scheme = getAttr(svg, "data-zk-scheme") ?? (payload.zk ? payload.zk.scheme : undefined);
  const poseidonHash = getAttr(svg, "data-zk-poseidon-hash") ?? (payload.zk ? payload.zk.poseidonHash : undefined);
  const zkPublic = getAttr(svg, "data-zk-public") ?? getAttr(svg, "data-zk-public-inputs");

  let publicInputs: string[] | undefined;
  if (zkPublic) {
    try {
      const decoded = JSON.parse(zkPublic) as unknown;
      if (Array.isArray(decoded)) publicInputs = decoded.map((entry) => String(entry));
      else publicInputs = [String(decoded)];
    } catch {
      publicInputs = [zkPublic];
    }
  }

  const zkMeta = isRecord(meta?.zk) ? (meta?.zk as Record<string, unknown>) : undefined;
  let proof = zkMeta && isRecord(zkMeta) && "proof" in zkMeta ? zkMeta.proof : undefined;
  const proofAttr = getAttr(svg, "data-zk-proof");
  if (!proof && proofAttr) {
    try {
      proof = JSON.parse(proofAttr) as unknown;
    } catch {
      proof = proofAttr;
    }
  }

  const zk: ProphecySigilZkBundle | undefined =
    scheme || poseidonHash || publicInputs || proof
      ? {
          scheme: typeof scheme === "string" ? scheme : "groth16-poseidon",
          poseidonHash: typeof poseidonHash === "string" ? poseidonHash : undefined,
          publicInputs: publicInputs,
          proof: proof,
          verifiedHint: typeof zkMeta?.verifiedHint === "boolean" ? (zkMeta?.verifiedHint as boolean) : undefined,
        }
      : undefined;

  return {
    payload,
    textDecoded: payload.text,
    zk,
  };
};

export const buildProphecyPayloadBase = (args: Readonly<{
  prophecyId: ProphecyId;
  text: string;
  textEnc: ProphecyTextEncoding;
  category?: string;
  expirationPulse?: KaiPulse;
  escrowPhiMicro?: MicroDecimalString;
  evidence?: EvidenceBundle;
  userPhiKey: UserPhiKey;
  kaiSignature: KaiSignature;
  moment: KaiMomentExact;
}>): Omit<ProphecySigilPayloadV1, "canonicalHash" | "zk"> => {
  const stepIndex = stepIndexFromPulse(args.moment.pulse, STEPS_BEAT);
  const stepProgress = stepProgressWithinStepFromPulse(args.moment.pulse, STEPS_BEAT);
  const stepPct = (stepIndex + stepProgress) / STEPS_BEAT;

  return {
    v: "SM-PROPHECY-1",
    kind: "prophecy",
    prophecyId: args.prophecyId,
    text: args.text,
    textEnc: args.textEnc,
    category: args.category,
    expirationPulse: args.expirationPulse,
    escrowPhiMicro: args.escrowPhiMicro,
    evidence: args.evidence,
    userPhiKey: args.userPhiKey,
    kaiSignature: args.kaiSignature,
    pulse: args.moment.pulse,
    beat: args.moment.beat,
    stepIndex,
    stepPct,
    chakraDay: args.moment.chakraDay,
    createdAtPulse: args.moment.pulse,
  };
};

export const buildProphecySvg = (payload: ProphecySigilPayloadV1, textEncoded?: string): string => {
  const textEnc = payload.textEnc ?? "uri";
  const encodedText = textEncoded ?? encodeURIComponent(payload.text);

  const zk = payload.zk ?? {};
  const proofJson = zk.proof ? JSON.stringify(zk.proof) : "";
  const publicInputsJson = zk.publicInputs ? JSON.stringify(zk.publicInputs) : "";
  const poseidonHash = zk.poseidonHash ?? "";

  const payloadJson = JSON.stringify({ ...payload, textEncoded: encodedText, textEnc });
  const zkJson = JSON.stringify({
    scheme: zk.scheme ?? "groth16-poseidon",
    proof: zk.proof ?? null,
    publicInputs: zk.publicInputs ?? null,
    poseidonHash,
    verifiedHint: zk.verifiedHint ?? undefined,
  });

  const descText = payload.text.replace(/\s+/g, " ").slice(0, 140);
  const desc = `Prophecy • ${descText}${payload.expirationPulse ? ` • exp p${payload.expirationPulse}` : ""}`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
  viewBox="0 0 1000 1000"
  width="1000" height="1000"
  role="img"
  aria-label="${esc(`Prophecy Sigil ${payload.prophecyId}`)}"
  data-kind="prophecy"
  data-v="SM-PROPHECY-1"
  data-prophecy-id="${esc(payload.prophecyId)}"
  data-text="${esc(encodedText)}"
  data-text-enc="${esc(textEnc)}"
  data-category="${payload.category ? esc(payload.category) : ""}"
  data-expiration="${payload.expirationPulse != null ? esc(String(payload.expirationPulse)) : ""}"
  data-phikey="${esc(payload.userPhiKey)}"
  data-kai-signature="${esc(payload.kaiSignature)}"
  data-pulse="${esc(String(payload.pulse))}"
  data-beat="${esc(String(payload.beat))}"
  data-step-index="${esc(String(payload.stepIndex))}"
  data-step-pct="${esc(String(payload.stepPct))}"
  data-chakra-day="${esc(String(payload.chakraDay))}"
  data-payload-hash="${esc(payload.canonicalHash)}"
  data-zk-scheme="${esc(zk.scheme ?? "groth16-poseidon")}"
  data-zk-proof="${esc(proofJson)}"
  data-zk-public="${esc(publicInputsJson)}"
  data-zk-public-inputs="${esc(publicInputsJson)}"
  data-zk-poseidon-hash="${esc(String(poseidonHash))}"
  data-evidence-hash="${payload.evidence?.bundleHash ? esc(String(payload.evidence.bundleHash)) : ""}"
  data-evidence-urls="${payload.evidence?.items
    ? esc(
        payload.evidence.items
          .filter((it) => it.kind === "url")
          .map((it) => it.url)
          .join("|"),
      )
    : ""}"
  data-phi-escrow-micro="${payload.escrowPhiMicro ? esc(String(payload.escrowPhiMicro)) : ""}">
  <title>${esc(`Prophecy Sigil • p${payload.pulse}`)}</title>
  <desc>${esc(desc)}</desc>
  <metadata id="sm-prophecy">${safeCdata(payloadJson)}</metadata>
  <metadata id="sm-zk">${safeCdata(zkJson)}</metadata>

  <defs>
    <radialGradient id="bg" cx="50%" cy="38%" r="70%">
      <stop offset="0%" stop-color="rgba(255,255,255,0.10)"/>
      <stop offset="60%" stop-color="rgba(0,0,0,0.00)"/>
      <stop offset="100%" stop-color="rgba(0,0,0,0.22)"/>
    </radialGradient>
    <linearGradient id="pulse" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="rgba(120,255,240,0.85)"/>
      <stop offset="100%" stop-color="rgba(120,150,255,0.85)"/>
    </linearGradient>
    <filter id="glow" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="9" result="b"/>
      <feColorMatrix in="b" type="matrix"
        values="1 0 0 0 0
                0 1 0 0 0
                0 0 1 0 0
                0 0 0 0.42 0"/>
      <feMerge>
        <feMergeNode/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>

  <rect x="0" y="0" width="1000" height="1000" fill="rgba(8,10,18,1)"/>
  <rect x="0" y="0" width="1000" height="1000" fill="url(#bg)"/>

  <circle cx="500" cy="500" r="360" fill="none" stroke="rgba(255,255,255,0.10)" stroke-width="10"/>
  <circle cx="500" cy="500" r="320" fill="none" stroke="url(#pulse)" stroke-width="4" opacity="0.8"/>
  <circle cx="500" cy="500" r="220" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="2"/>

  <circle cx="500" cy="500" r="128" fill="rgba(8,10,18,0.6)" stroke="rgba(255,255,255,0.12)" stroke-width="2"/>
  <circle cx="500" cy="500" r="98" fill="none" stroke="url(#pulse)" stroke-width="6" filter="url(#glow)" opacity="0.9"/>

  <g font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace" fill="rgba(255,255,255,0.78)">
    <text x="70" y="88" font-size="22">SM-PROPHECY-1</text>
    <text x="70" y="120" font-size="16">p${esc(String(payload.pulse))} • beat ${esc(String(payload.beat))} • step ${esc(String(payload.stepIndex))}</text>
    <text x="70" y="152" font-size="16">ΦKey ${esc(String(payload.userPhiKey)).slice(0, 12)}…</text>
    <text x="70" y="184" font-size="14">zk ${esc(zk.scheme ?? "groth16-poseidon")} • ${poseidonHash ? `poseidon ${esc(String(poseidonHash)).slice(0, 12)}…` : ""}</text>

    <text x="70" y="910" font-size="16">${esc(payload.category ?? "Prophecy")}</text>
    <text x="70" y="940" font-size="14">${esc(descText)}</text>
  </g>
</svg>`;
};
