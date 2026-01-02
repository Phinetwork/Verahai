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

  const t = typeof value;
  if (t === "string" || t === "number" || t === "boolean") return value;

  // Some projects include Date in JSONLike for canonicalization purposes.
  if (value instanceof Date) return value;

  if (Array.isArray(value)) {
    return value.map((v) => toJSONLike(v, seen, depth + 1));
  }

  if (t === "object") {
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

/** UI component: one-click export button */
export type SigilExportButtonProps = Readonly<{
  filenameBase: string;
  svgText?: string;
  svgUrl?: string;
  pngSizePx?: number;
  className?: string;
}>;

export const SigilExportButton = (props: SigilExportButtonProps) => {
  const { actions: ui } = useSigilMarketsUi();
  const [busy, setBusy] = useState(false);

  const can = useMemo(() => !!props.svgText || !!props.svgUrl, [props.svgText, props.svgUrl]);

  const run = useCallback(async () => {
    if (!can) return;
    setBusy(true);
    const res = await exportSigil({
      filenameBase: props.filenameBase,
      svgText: props.svgText,
      svgUrl: props.svgUrl,
      pngSizePx: props.pngSizePx ?? 1024,
      exportSvg: true,
      exportPng: true,
    });
    if (!res.ok) ui.toast("error", "Export failed", res.error);
    else ui.toast("success", "Exported", "SVG + PNG downloaded");
    setBusy(false);
  }, [can, props.filenameBase, props.pngSizePx, props.svgText, props.svgUrl, ui]);

  return (
    <Button
      variant="primary"
      onClick={run}
      disabled={!can || busy}
      loading={busy}
      leftIcon={<Icon name="export" size={14} tone="dim" />}
      className={props.className}
    >
      Export SVG + PNG
    </Button>
  );
};
