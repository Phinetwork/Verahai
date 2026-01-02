export * from "../verifier/types/local";

import type { SigilMetadata, SigilMetadataWithOptionals } from "../verifier/types/local";
import type { SigilMetadataLite } from "../../utils/valuation";

export interface SigilMeta {
  pulse: number;
  beat: number;
  stepIndex: number;
  chakraDay: string;
  kaiSignature: string;
  userPhiKey: string;
  [key: string]: unknown; // optional: allow future fields
}

export type SigilMetadataLiteExtended = SigilMetadataLite & {
  canonicalContext?: "parent" | "derivative";
  childOfHash?: SigilMetadataWithOptionals["childOfHash"];
  sendLock?: SigilMetadataWithOptionals["sendLock"];
  childClaim?: SigilMetadataWithOptionals["childClaim"];
  childAllocationPhi?: SigilMetadataWithOptionals["childAllocationPhi"];
  branchBasePhi?: SigilMetadataWithOptionals["branchBasePhi"];
  valuationSource?: SigilMetadata["valuationSource"];
  stats?: SigilMetadata["stats"];
  transfersWindowRoot?: SigilMetadata["transfersWindowRoot"];
  fileName?: string;
};

export type SigilZkProof = {
  proof: string;
  publicSignals: string[];
  vkey?: unknown;
};

export type SigilZkSendInput = {
  meta: SigilMetadata;
  leafHash: string;
  previousHeadRoot: string;
  nonce: string;
};

export type SigilZkReceiveInput = {
  meta: SigilMetadataWithOptionals;
  leafHash: string;
  previousHeadRoot: string;
  linkSig: string;
};

export type SigilZkBridge = {
  provideSendProof?: (input: SigilZkSendInput) => Promise<SigilZkProof | null>;
  provideReceiveProof?: (input: SigilZkReceiveInput) => Promise<SigilZkProof | null>;
};

export type PhiMoveMode = "send" | "receive";

export type PhiMoveSuccessDetail = {
  mode: PhiMoveMode;
  /** e.g. "Φ 1.2345" for display */
  amountPhiDisplay?: string;
  /** optional generic formatted amount string */
  amountDisplay?: string;
  /** raw numeric Φ amount (optional) */
  amountPhi?: number;
  /** optional download URL for a receipt/sigil */
  downloadUrl?: string;
  downloadLabel?: string;
  /** optional human-readable message */
  message?: string;
};
