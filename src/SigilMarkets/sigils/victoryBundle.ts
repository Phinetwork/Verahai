// SigilMarkets/sigils/victoryBundle.ts
"use client";

import JSZip from "jszip";
import { EXPORT_PX, pngBlobFromSvg } from "../../utils/qrExport";

export type VictoryBundleInput = Readonly<{
  svgText: string;
  receipt: Record<string, unknown>;
  proof: Record<string, unknown>;
  readme: string;
  filenameBase: string;
  output: "blob" | "uint8array";
}>;

export type VictoryBundleResult = Readonly<{
  fileNames: readonly string[];
  blob?: Blob;
  data?: Uint8Array;
}>;

export const sanitizeBundleName = (raw: string): string =>
  raw
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "victory";

export async function buildVictoryBundleZip(input: VictoryBundleInput): Promise<VictoryBundleResult> {
  void input.filenameBase;
  const zip = new JSZip();
  const svgBlob = new Blob([input.svgText], { type: "image/svg+xml;charset=utf-8" });
  const pngBlob = await pngBlobFromSvg(svgBlob, EXPORT_PX);
  zip.file("victory-sigil.svg", input.svgText);
  zip.file("victory-sigil.png", pngBlob);
  zip.file("receipt.json", JSON.stringify(input.receipt, null, 2));
  zip.file("proof.json", JSON.stringify(input.proof, null, 2));
  zip.file("README.txt", input.readme);

  const fileNames = ["victory-sigil.svg", "victory-sigil.png", "receipt.json", "proof.json", "README.txt"] as const;

  if (input.output === "uint8array") {
    const data = await zip.generateAsync({ type: "uint8array" });
    return { fileNames, data };
  }

  const blob = await zip.generateAsync({ type: "blob" });
  return { fileNames, blob };
}
