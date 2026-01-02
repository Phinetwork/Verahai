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

import React, { useCallback, useMemo, useState } from "react";
import { Button } from "../ui/atoms/Button";
import { Icon } from "../ui/atoms/Icon";
import { useSigilMarketsUi } from "../state/uiStore";

type ExportResult = Readonly<{ ok: true } | { ok: false; error: string }>;

const isString = (v: unknown): v is string => typeof v === "string";

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
    // Important for SVG rendering in some browsers:
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

    if (exportSvg) {
      const blob = new Blob([svgText], { type: "image/svg+xml" });
      downloadBlob(blob, `${base}.svg`);
    }

    if (exportPng) {
      const size = Math.max(256, Math.min(4096, Math.floor(opts.pngSizePx ?? 1024)));
      const png = await svgToPngBlob(svgText, size);
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
