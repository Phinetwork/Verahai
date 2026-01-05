// SigilMarkets/types/prophecySigilTypes.ts
/* eslint-disable @typescript-eslint/consistent-type-definitions */

import type {
  Brand,
  KaiPulse,
  MicroDecimalString,
  PhiMicro,
} from "./marketTypes";
import type { EvidenceBundle } from "./oracleTypes";
import type { KaiSignature, SvgHash, UserPhiKey } from "./vaultTypes";

export type ProphecyId = Brand<string, "ProphecyId">;
export const asProphecyId = (v: string): ProphecyId => v as ProphecyId;

export type ProphecySigilZkBundle = Readonly<{
  scheme: string;
  proof?: unknown;
  publicInputs?: readonly string[];
  poseidonHash?: string;
  verifiedHint?: boolean;
}>;

export type ProphecySigilPayloadV1 = Readonly<{
  v: "SM-PROPHECY-1";
  kind: "prophecy";

  prophecyId: ProphecyId;
  text: string;
  textEnc: "uri";
  category?: string;
  expirationPulse?: KaiPulse;
  escrowPhiMicro?: MicroDecimalString;
  evidence?: EvidenceBundle;

  userPhiKey: UserPhiKey;
  kaiSignature: KaiSignature;

  canonicalHash: string;

  pulse: KaiPulse;
  beat: number;
  stepIndex: number;
  stepPct: number;
  chakraDay: string;

  createdAtPulse: KaiPulse;

  zk?: ProphecySigilZkBundle;
}>;

export type ProphecySigilArtifact = Readonly<{
  sigilId: ProphecyId;
  svgHash: SvgHash;
  svg: string;
  url?: string;
  canonicalHash: string;
  payload: ProphecySigilPayloadV1;
  zk?: ProphecySigilZkBundle;
}>;

export type ProphecyRecord = Readonly<{
  id: ProphecyId;
  kind: "prophecy";

  text: string;
  category?: string;
  expirationPulse?: KaiPulse;
  escrowPhiMicro?: PhiMicro;
  evidence?: EvidenceBundle;

  sigil?: ProphecySigilArtifact;

  createdAtPulse: KaiPulse;
  updatedPulse: KaiPulse;
}>;
