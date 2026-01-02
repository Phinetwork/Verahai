// src/components/VerifierStamper/svg.ts
import { SIGIL_CTX, SIGIL_TYPE } from "./constants";
import type { SigilMetadata } from "./types";
import { sha256Hex } from "./crypto";
import {
  extractEmbeddedMetaFromSvg,
  extractProofBundleMetaFromSvg,
} from "../../utils/sigilMetadata";

/* SVG attribute helpers */
export function getAttr(svg: string, key: string): string | undefined {
  const m = svg.match(new RegExp(`${key}="([^"]+)"`, "i"));
  return m ? m[1] : undefined;
}
export function getIntAttr(svg: string, key: string): number | undefined {
  const v = getAttr(svg, key);
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export function extractMetadataJSON(svg: string): string | null {
  try {
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    const meta = doc.querySelector("metadata");
    return meta ? meta.textContent ?? null : null;
  } catch {
    return null;
  }
}

/* Parse an uploaded SVG file and extract SigilMetadata */
export async function parseSvgFile(file: File) {
  const text = await file.text();

  // 1) <metadata> JSON
  let meta: SigilMetadata = {};
  const raw = extractMetadataJSON(text);
  if (raw) {
    try {
      meta = JSON.parse(raw) as SigilMetadata;
    } catch {
      // ignore, continue with attrs
    }
  }

  const embedded = extractEmbeddedMetaFromSvg(text);
  const proofBundle = extractProofBundleMetaFromSvg(text);

  // 2) attribute fallbacks / mirrors
  meta.pulse ??= getIntAttr(text, "data-pulse");
  meta.beat ??= getIntAttr(text, "data-beat");
  meta.stepIndex ??= getIntAttr(text, "data-step-index");
  meta.frequencyHz ??= (() => {
    const v = getAttr(text, "data-frequency-hz");
    return v ? Number(v) : undefined;
  })();
  meta.chakraGate ??= getAttr(text, "data-chakra-gate");

  if (!meta.chakraDay) {
    const dayAttr =
      getAttr(text, "data-harmonic-day") || getAttr(text, "data-chakra-day");
    if (dayAttr) meta.chakraDay = dayAttr;
  }

  meta.kaiSignature ??= getAttr(text, "data-kai-signature");
  meta.userPhiKey ??= getAttr(text, "data-phi-key");
  meta.shareUrl ??= getAttr(text, "data-share-url");
  meta.zkPoseidonHash ??= getAttr(text, "data-zk-poseidon-hash");
  meta.zkPublicInputs ??= getAttr(text, "data-zk-public-inputs");
  meta.payloadHashHex ??= getAttr(text, "data-payload-hash");

  const proofMetaText = (() => {
    try {
      const doc = new DOMParser().parseFromString(text, "image/svg+xml");
      const node =
        doc.querySelector('metadata#kai-voh-proof[type="application/json"]') ??
        doc.querySelector("metadata#kai-voh-proof");
      return node?.textContent ?? null;
    } catch {
      return null;
    }
  })();
  if (proofMetaText) {
    const normalized = proofMetaText
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&");
    try {
      const parsed = JSON.parse(normalized) as { authorSig?: string; authSig?: string };
      if (parsed.authorSig !== undefined) {
        meta.authorSig = parsed.authorSig;
      } else if (parsed.authSig !== undefined) {
        meta.authorSig = parsed.authSig;
      }
    } catch {
      // ignore invalid proof bundle
    }
  }

  meta.kaiSignature ??= embedded.kaiSignature;
  meta.userPhiKey ??= embedded.phiKey;
  meta.pulse ??= embedded.pulse;
  meta.beat ??= embedded.beat;
  meta.stepIndex ??= embedded.stepIndex;
  meta.chakraDay ??= embedded.chakraDay;
  meta.chakraGate ??= embedded.chakraGate;
  meta.frequencyHz ??= embedded.frequencyHz;
  if (embedded.shareUrl && !meta.shareUrl) meta.shareUrl = embedded.shareUrl;
  meta.zkPoseidonHash ??= embedded.zkPoseidonHash;
  if (embedded.zkProof && meta.zkProof === undefined) meta.zkProof = embedded.zkProof;
  if (embedded.proofHints && meta.proofHints === undefined) meta.proofHints = embedded.proofHints;
  if (embedded.zkPublicInputs && meta.zkPublicInputs === undefined) meta.zkPublicInputs = embedded.zkPublicInputs;

  if (embedded.verifierUrl && !meta.verifierUrl) meta.verifierUrl = embedded.verifierUrl;
  if (embedded.proofCapsule && !meta.proofCapsule) meta.proofCapsule = embedded.proofCapsule;
  if (embedded.capsuleHash && !meta.capsuleHash) meta.capsuleHash = embedded.capsuleHash;
  if (embedded.svgHash && !meta.svgHash) meta.svgHash = embedded.svgHash;
  if (embedded.bundleHash && !meta.bundleHash) meta.bundleHash = embedded.bundleHash;
  if (embedded.hashAlg && !meta.hashAlg) meta.hashAlg = embedded.hashAlg;
  if (embedded.canon && !meta.canon) meta.canon = embedded.canon;
  if (embedded.authorSig !== undefined && meta.authorSig === undefined) meta.authorSig = embedded.authorSig;

  if (proofBundle) {
    if (proofBundle.shareUrl && !meta.shareUrl) meta.shareUrl = proofBundle.shareUrl;
    meta.verifierUrl ??= proofBundle.verifierUrl;
    meta.proofCapsule ??= proofBundle.proofCapsule;
    meta.capsuleHash ??= proofBundle.capsuleHash;
    meta.svgHash ??= proofBundle.svgHash;
    meta.bundleHash ??= proofBundle.bundleHash;
    meta.hashAlg ??= proofBundle.hashAlg;
    meta.canon ??= proofBundle.canon;
    meta.zkPoseidonHash ??= proofBundle.zkPoseidonHash;
    if (proofBundle.zkProof && meta.zkProof === undefined) meta.zkProof = proofBundle.zkProof;
    if (proofBundle.proofHints && meta.proofHints === undefined) meta.proofHints = proofBundle.proofHints;
    if (proofBundle.zkPublicInputs && meta.zkPublicInputs === undefined) meta.zkPublicInputs = proofBundle.zkPublicInputs;
    if (proofBundle.authorSig !== undefined && meta.authorSig === undefined) {
      meta.authorSig = proofBundle.authorSig;
    }
    meta.proofBundle = proofBundle;
  }

  meta.embeddedMeta = embedded;

  const contextOk = !meta["@context"] || meta["@context"] === SIGIL_CTX;
  const typeOk = !meta.type || meta.type === SIGIL_TYPE;

  return { text, meta, contextOk, typeOk };
}

/* centre-pixel live signature (legacy cosmetic) */
export async function centrePixelSignature(url: string, pulseForSeal: number) {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = url;
  await img.decode();

  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext("2d");
  if (!g) throw new Error("Canvas 2D context unavailable");
  g.drawImage(img, 0, 0);
  const { data } = g.getImageData(
    Math.floor(img.width / 2),
    Math.floor(img.height / 2),
    1,
    1
  );
  const rgb: [number, number, number] = [data[0], data[1], data[2]];
  const sig = (await sha256Hex(`${pulseForSeal}-2:3-${rgb.join(",")}`)).slice(
    0,
    32
  );
  return { sig, rgb };
}

/* embed updated <metadata> JSON into SVG and return data: URL */
const MAIN_METADATA_REGEX = /<metadata\b(?![^>]*\bid=["']kai-voh-proof["'])[^>]*>[\s\S]*?<\/metadata>/i;

export function embedMetadataText(svgText: string, meta: SigilMetadata): string {
  const json = JSON.stringify(meta, null, 2);
  if (MAIN_METADATA_REGEX.test(svgText)) {
    return svgText.replace(MAIN_METADATA_REGEX, `<metadata>${json}</metadata>`);
  }
  return svgText.replace(/<svg([^>]*)>/i, `<svg$1><metadata>${json}</metadata>`);
}

export async function embedMetadata(svgURL: string, meta: SigilMetadata) {
  const raw = await fetch(svgURL).then((r) => r.text());
  const updated = embedMetadataText(raw, meta);
  return `data:image/svg+xml;base64,${btoa(
    unescape(encodeURIComponent(updated))
  )}`;
}

/** minimal PNG rendering for the ZIP export */
export async function pngBlobFromSvgDataUrl(
  svgDataUrl: string,
  px = 1024
): Promise<Blob> {
  const img = new Image();
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = rej;
    img.src = svgDataUrl;
  });
  const canvas = document.createElement("canvas");
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unsupported");
  // cover / center
  ctx.clearRect(0, 0, px, px);
  ctx.drawImage(img, 0, 0, px, px);
  const blob: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("PNG encode failed"))),
      "image/png"
    )
  );
  return blob;
}
