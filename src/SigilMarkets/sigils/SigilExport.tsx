// SigilMarkets/sigils/SigilExport.tsx
"use client";

/* eslint-disable @typescript-eslint/consistent-type-definitions */

/**
 * SigilExport
 *
 * One-click export:
 * - SVG (raw)
 * - PNG (rendered)
 *
 * Works for any SVG string or SVG blob URL.
 * - No external libraries.
 * - Preserves embedded <metadata> and <desc>.
 */

import { useCallback, useMemo, useState } from "react";
import { Button } from "../ui/atoms/Button";
import { Icon } from "../ui/atoms/Icon";
import { useSigilMarketsUi } from "../state/uiStore";
import { canonicalize, type JSONLike } from "../../lib/sigil/canonicalize";
import { blake3Hex } from "../../lib/sigil/hash";
import { computeZkPoseidonHash } from "../../utils/kai";
import { buildProofHints, generateZkProofFromPoseidonHash } from "../../utils/zkProof";
import type { SigilProofHints } from "../../types/sigil";
import { loadJSZip } from "../../pages/SigilPage/utils";
import { momentFromPulse, momentFromUTC } from "../../utils/kai_pulse";

type ExportResult = Readonly<{ ok: true } | { ok: false; error: string }>;

const downloadBlob = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noreferrer";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
};

const fetchText = async (url: string): Promise<string> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
};

const xmlEntityMap: Readonly<Record<string, string>> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
};

const decodeXmlEntities = (value: string): string =>
  value.replace(/&(amp|lt|gt|quot|apos);/g, (match) => xmlEntityMap[match] ?? match);

const encodeXmlEntities = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const stripCdata = (value: string): { text: string; usedCdata: boolean } => {
  const trimmed = value.trim();
  if (trimmed.startsWith("<![CDATA[") && trimmed.endsWith("]]>")) {
    return { text: trimmed.slice(9, -3), usedCdata: true };
  }
  return { text: trimmed, usedCdata: false };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const extractSigilPayload = (svgText: string): Record<string, unknown> | null => {
  const metadataRegex = /<metadata(?:\s[^>]*)?>([\s\S]*?)<\/metadata>/i;
  const match = metadataRegex.exec(svgText);
  if (!match) return null;

  const { text: stripped } = stripCdata(match[1] ?? "");
  const decoded = decodeXmlEntities(stripped);
  try {
    const parsed = JSON.parse(decoded) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

/**
 * Convert unknown -> JSONLike (and fail fast if non-JSONLike).
 * This satisfies canonicalize(JSONLike) without unsafe casts.
 */
const toJSONLike = (
  value: unknown,
  seen: WeakSet<object> = new WeakSet<object>(),
  depth = 0
): JSONLike => {
  if (depth > 64) throw new Error("Non-JSONLike: max depth exceeded");

  if (value === null) return null;

  // Narrow primitives explicitly so TypeScript can see the concrete return
  // types and they match our JSONLike union.
  if (typeof value === "string") return value;
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value;

  // Some projects include Date in JSONLike for canonicalization purposes.
  if (value instanceof Date) return value;

  if (Array.isArray(value)) {
    return value.map((v) => toJSONLike(v, seen, depth + 1));
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (seen.has(obj)) throw new Error("Non-JSONLike: circular reference");
    seen.add(obj);

    const out: Record<string, JSONLike> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v === undefined) continue; // undefined is not JSON; omit for stable hashing
      out[k] = toJSONLike(v, seen, depth + 1);
    }
    return out;
  }

  throw new Error("Non-JSONLike: unsupported value");
};

const getPayloadHashHex = async (payload: Record<string, unknown>): Promise<string> => {
  const integrity = payload.integrity;
  if (isRecord(integrity)) {
    const payloadHash = integrity.payloadHash;
    if (isRecord(payloadHash)) {
      const value = payloadHash.value;
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }

  const payloadForHash: Record<string, JSONLike> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (key === "zkProof" || key === "zkPublicInputs" || key === "zkPoseidonHash") continue;
    if (value === undefined) continue;
    payloadForHash[key] = toJSONLike(value);
  }

  const bytes = canonicalize(payloadForHash);
  return blake3Hex(bytes);
};

const hashBytes = async (bytes: Uint8Array): Promise<string> => blake3Hex(bytes);

const safeJsonLike = (value: unknown): JSONLike | null => {
  try {
    return toJSONLike(value);
  } catch {
    return null;
  }
};

const parsePulseNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.floor(parsed);
  }
  return null;
};

const pulseMomentFromPulse = (pulse: number | null) => {
  if (pulse == null) return null;
  const moment = momentFromPulse(pulse);
  return {
    pulse: moment.pulse,
    beat: moment.beat,
    stepIndex: moment.stepIndex,
  };
};

const collectPulseData = (payload: Record<string, unknown>, exportPulse?: number | null) => {
  const openedAt = isRecord(payload.openedAt) ? payload.openedAt : null;
  const openedPulse = openedAt ? parsePulseNumber(openedAt.pulse) : null;

  const resolution = isRecord(payload.resolution) ? payload.resolution : null;
  const resolvedPulse = resolution ? parsePulseNumber(resolution.resolvedPulse) : null;

  const exportPulseResolved = exportPulse ?? parsePulseNumber(payload.exportedAtPulse);

  return {
    openedAt: pulseMomentFromPulse(openedPulse),
    resolvedAt: pulseMomentFromPulse(resolvedPulse),
    exportedAt: pulseMomentFromPulse(exportPulseResolved),
  };
};

const manifestFromSigil = async (opts: {
  svgText: string;
  pngBlob: Blob;
  filenameBase: string;
  exportPulse?: number | null;
}) => {
  const payload = extractSigilPayload(opts.svgText);
  if (!payload) throw new Error("Sigil metadata missing; cannot build manifest");

  const payloadHash = await getPayloadHashHex(payload);
  const svgBytes = new TextEncoder().encode(opts.svgText);
  const svgHash = await hashBytes(svgBytes);
  const pngHash = await hashBytes(new Uint8Array(await opts.pngBlob.arrayBuffer()));

  const sigilPayload = safeJsonLike(payload);
  const proofHints = isRecord(payload.proofHints) ? payload.proofHints : null;
  const proofHintsJson = proofHints ? safeJsonLike(proofHints) : null;
  const manifestPayload = {
    manifestVersion: "SM-SIGIL-3",
    filenameBase: opts.filenameBase,
    pulseData: collectPulseData(payload, opts.exportPulse),
    payloadHash,
    svgHash,
    pngHash,
    zkPoseidonHash: typeof payload.zkPoseidonHash === "string" ? payload.zkPoseidonHash : null,
    zkPublicInputs: Array.isArray(payload.zkPublicInputs) ? payload.zkPublicInputs : null,
    proofHints: proofHintsJson,
    sigilPayload,
  };

  const manifestForHash: Record<string, JSONLike> = {
    ...manifestPayload,
    sigilPayload: sigilPayload ?? null,
  };
  const manifestHash = await hashBytes(canonicalize(manifestForHash));

  return { manifestHash, ...manifestPayload };
};

const ensureZkProofInSvg = async (svgText: string): Promise<string> => {
  const metadataRegex = /<metadata(?:\s[^>]*)?>([\s\S]*?)<\/metadata>/gi;
  let match: RegExpExecArray | null;

  while ((match = metadataRegex.exec(svgText)) !== null) {
    const raw = match[1] ?? "";
    const { text: stripped, usedCdata } = stripCdata(raw);
    const decoded = decodeXmlEntities(stripped);

    let payload: Record<string, unknown> | null = null;
    try {
      const parsed = JSON.parse(decoded) as unknown;
      if (isRecord(parsed)) payload = parsed;
    } catch {
      payload = null;
    }

    if (!payload) continue;

    const kind = payload.v;
    const isPositionPayload = kind === "SM-POS-1";
    const isResolutionPayload = kind === "SM-RES-1";
    const isEmbeddedSigil =
      "payload" in payload && "integrity" in payload && "header" in payload;
    const isSigilPayload = isPositionPayload || isResolutionPayload || isEmbeddedSigil;
    if (!isSigilPayload) continue;

    const payloadHashHex = await getPayloadHashHex(payload);
    const { hash: poseidonHash, secret } = await computeZkPoseidonHash(payloadHashHex);

    const proofHints = buildProofHints(
      poseidonHash,
      isRecord(payload.proofHints)
        ? (payload.proofHints as Partial<SigilProofHints>)
        : undefined
    );

    const existingPublicInputs = Array.isArray(payload.zkPublicInputs)
      ? payload.zkPublicInputs.map((entry) => String(entry))
      : [];

    const hasValidProof =
      !!payload.zkProof &&
      existingPublicInputs.length > 0 &&
      existingPublicInputs[0] === poseidonHash;

    if (!hasValidProof) {
      const generated = await generateZkProofFromPoseidonHash({
        poseidonHash,
        secret,
        proofHints,
      });
      if (!generated) {
        throw new Error("ZK proof unavailable for export");
      }
      payload.zkProof = generated.proof as unknown;
      payload.zkPublicInputs = generated.zkPublicInputs;
      payload.proofHints = generated.proofHints;
    } else {
      payload.proofHints = proofHints;
    }

    payload.zkPoseidonHash = poseidonHash;

    const updatedJson = JSON.stringify(payload);
    const wrapped = usedCdata ? `<![CDATA[${updatedJson}]]>` : encodeXmlEntities(updatedJson);
    const updatedMetadata = match[0].replace(raw, wrapped);

    return `${svgText.slice(0, match.index)}${updatedMetadata}${svgText.slice(
      match.index + match[0].length
    )}`;
  }

  throw new Error("Sigil metadata missing; cannot generate ZK proof");
};

const ensureSvgXmlns = (svgText: string): string => {
  // Ensure xmlns exists for canvas rendering
  if (svgText.includes('xmlns="http://www.w3.org/2000/svg"')) return svgText;
  return svgText.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
};

const svgToPngBlob = async (svgText: string, sizePx: number): Promise<Blob> => {
  const svg = ensureSvgXmlns(svgText);
  const svgBlob = new Blob([svg], { type: "image/svg+xml" });
  const url = URL.createObjectURL(svgBlob);

  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;

    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Failed to load SVG image"));
    });

    const canvas = document.createElement("canvas");
    canvas.width = sizePx;
    canvas.height = sizePx;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas not supported");

    // Clear transparent background (leave it transparent)
    ctx.clearRect(0, 0, sizePx, sizePx);
    ctx.drawImage(img, 0, 0, sizePx, sizePx);

    const blob: Blob = await new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG export failed"))), "image/png");
    });

    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
};

export type SigilExportOptions = Readonly<{
  /** Suggested base filename without extension */
  filenameBase: string;

  /** SVG content or URL */
  svgText?: string;
  svgUrl?: string;

  /** PNG size px (square). Default: 1024 */
  pngSizePx?: number;

  /** Export which formats. Default: both */
  exportSvg?: boolean;
  exportPng?: boolean;
}>;

export type SigilZipOptions = Readonly<{
  /** Suggested base filename without extension */
  filenameBase: string;

  /** SVG content or URL */
  svgText?: string;
  svgUrl?: string;

  /** PNG size px (square). Default: 1024 */
  pngSizePx?: number;
}>;

export const exportSigil = async (opts: SigilExportOptions): Promise<ExportResult> => {
  try {
    const base = (opts.filenameBase ?? "sigil").trim().replace(/\s+/g, "_");

    const exportSvg = opts.exportSvg ?? true;
    const exportPng = opts.exportPng ?? true;

    if (!exportSvg && !exportPng) return { ok: false, error: "Nothing to export" };

    const svgText = opts.svgText ?? (opts.svgUrl ? await fetchText(opts.svgUrl) : null);
    if (!svgText) return { ok: false, error: "Missing svgText/svgUrl" };

    const svgWithProof = await ensureZkProofInSvg(svgText);

    if (exportSvg) {
      const blob = new Blob([svgWithProof], { type: "image/svg+xml" });
      downloadBlob(blob, `${base}.svg`);
    }

    if (exportPng) {
      const size = Math.max(256, Math.min(4096, Math.floor(opts.pngSizePx ?? 1024)));
      const png = await svgToPngBlob(svgWithProof, size);
      downloadBlob(png, `${base}.png`);
    }

    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "export failed";
    return { ok: false, error: msg };
  }
};

export const exportSigilZip = async (opts: SigilZipOptions): Promise<ExportResult> => {
  try {
    const base = (opts.filenameBase ?? "sigil").trim().replace(/\s+/g, "_");
    const svgText = opts.svgText ?? (opts.svgUrl ? await fetchText(opts.svgUrl) : null);
    if (!svgText) return { ok: false, error: "Missing svgText/svgUrl" };

    const svgWithProof = await ensureZkProofInSvg(svgText);
    const size = Math.max(256, Math.min(4096, Math.floor(opts.pngSizePx ?? 1024)));
    const png = await svgToPngBlob(svgWithProof, size);
    const exportMoment = momentFromUTC(new Date());
    const manifest = await manifestFromSigil({
      svgText: svgWithProof,
      pngBlob: png,
      filenameBase: base,
      exportPulse: exportMoment.pulse,
    });

    const JSZip = await loadJSZip();
    const zip = new JSZip();
    zip.file(`${base}.svg`, svgWithProof);
    zip.file(`${base}.png`, png);
    zip.file(`${base}.manifest.json`, JSON.stringify(manifest, null, 2));

    const zipBlob = await zip.generateAsync({ type: "blob" });
    downloadBlob(zipBlob, `${base}.zip`);

    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "export failed";
    return { ok: false, error: msg };
  }
};

/** UI component: one-click export button */
export type SigilExportButtonProps = Readonly<{
  filenameBase: string;
  svgText?: string;
  svgUrl?: string;
  pngSizePx?: number;
  mode?: "pair" | "zip";
  className?: string;
  label?: string;
}>;

export const SigilExportButton = (props: SigilExportButtonProps) => {
  const { actions: ui } = useSigilMarketsUi();
  const [busy, setBusy] = useState(false);

  const can = useMemo(() => !!props.svgText || !!props.svgUrl, [props.svgText, props.svgUrl]);
  const mode = props.mode ?? "pair";

  const run = useCallback(async () => {
    if (!can) return;
    setBusy(true);
    const res =
      mode === "zip"
        ? await exportSigilZip({
            filenameBase: props.filenameBase,
            svgText: props.svgText,
            svgUrl: props.svgUrl,
            pngSizePx: props.pngSizePx ?? 1400,
          })
        : await exportSigil({
            filenameBase: props.filenameBase,
            svgText: props.svgText,
            svgUrl: props.svgUrl,
            pngSizePx: props.pngSizePx ?? 1024,
            exportSvg: true,
            exportPng: true,
          });
    if (!res.ok) ui.toast("error", "Export failed", res.error);
    else {
      const detail =
        mode === "zip" ? "ZIP includes SVG + PNG + manifest.json" : "SVG + PNG downloaded";
      ui.toast("success", "Exported", detail);
    }
    setBusy(false);
  }, [can, mode, props.filenameBase, props.pngSizePx, props.svgText, props.svgUrl, ui]);

  return (
    <Button
      variant="primary"
      onClick={run}
      disabled={!can || busy}
      loading={busy}
      leftIcon={<Icon name="export" size={14} tone="dim" />}
      className={props.className}
    >
      {props.label ?? (mode === "zip" ? "Export ZIP" : "Export SVG + PNG")}
    </Button>
  );
};
