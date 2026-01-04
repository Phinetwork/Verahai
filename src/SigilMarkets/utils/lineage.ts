// SigilMarkets/utils/lineage.ts
"use client";

import type { KaiMoment } from "../types/marketTypes";
import type { IdentitySigilRef, SvgHash } from "../types/vaultTypes";
import { sha256Hex } from "./ids";
import { sanitizeSvgString } from "../../utils/svgMeta";

export type LineageRoot = Readonly<{
  lineageRootSigilId: string;
  lineageRootSvgHash: SvgHash;
}>;

const normalizeStr = (v: string): string => v.trim();

export const resolveLineageRoot = (identity: IdentitySigilRef): LineageRoot => {
  const rootSigilId =
    (identity.sigilId as unknown as string | undefined) ??
    (identity.canonicalHash as unknown as string | undefined) ??
    (identity.svgHash as unknown as string | undefined) ??
    "";
  if (!rootSigilId) {
    throw new Error("Missing identity sigil id.");
  }
  return {
    lineageRootSigilId: normalizeStr(rootSigilId),
    lineageRootSvgHash: identity.svgHash,
  };
};

export const deriveLineageId = async (args: Readonly<{
  lineageRootSvgHash: string;
  marketId: string;
  positionId: string;
  sideOrOutcome: string;
  kaiMoment: KaiMoment;
}>): Promise<string> => {
  const { lineageRootSvgHash, marketId, positionId, sideOrOutcome, kaiMoment } = args;
  const msg = [
    "SM-LINEAGE-1",
    lineageRootSvgHash,
    marketId,
    positionId,
    sideOrOutcome,
    String(kaiMoment.pulse),
    String(kaiMoment.beat),
    String(kaiMoment.stepIndex),
  ].join("|");
  return sha256Hex(msg);
};

export const deriveChildSeed = async (lineageId: string): Promise<string> =>
  sha256Hex(`SM-ART-1|${lineageId}`);

export const canonicalizeSvgText = (svgText: string): string => {
  const cleaned = sanitizeSvgString(svgText);
  return cleaned.replace(/\r\n/g, "\n").trim();
};

export const canonicalSvgHash = async (svgText: string): Promise<string> =>
  sha256Hex(canonicalizeSvgText(svgText));
