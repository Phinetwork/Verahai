import { XMLParser } from "fast-xml-parser";
import { gunzipB64 } from "../lib/sigil/codec";
import type { ProofCapsuleV1 } from "../components/KaiVoh/verifierProof";
import type { AuthorSig } from "./authorSig";
import { parseAuthorSig } from "./authorSig";

export type EmbeddedMeta = {
  pulse?: number;
  pulseExact?: string;
  beat?: number;
  stepIndex?: number;
  frequencyHz?: number;
  chakraDay?: string;
  chakraGate?: string;
  kaiSignature?: string;
  phiKey?: string;
  timestamp?: string;
  shareUrl?: string;
  verifierUrl?: string;
  proofCapsule?: ProofCapsuleV1;
  capsuleHash?: string;
  svgHash?: string;
  bundleHash?: string;
  hashAlg?: string;
  canon?: string;
  authorSig?: AuthorSig | null;
  zkPoseidonHash?: string;
  zkProof?: unknown;
  proofHints?: unknown;
  zkPublicInputs?: unknown;
  raw?: unknown;
};

const XML_PARSER = new XMLParser({
  ignoreAttributes: false,
  allowBooleanAttributes: true,
  trimValues: true,
  cdataPropName: "__cdata",
});

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function safeJsonParse(s: string): unknown | null {
  const t = s.trim();
  if (!t) return null;
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

function tryDecodeEmbeddedPayload(raw: Record<string, unknown>): Record<string, unknown> | null {
  const payload = raw.payload;
  if (typeof payload !== "string" || payload.trim().length === 0) return null;
  try {
    const bytes = gunzipB64(payload);
    const text = new TextDecoder().decode(bytes);
    const parsed = safeJsonParse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function toEmbeddedMetaFromUnknown(raw: unknown): EmbeddedMeta {
  if (!isRecord(raw)) return { raw };

  const capsuleRaw = isRecord(raw.proofCapsule) ? raw.proofCapsule : undefined;
  const decodedPayload = tryDecodeEmbeddedPayload(raw);

  const kaiSignature =
    typeof raw.kaiSignature === "string"
      ? raw.kaiSignature
      : typeof capsuleRaw?.kaiSignature === "string"
        ? capsuleRaw.kaiSignature
        : undefined;

  const pulse =
    typeof raw.pulse === "number" && Number.isFinite(raw.pulse)
      ? raw.pulse
      : typeof capsuleRaw?.pulse === "number" && Number.isFinite(capsuleRaw.pulse)
        ? capsuleRaw.pulse
        : undefined;
  const pulseExact = typeof raw.pulseExact === "string" ? raw.pulseExact : undefined;

  const beat =
    typeof raw.beat === "number" && Number.isFinite(raw.beat) ? raw.beat : undefined;

  const stepIndex =
    typeof raw.stepIndex === "number" && Number.isFinite(raw.stepIndex) ? raw.stepIndex : undefined;

  const frequencyHz =
    typeof raw.frequencyHz === "number" && Number.isFinite(raw.frequencyHz)
      ? raw.frequencyHz
      : undefined;

  const chakraDay =
    typeof raw.chakraDay === "string"
      ? raw.chakraDay
      : typeof capsuleRaw?.chakraDay === "string"
        ? capsuleRaw.chakraDay
        : undefined;

  const chakraGate =
    typeof raw.chakraGate === "string" ? raw.chakraGate : undefined;

  const timestamp =
    typeof raw.timestamp === "string" ? raw.timestamp : undefined;

  const shareUrl =
    typeof raw.shareUrl === "string"
      ? raw.shareUrl
      : isRecord(raw.header) && typeof raw.header.shareUrl === "string"
        ? raw.header.shareUrl
        : undefined;

  const phiKeyRaw = typeof raw.phiKey === "string" ? raw.phiKey : undefined;
  const userPhiKey = typeof raw.userPhiKey === "string" ? raw.userPhiKey : undefined;
  const capsulePhiKey = typeof capsuleRaw?.phiKey === "string" ? capsuleRaw.phiKey : undefined;

  const phiKey =
    phiKeyRaw && !phiKeyRaw.startsWith("φK-")
      ? phiKeyRaw
      : capsulePhiKey ??
        userPhiKey;

  const verifierUrl =
    typeof raw.verifierUrl === "string" ? raw.verifierUrl : undefined;

  const proofCapsule =
    capsuleRaw &&
    typeof capsuleRaw.v === "string" &&
    typeof capsuleRaw.kaiSignature === "string" &&
    typeof capsuleRaw.phiKey === "string" &&
    typeof capsuleRaw.verifierSlug === "string" &&
    typeof capsuleRaw.pulse === "number" &&
    typeof capsuleRaw.chakraDay === "string"
      ? (capsuleRaw as ProofCapsuleV1)
      : undefined;

  const zkPoseidonHash =
    typeof raw.zkPoseidonHash === "string"
      ? raw.zkPoseidonHash
      : typeof decodedPayload?.zkPoseidonHash === "string"
        ? decodedPayload.zkPoseidonHash
        : undefined;
  const zkProof =
    "zkProof" in raw
      ? raw.zkProof
      : decodedPayload && "zkProof" in decodedPayload
        ? decodedPayload.zkProof
        : undefined;
  const proofHints =
    "proofHints" in raw
      ? raw.proofHints
      : decodedPayload && "proofHints" in decodedPayload
        ? decodedPayload.proofHints
        : undefined;
  const zkPublicInputs =
    "zkPublicInputs" in raw
      ? raw.zkPublicInputs
      : decodedPayload && "zkPublicInputs" in decodedPayload
        ? decodedPayload.zkPublicInputs
        : undefined;

  const capsuleHash = typeof raw.capsuleHash === "string" ? raw.capsuleHash : undefined;
  const svgHash = typeof raw.svgHash === "string" ? raw.svgHash : undefined;
  const bundleHash = typeof raw.bundleHash === "string" ? raw.bundleHash : undefined;
  const hashAlg = typeof raw.hashAlg === "string" ? raw.hashAlg : undefined;
  const canon = typeof raw.canon === "string" ? raw.canon : undefined;
  const authorSig = parseAuthorSig(raw.authorSig);

  return {
    pulse,
    pulseExact,
    beat,
    stepIndex,
    frequencyHz,
    chakraDay,
    chakraGate,
    kaiSignature,
    phiKey,
    timestamp,
    shareUrl,
    verifierUrl,
    proofCapsule,
    capsuleHash,
    svgHash,
    bundleHash,
    hashAlg,
    canon,
    authorSig,
    zkPoseidonHash,
    zkProof,
    proofHints,
    zkPublicInputs,
    raw,
  };
}

function collectText(node: unknown, texts: string[]): void {
  if (typeof node === "string") {
    texts.push(node);
    return;
  }
  if (!isRecord(node)) return;

  if (typeof node.__cdata === "string") {
    texts.push(node.__cdata);
  }

  for (const value of Object.values(node)) {
    collectText(value, texts);
  }
}

function extractNearbyJsonBlocks(text: string, matchIndex: number, window = 2000): string[] {
  const start = Math.max(0, matchIndex - window);
  const end = Math.min(text.length, matchIndex + window);
  const slice = text.slice(start, end);
  const targetIndex = matchIndex - start;

  const blocks: Array<{ start: number; end: number }> = [];
  const stack: number[] = [];
  let inString = false;
  let escaping = false;

  for (let i = 0; i < slice.length; i += 1) {
    const ch = slice[i];

    if (inString) {
      if (escaping) {
        escaping = false;
        continue;
      }
      if (ch === "\\") {
        escaping = true;
        continue;
      }
      if (ch === "\"") {
        inString = false;
      }
      continue;
    }

    if (ch === "\"") {
      inString = true;
      continue;
    }

    if (ch === "{") {
      stack.push(i);
      continue;
    }

    if (ch === "}") {
      const blockStart = stack.pop();
      if (blockStart == null) continue;
      if (blockStart <= targetIndex && i >= targetIndex) {
        blocks.push({ start: blockStart, end: i });
      }
    }
  }

  blocks.sort((a, b) => (b.end - b.start) - (a.end - a.start));
  return blocks.map(({ start: s, end: e }) => slice.slice(s, e + 1));
}

function findJsonInText(text: string): EmbeddedMeta | null {
  const parsed = safeJsonParse(text);
  if (parsed) {
    const parsedMeta = toEmbeddedMetaFromUnknown(parsed);
    if (parsedMeta.kaiSignature) return parsedMeta;
  }

  const matches = [...text.matchAll(/"kaiSignature"\s*:/g)];
  if (!matches.length) return null;

  for (const match of matches) {
    const idx = match.index ?? 0;
    const blocks = extractNearbyJsonBlocks(text, idx);
    for (const block of blocks) {
      if (!block.includes('"kaiSignature"')) continue;
      const blobParsed = safeJsonParse(block);
      if (!blobParsed) continue;
      const meta = toEmbeddedMetaFromUnknown(blobParsed);
      if (meta.kaiSignature) return meta;
    }
  }

  return null;
}

function isProofBundleMeta(meta: EmbeddedMeta): boolean {
  return Boolean(meta.bundleHash || (meta.capsuleHash && meta.svgHash));
}

function findProofBundleInText(text: string): ProofBundleMeta | null {
  const parsed = safeJsonParse(text);
  if (parsed) {
    const meta = toEmbeddedMetaFromUnknown(parsed);
    if (isProofBundleMeta(meta)) {
      return {
        hashAlg: meta.hashAlg,
        canon: meta.canon,
        proofCapsule: meta.proofCapsule,
        capsuleHash: meta.capsuleHash,
        svgHash: meta.svgHash,
        bundleHash: meta.bundleHash,
        verifierUrl: meta.verifierUrl,
        authorSig: meta.authorSig,
        zkPoseidonHash: meta.zkPoseidonHash,
        zkProof: meta.zkProof,
        proofHints: meta.proofHints,
        zkPublicInputs: meta.zkPublicInputs,
        raw: parsed,
      };
    }
  }

  const matches = [...text.matchAll(/"(bundleHash|capsuleHash|svgHash)"\s*:/g)];
  if (!matches.length) return null;

  for (const match of matches) {
    const idx = match.index ?? 0;
    const blocks = extractNearbyJsonBlocks(text, idx);
    for (const block of blocks) {
      if (!/(bundleHash|capsuleHash|svgHash)/.test(block)) continue;
      const blobParsed = safeJsonParse(block);
      if (!blobParsed) continue;
      const meta = toEmbeddedMetaFromUnknown(blobParsed);
      if (!isProofBundleMeta(meta)) continue;
      return {
        hashAlg: meta.hashAlg,
        canon: meta.canon,
        proofCapsule: meta.proofCapsule,
        capsuleHash: meta.capsuleHash,
        svgHash: meta.svgHash,
        bundleHash: meta.bundleHash,
        verifierUrl: meta.verifierUrl,
        authorSig: meta.authorSig,
        zkPoseidonHash: meta.zkPoseidonHash,
        zkProof: meta.zkProof,
        proofHints: meta.proofHints,
        zkPublicInputs: meta.zkPublicInputs,
        raw: blobParsed,
      };
    }
  }

  return null;
}

function extractFromParsedSvg(parsed: Record<string, unknown>): EmbeddedMeta | null {
  const svg = isRecord(parsed.svg) ? parsed.svg : parsed;
  const candidates: string[] = [];

  if (isRecord(svg.metadata)) {
    collectText(svg.metadata, candidates);
  } else if (typeof svg.metadata === "string") {
    candidates.push(svg.metadata);
  }

  if (isRecord(svg.desc)) {
    collectText(svg.desc, candidates);
  } else if (typeof svg.desc === "string") {
    candidates.push(svg.desc);
  }

  for (const text of candidates) {
    const meta = findJsonInText(text);
    if (meta) return meta;
  }

  return null;
}

function getAttr(svg: string, key: string): string | undefined {
  const pattern = `${key}\\s*=\\s*("([^"]*)"|'([^']*)')`;
  const match = svg.match(new RegExp(pattern, "i"));
  if (!match) return undefined;
  return match[2] ?? match[3];
}

function getNumberAttr(svg: string, key: string): number | undefined {
  const raw = getAttr(svg, key);
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function extractAttrFallback(svgText: string): EmbeddedMeta {
  const pulse = getNumberAttr(svgText, "data-pulse");
  const beat = getNumberAttr(svgText, "data-beat");
  const stepIndex = getNumberAttr(svgText, "data-step-index");
  const frequencyHz = getNumberAttr(svgText, "data-frequency-hz");
  const chakraGate = getAttr(svgText, "data-chakra-gate");
  const chakraDay = getAttr(svgText, "data-harmonic-day") ?? getAttr(svgText, "data-chakra-day");
  const kaiSignature = getAttr(svgText, "data-kai-signature");
  const phiKey = getAttr(svgText, "data-phi-key");
  const shareUrl = getAttr(svgText, "data-share-url");
  const zkPoseidonHash = getAttr(svgText, "data-zk-poseidon-hash");
  const zkPublicInputs = getAttr(svgText, "data-zk-public-inputs");

  return {
    pulse,
    beat,
    stepIndex,
    frequencyHz,
    chakraDay,
    chakraGate,
    kaiSignature,
    phiKey,
    shareUrl,
    zkPoseidonHash,
    zkPublicInputs,
  };
}

function mergeEmbeddedMeta(primary: EmbeddedMeta, fallback: EmbeddedMeta): EmbeddedMeta {
  const merged: EmbeddedMeta = { ...primary };
  for (const [key, value] of Object.entries(fallback)) {
    if (value === undefined) continue;
    const current = (merged as Record<string, unknown>)[key];
    if (current === undefined || current === null) {
      (merged as Record<string, unknown>)[key] = value;
    }
  }
  return merged;
}

export function extractEmbeddedMetaFromSvg(svgText: string): EmbeddedMeta {
  const attrFallback = extractAttrFallback(svgText);
  try {
    const parsed = XML_PARSER.parse(svgText);
    if (isRecord(parsed)) {
      const meta = extractFromParsedSvg(parsed);
      if (meta) return mergeEmbeddedMeta(meta, attrFallback);
    }
  } catch (err) {
    console.warn("sigilMetadata: failed to parse SVG", err);
  }

  const fallback = findJsonInText(svgText);
  if (fallback) return mergeEmbeddedMeta(fallback, attrFallback);
  return attrFallback;
}

export type ProofBundleMeta = {
  hashAlg?: string;
  canon?: string;
  proofCapsule?: ProofCapsuleV1;
  capsuleHash?: string;
  svgHash?: string;
  bundleHash?: string;
  shareUrl?: string;
  verifierUrl?: string;
  authorSig?: AuthorSig | null;
  zkPoseidonHash?: string;
  zkProof?: unknown;
  proofHints?: unknown;
  zkPublicInputs?: unknown;
  raw?: unknown;
};

export function extractProofBundleMetaFromSvg(svgText: string): ProofBundleMeta | null {
  const vohMatch = svgText.match(
    /<metadata[^>]*id=["']kai-voh-proof["'][^>]*>([\s\S]*?)<\/metadata>/i
  );
  if (vohMatch) {
    const rawBlock = vohMatch[1]?.trim() ?? "";
    if (rawBlock) {
      const cleaned = rawBlock.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
      const parsed = safeJsonParse(cleaned);
      if (parsed) {
        const meta = toEmbeddedMetaFromUnknown(parsed);
        return {
          hashAlg: meta.hashAlg,
          canon: meta.canon,
          proofCapsule: meta.proofCapsule,
          capsuleHash: meta.capsuleHash,
          svgHash: meta.svgHash,
          bundleHash: meta.bundleHash,
          shareUrl: meta.shareUrl,
          verifierUrl: meta.verifierUrl,
          authorSig: meta.authorSig,
          zkPoseidonHash: meta.zkPoseidonHash,
          zkProof: meta.zkProof,
          proofHints: meta.proofHints,
          zkPublicInputs: meta.zkPublicInputs,
          raw: parsed,
        };
      }
    }
  }

  const match = svgText.match(
    /<metadata[^>]*id=["'](?:kai-proof|kai-voh-proof)["'][^>]*>([\s\S]*?)<\/metadata>/i
  );
  if (match) {
    const rawBlock = match[1]?.trim() ?? "";
    if (rawBlock) {
      const cleaned = rawBlock.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
      const parsed = safeJsonParse(cleaned);
      if (parsed) {
        const meta = toEmbeddedMetaFromUnknown(parsed);
        return {
          hashAlg: meta.hashAlg,
          canon: meta.canon,
          proofCapsule: meta.proofCapsule,
          capsuleHash: meta.capsuleHash,
          svgHash: meta.svgHash,
          bundleHash: meta.bundleHash,
          shareUrl: meta.shareUrl,
          verifierUrl: meta.verifierUrl,
          authorSig: meta.authorSig,
          zkPoseidonHash: meta.zkPoseidonHash,
          zkProof: meta.zkProof,
          proofHints: meta.proofHints,
          zkPublicInputs: meta.zkPublicInputs,
          raw: parsed,
        };
      }
    }
  }

  try {
    const parsedSvg = XML_PARSER.parse(svgText);
    if (isRecord(parsedSvg)) {
      const svg = isRecord(parsedSvg.svg) ? parsedSvg.svg : parsedSvg;
      const candidates: string[] = [];

      if (isRecord(svg.metadata)) {
        collectText(svg.metadata, candidates);
      } else if (typeof svg.metadata === "string") {
        candidates.push(svg.metadata);
      }

      if (isRecord(svg.desc)) {
        collectText(svg.desc, candidates);
      } else if (typeof svg.desc === "string") {
        candidates.push(svg.desc);
      }

      for (const text of candidates) {
        const found = findProofBundleInText(text);
        if (found) return found;
      }
    }
  } catch (err) {
    console.warn("sigilMetadata: failed to parse SVG proof bundle", err);
  }

  return findProofBundleInText(svgText);
}
