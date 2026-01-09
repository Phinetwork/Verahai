// src/utils/payload.ts
import { decodeSigilPayload } from "./sigilUrl";
import { STEPS_BEAT as STEPS_PER_BEAT } from "./kai_pulse";
import { percentIntoStepFromPulse } from "../SovereignSolar";
import type {
  ExpiryUnit,
  SigilPayload,
  EmbeddedAttachment,
  ProvenanceEntry,
} from "../types/sigil";

/** Raw (possibly untrusted) payload decoded from URL */
type RawPayload = {
  stepsPerBeat?: number | string;
  stepIndex?: number | string;
  stepPct?: number;
  pulse?: number | string;
  beat?: number | string;
  chakraDay?: SigilPayload["chakraDay"];
  kaiSignature?: string;
  userPhiKey?: string;
  provenance?: unknown[];
  attachment?: unknown; // validated below
  expiresAtPulse?: number | string;
  canonicalHash?: string;
  transferNonce?: string;
  exportedAtPulse?: number | string;

  claimExtendUnit?: string;
  claimExtendAmount?: number | string;

  // zk/owner block (optional in URL; required in SigilPayload)
  zkPoseidonHash?: string;
  zkProof?: unknown;
  ownerPubKey?: unknown; // may be a JSON string or object
  ownerSig?: string;

  // Possible extras your SigilPayload may require
  eternalRecord?: unknown;
  creatorResolved?: unknown;
  origin?: unknown;
  proofHints?: unknown;
};

/* ────────────────────────────────────────────────────────────────
   Runtime guards & helpers
────────────────────────────────────────────────────────────────── */

function isEmbeddedAttachment(x: unknown): x is EmbeddedAttachment {
  if (!x || typeof x !== "object") return false;
  const obj = x as Record<string, unknown>;
  return (
    typeof obj.name === "string" &&
    typeof obj.mime === "string" &&
    typeof obj.dataUri === "string" &&
    typeof obj.size === "number"
  );
}

function isProvenanceEntry(x: unknown): x is ProvenanceEntry {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  const action = o.action as string | undefined;
  const okAction = action === "mint" || action === "transfer" || action === "claim";
  return (
    typeof o.ownerPhiKey === "string" &&
    typeof o.pulse === "number" &&
    typeof o.beat === "number" &&
    typeof o.atPulse === "number" &&
    okAction
  );
}

/** Extremely loose zkProof guard; adapt to your proof schema if needed */
function isZkProof(x: unknown): x is SigilPayload["zkProof"] {
  return !!x && typeof x === "object";
}

/** Accept JWK as object or JSON string; fall back to minimal valid JsonWebKey */
function parseOwnerPubKeyJwk(raw: unknown): JsonWebKey {
  if (!raw) return {};
  if (typeof raw === "object") return raw as JsonWebKey;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed as JsonWebKey;
    } catch {
      /* ignore */
    }
  }
  return {};
}

/* ────────────────────────────────────────────────────────────────
   Main decode
────────────────────────────────────────────────────────────────── */

export function decodePayloadFromQuery(search: string): SigilPayload | null {
  try {
    const qs = new URLSearchParams(search);
    const p = qs.get("p");
    if (!p) return null;

    const raw = decodeSigilPayload(p) as RawPayload | null;
    if (!raw || typeof raw !== "object") return null;

    // steps/stepIndex/stepPct
    const stepsRaw = raw.stepsPerBeat;
    const steps =
      stepsRaw != null && !Number.isNaN(Number(stepsRaw))
        ? Math.max(1, Math.floor(Number(stepsRaw)))
        : STEPS_PER_BEAT;

    const pulseNum =
      raw.pulse != null && !Number.isNaN(Number(raw.pulse)) ? Number(raw.pulse) : 0;

    const rawStepIndex = raw.stepIndex;
    const stepIndex =
      rawStepIndex != null && !Number.isNaN(Number(rawStepIndex))
        ? Math.max(0, Math.min(steps - 1, Math.floor(Number(rawStepIndex))))
        : undefined;

    const derivedPct =
      typeof raw.stepPct === "number"
        ? Math.max(0, Math.min(1, raw.stepPct))
        : Number.isFinite(pulseNum)
        ? percentIntoStepFromPulse(pulseNum)
        : 0;

    // expiry/exported
    const exp = raw.expiresAtPulse != null ? Number(raw.expiresAtPulse) : NaN;
    const expd = raw.exportedAtPulse != null ? Number(raw.exportedAtPulse) : NaN;

    // claim extend
    const rxUnit = (raw.claimExtendUnit || "").toString().toLowerCase();
    const claimExtendUnit: ExpiryUnit | undefined =
      rxUnit === "steps" ? "steps" : rxUnit === "breaths" ? "breaths" : undefined;

    const claimExtendAmount =
      raw.claimExtendAmount != null && !Number.isNaN(Number(raw.claimExtendAmount))
        ? Math.max(0, Math.floor(Number(raw.claimExtendAmount)))
        : undefined;

    // complex optionals
    const provenance: ProvenanceEntry[] | undefined = Array.isArray(raw.provenance)
      ? raw.provenance.filter(isProvenanceEntry)
      : undefined;

    const attachment: EmbeddedAttachment | undefined = isEmbeddedAttachment(raw.attachment)
      ? (raw.attachment as EmbeddedAttachment)
      : undefined;

    // zk/owner block with safe defaults (match SigilPayload types)
    const zkPoseidonHash = typeof raw.zkPoseidonHash === "string" ? raw.zkPoseidonHash : "0x";
    const zkProof = isZkProof(raw.zkProof)
      ? (raw.zkProof as SigilPayload["zkProof"])
      : ({} as SigilPayload["zkProof"]);
    const ownerPubKey = parseOwnerPubKeyJwk(raw.ownerPubKey);
    const ownerSig = typeof raw.ownerSig === "string" ? raw.ownerSig : "";

    // pass-through/backs-fill possible extras your SigilPayload may require
    const eternalRecord = (raw as { eternalRecord?: unknown }).eternalRecord ?? null;
    const creatorResolved =
      typeof (raw as { creatorResolved?: unknown }).creatorResolved === "boolean"
        ? (raw as { creatorResolved?: boolean }).creatorResolved
        : false;
    const origin =
      typeof (raw as { origin?: unknown }).origin === "string"
        ? (raw as { origin?: string }).origin
        : "";
    const proofHints = Array.isArray((raw as { proofHints?: unknown }).proofHints)
      ? ((raw as { proofHints?: unknown[] }).proofHints ?? [])
      : [];

    // Build with known fields, then include extras when present.
    // Cast at the end so we don't fight local repo-required fields.
    const payload = {
      pulse: pulseNum,
      beat: Number(raw.beat) || 0,
      chakraDay: raw.chakraDay as SigilPayload["chakraDay"],
      stepIndex,
      stepPct: derivedPct,
      kaiSignature:
        typeof raw.kaiSignature === "string" ? raw.kaiSignature : undefined,
      userPhiKey:
        typeof raw.userPhiKey === "string" ? raw.userPhiKey : undefined,
      stepsPerBeat: steps,
      provenance,
      attachment,
      expiresAtPulse: Number.isFinite(exp) ? exp : undefined,
      canonicalHash:
        typeof raw.canonicalHash === "string" ? raw.canonicalHash : undefined,
      transferNonce:
        typeof raw.transferNonce === "string" ? raw.transferNonce : undefined,
      exportedAtPulse: Number.isFinite(expd) ? expd : undefined,

      claimExtendUnit,
      claimExtendAmount,

      // required zk/owner fields
      zkPoseidonHash,
      zkProof,
      ownerPubKey,
      ownerSig,

      // extras (only if your SigilPayload declares them)
      eternalRecord,
      creatorResolved,
      origin,
      proofHints,
    } as unknown as SigilPayload;

    const extras = raw as {
      sigilKind?: unknown;
      sigilId?: unknown;
      prophecyPayload?: unknown;
      svgUrl?: unknown;
    };
    if (typeof extras.sigilKind === "string") {
      (payload as SigilPayload & { sigilKind?: string }).sigilKind = extras.sigilKind;
    }
    if (typeof extras.sigilId === "string") {
      (payload as SigilPayload & { sigilId?: string }).sigilId = extras.sigilId;
    }
    if (extras.prophecyPayload && typeof extras.prophecyPayload === "object") {
      const rawProphecy = extras.prophecyPayload as Record<string, unknown>;
      const trimmedProphecy: Record<string, unknown> = {};
      const isFiniteNumber = (value: unknown): value is number =>
        typeof value === "number" && Number.isFinite(value);
      if (typeof rawProphecy.v === "string") trimmedProphecy.v = rawProphecy.v;
      if (typeof rawProphecy.kind === "string") trimmedProphecy.kind = rawProphecy.kind;
      if (typeof rawProphecy.text === "string") trimmedProphecy.text = rawProphecy.text;
      if (typeof rawProphecy.textEnc === "string") trimmedProphecy.textEnc = rawProphecy.textEnc;
      if (typeof rawProphecy.category === "string") trimmedProphecy.category = rawProphecy.category;
      if (typeof rawProphecy.escrowPhiMicro === "string") {
        trimmedProphecy.escrowPhiMicro = rawProphecy.escrowPhiMicro;
      }
      if (isFiniteNumber(rawProphecy.expirationPulse)) {
        trimmedProphecy.expirationPulse = rawProphecy.expirationPulse;
      }
      if (typeof rawProphecy.prophecyId === "string") {
        trimmedProphecy.prophecyId = rawProphecy.prophecyId;
      }
      if (typeof rawProphecy.userPhiKey === "string") trimmedProphecy.userPhiKey = rawProphecy.userPhiKey;
      if (typeof rawProphecy.kaiSignature === "string") trimmedProphecy.kaiSignature = rawProphecy.kaiSignature;
      if (typeof rawProphecy.canonicalHash === "string") trimmedProphecy.canonicalHash = rawProphecy.canonicalHash;
      if (isFiniteNumber(rawProphecy.pulse)) trimmedProphecy.pulse = rawProphecy.pulse;
      if (isFiniteNumber(rawProphecy.beat)) trimmedProphecy.beat = rawProphecy.beat;
      if (isFiniteNumber(rawProphecy.stepIndex)) trimmedProphecy.stepIndex = rawProphecy.stepIndex;
      if (isFiniteNumber(rawProphecy.stepPct)) trimmedProphecy.stepPct = rawProphecy.stepPct;
      if (typeof rawProphecy.chakraDay === "string") trimmedProphecy.chakraDay = rawProphecy.chakraDay;
      if (isFiniteNumber(rawProphecy.createdAtPulse)) trimmedProphecy.createdAtPulse = rawProphecy.createdAtPulse;
      if (rawProphecy.evidence && typeof rawProphecy.evidence === "object") {
        trimmedProphecy.evidence = rawProphecy.evidence;
      }
      if (rawProphecy.zk && typeof rawProphecy.zk === "object") {
        trimmedProphecy.zk = rawProphecy.zk;
      }
      (payload as SigilPayload & { prophecyPayload?: unknown }).prophecyPayload =
        trimmedProphecy;
    }
    if (typeof extras.svgUrl === "string") {
      (payload as SigilPayload & { svgUrl?: string }).svgUrl = extras.svgUrl;
    }

    // If URL has token "?t=" but payload omitted it, lift it.
    const urlToken = qs.get("t");
    if (urlToken && !(payload as unknown as { transferNonce?: string }).transferNonce) {
      (payload as unknown as { transferNonce?: string }).transferNonce = urlToken;
    }

    return payload;
  } catch {
    return null;
  }
}
