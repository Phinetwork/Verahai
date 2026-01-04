// SigilMarkets/utils/verifySigilLineage.ts
"use client";

import { derivePhiKeyFromSig } from "../../components/VerifierStamper/sigilUtils";
import { canonicalSvgHash, deriveLineageId } from "./lineage";
import type { KaiMoment } from "../types/marketTypes";

type LineagePayloadLike = Readonly<{
  lineageRootSvgHash?: string;
  lineageId?: string;
  marketId?: string;
  positionId?: string;
  side?: string;
  outcome?: string;
  kaiMoment?: KaiMoment;
  userPhiKey?: string;
  kaiSignature?: string;
}>;

type LineageVerification = Readonly<{
  ok: boolean;
  errors: string[];
  derived?: Readonly<{
    lineageId?: string;
    rootSvgHash?: string;
    derivedPhiKey?: string;
  }>;
}>;

const extractJsonFromSvg = (svgText: string): unknown | null => {
  const metaMatch = svgText.match(/<metadata[^>]*>([\s\S]*?)<\/metadata>/i);
  const descMatch = svgText.match(/<desc[^>]*>([\s\S]*?)<\/desc>/i);
  const raw = metaMatch?.[1] ?? descMatch?.[1] ?? "";
  if (!raw) return null;
  const cleaned = raw.replace(/<!\[CDATA\[/g, "").replace(/\]\]>/g, "").trim();
  if (!cleaned) return null;
  try {
    return JSON.parse(cleaned) as unknown;
  } catch {
    return null;
  }
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

const toMoment = (v: unknown): KaiMoment | undefined => {
  if (!isRecord(v)) return undefined;
  const pulse = typeof v.pulse === "number" ? v.pulse : Number(v.pulse);
  const beat = typeof v.beat === "number" ? v.beat : Number(v.beat);
  const stepIndex = typeof v.stepIndex === "number" ? v.stepIndex : Number(v.stepIndex);
  if (!Number.isFinite(pulse) || !Number.isFinite(beat) || !Number.isFinite(stepIndex)) return undefined;
  return { pulse: Math.floor(pulse), beat: Math.floor(beat), stepIndex: Math.floor(stepIndex) };
};

const readPayload = (raw: unknown): LineagePayloadLike => {
  if (!isRecord(raw)) return {};
  return {
    lineageRootSvgHash: typeof raw.lineageRootSvgHash === "string" ? raw.lineageRootSvgHash : undefined,
    lineageId: typeof raw.lineageId === "string" ? raw.lineageId : undefined,
    marketId: typeof raw.marketId === "string" ? raw.marketId : undefined,
    positionId: typeof raw.positionId === "string" ? raw.positionId : undefined,
    side: typeof raw.side === "string" ? raw.side : undefined,
    outcome: typeof raw.outcome === "string" ? raw.outcome : undefined,
    kaiMoment: toMoment(raw.kaiMoment),
    userPhiKey: typeof raw.userPhiKey === "string" ? raw.userPhiKey : undefined,
    kaiSignature: typeof raw.kaiSignature === "string" ? raw.kaiSignature : undefined,
  };
};

export async function verifySigilLineage(childSvgText: string, rootSvgText: string): Promise<LineageVerification> {
  const errors: string[] = [];

  const rawPayload = extractJsonFromSvg(childSvgText);
  const payload = readPayload(rawPayload);

  if (!payload.lineageRootSvgHash) errors.push("Missing lineageRootSvgHash in child payload.");
  if (!payload.lineageId) errors.push("Missing lineageId in child payload.");
  if (!payload.marketId || !payload.positionId) errors.push("Missing marketId/positionId in child payload.");
  if (!payload.kaiMoment) errors.push("Missing kaiMoment in child payload.");
  if (!payload.userPhiKey || !payload.kaiSignature) errors.push("Missing userPhiKey/kaiSignature in child payload.");

  const rootSvgHash = await canonicalSvgHash(rootSvgText);
  if (payload.lineageRootSvgHash && payload.lineageRootSvgHash !== rootSvgHash) {
    errors.push("Root SVG hash does not match lineageRootSvgHash.");
  }

  const sideOrOutcome = payload.outcome ?? payload.side ?? "";
  const lineageId =
    payload.lineageRootSvgHash && payload.marketId && payload.positionId && sideOrOutcome && payload.kaiMoment
      ? await deriveLineageId({
          lineageRootSvgHash: payload.lineageRootSvgHash,
          marketId: payload.marketId,
          positionId: payload.positionId,
          sideOrOutcome,
          kaiMoment: payload.kaiMoment,
        })
      : undefined;

  if (payload.lineageId && lineageId && payload.lineageId !== lineageId) {
    errors.push("Derived lineageId does not match payload.");
  }

  let derivedPhiKey: string | undefined;
  if (payload.kaiSignature) {
    derivedPhiKey = await derivePhiKeyFromSig(payload.kaiSignature);
    if (payload.userPhiKey && derivedPhiKey !== payload.userPhiKey) {
      errors.push("kaiSignature does not derive the embedded userPhiKey.");
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    derived: {
      lineageId,
      rootSvgHash,
      derivedPhiKey,
    },
  };
}
