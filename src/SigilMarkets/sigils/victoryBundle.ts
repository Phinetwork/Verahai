// SigilMarkets/sigils/victoryBundle.ts
"use client";

import JSZip from "jszip";

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
    .slice(0, 120) || "claim";

export async function buildVictoryBundleZip(input: VictoryBundleInput): Promise<VictoryBundleResult> {
  void input.filenameBase;
  const zip = new JSZip();
  zip.file("claim-sigil.svg", input.svgText);
  zip.file("receipt.json", JSON.stringify(input.receipt, null, 2));
  zip.file("proof.json", JSON.stringify(input.proof, null, 2));
  zip.file("README.txt", input.readme);

  const fileNames = ["claim-sigil.svg", "receipt.json", "proof.json", "README.txt"] as const;

  if (input.output === "uint8array") {
    const data = await zip.generateAsync({ type: "uint8array" });
    return { fileNames, data };
  }

  const blob = await zip.generateAsync({ type: "blob" });
  return { fileNames, blob };
}
