// SigilMarkets/hooks/useProphecySigilVerification.ts
"use client";

import { useEffect, useMemo, useState } from "react";
import type { KaiMoment } from "../types/marketTypes";
import { computeZkPoseidonHash } from "../../utils/kai";
import { derivePhiKeyFromSig } from "../../components/VerifierStamper/sigilUtils";
import { tryVerifyGroth16 } from "../../components/VerifierStamper/zk";
import {
  buildProphecyPayloadBase,
  computeProphecyCanonicalHash,
  decodeProphecyText,
  parseProphecySigilSvg,
} from "../utils/prophecySigil";
import type { ProphecySigilPayloadV1 } from "../types/prophecySigilTypes";

const loadVkey = async (): Promise<unknown | null> => {
  try {
    const res = await fetch("/zk/verification_key.json", { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
};

export type ProphecySigilVerification = Readonly<{
  signatureOk: boolean | null;
  zkOk: boolean | null;
  zkScheme?: string;
  canonicalHash?: string;
  canonicalHashOk: boolean | null;
  text: string;
  windowStatus: "open" | "closed" | "unknown";
}>;

export const useProphecySigilVerification = (svg: string | undefined, now: KaiMoment): ProphecySigilVerification => {
  const [state, setState] = useState<ProphecySigilVerification>({
    signatureOk: null,
    zkOk: null,
    canonicalHashOk: null,
    text: "",
    windowStatus: "unknown",
  });

  const svgText = useMemo(() => svg, [svg]);

  useEffect(() => {
    let cancelled = false;

    const run = async (): Promise<void> => {
      if (!svgText) {
        if (!cancelled) {
          setState({
            signatureOk: null,
            zkOk: null,
            canonicalHashOk: null,
            text: "",
            windowStatus: "unknown",
          });
        }
        return;
      }

      const parsed = parseProphecySigilSvg(svgText);
      const payload = parsed.payload;
      const text = typeof payload.text === "string" ? payload.text : parsed.textDecoded ?? "";

      const windowStatus =
        typeof payload.expirationPulse === "number"
          ? now.pulse >= payload.expirationPulse
            ? "closed"
            : "open"
          : "unknown";

      const signatureOk =
        typeof payload.kaiSignature === "string" && typeof payload.userPhiKey === "string"
          ? (await derivePhiKeyFromSig(payload.kaiSignature)) === payload.userPhiKey
          : null;

      let canonicalHashOk: boolean | null = null;
      let canonicalHash: string | undefined = typeof payload.canonicalHash === "string" ? payload.canonicalHash : undefined;

      const hasCoreFields =
        typeof payload.prophecyId === "string" &&
        typeof payload.text === "string" &&
        typeof payload.textEnc === "string" &&
        typeof payload.userPhiKey === "string" &&
        typeof payload.kaiSignature === "string" &&
        typeof payload.pulse === "number" &&
        typeof payload.beat === "number" &&
        typeof payload.stepIndex === "number" &&
        typeof payload.stepPct === "number" &&
        typeof payload.chakraDay === "string";

      if (hasCoreFields) {
        const base = buildProphecyPayloadBase({
          prophecyId: payload.prophecyId,
          text: payload.text,
          textEnc: payload.textEnc === "uri" ? "uri" : "uri",
          category: payload.category,
          expirationPulse: payload.expirationPulse,
          escrowPhiMicro: payload.escrowPhiMicro,
          evidence: payload.evidence,
          userPhiKey: payload.userPhiKey,
          kaiSignature: payload.kaiSignature,
          moment: {
            pulse: payload.pulse,
            beat: payload.beat,
            stepIndex: payload.stepIndex,
            stepPctAcrossBeat: payload.stepPct,
            chakraDay: payload.chakraDay,
            weekday: "Solhara",
          },
        });

        const computed = await computeProphecyCanonicalHash(base);
        canonicalHashOk = canonicalHash ? canonicalHash.toLowerCase() === computed : false;
        canonicalHash = canonicalHash ?? computed;
      }

      let zkOk: boolean | null = null;
      let zkScheme: string | undefined;

      const zk = parsed.zk ?? (payload.zk as ProphecySigilPayloadV1["zk"] | undefined);
      if (zk && zk.proof && zk.publicInputs && canonicalHash) {
        zkScheme = zk.scheme;
        const poseidon = await computeZkPoseidonHash(canonicalHash);
        const publicInput0 = Array.isArray(zk.publicInputs) ? zk.publicInputs[0] : undefined;
        const binds =
          (zk.poseidonHash ? zk.poseidonHash === poseidon.hash : true) &&
          (publicInput0 ? publicInput0 === poseidon.hash : true);

        if (binds) {
          const vkey = await loadVkey();
          const verified = await tryVerifyGroth16({
            proof: zk.proof,
            publicSignals: zk.publicInputs,
            vkey,
            fallbackVkey: vkey,
          });
          zkOk = verified === null ? null : verified === true;
        } else {
          zkOk = false;
        }
      }

      if (!cancelled) {
        setState({
          signatureOk,
          zkOk,
          zkScheme,
          canonicalHash,
          canonicalHashOk,
          text: text || decodeProphecyText(parsed.textDecoded ?? "", payload.textEnc),
          windowStatus,
        });
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [now.pulse, svgText]);

  return state;
};
