// SigilMarkets/hooks/useProphecySigils.ts
"use client";

import { useCallback, useMemo } from "react";
import type { EvidenceBundle } from "../types/oracleTypes";
import type { KaiPulse, PhiMicro } from "../types/marketTypes";
import type { ProphecyRecord, ProphecySigilArtifact } from "../types/prophecySigilTypes";
import { useActiveVault } from "../state/vaultStore";
import { useSigilMarketsUi } from "../state/uiStore";
import { useSigilMarketsProphecySigilStore } from "../state/prophecySigilStore";
import { momentFromUTC, STEPS_BEAT } from "../../utils/kai_pulse";
import { canonicalizeEvidenceBundleV2 } from "../api/oracleApi";
import { computeZkPoseidonHash } from "../../utils/kai";
import { buildProofHints, generateZkProofFromPoseidonHash } from "../../utils/zkProof";
import {
  buildProphecyPayloadBase,
  computeProphecyCanonicalHash,
  deriveProphecyId,
  encodeProphecyText,
  toMicroDecimal,
} from "../utils/prophecySigil";
import { registerSigilUrl } from "../../utils/sigilRegistry";
import { makeSigilUrlLoose, type SigilSharePayloadLoose } from "../../utils/sigilUrl";
import { asSvgHash } from "../types/vaultTypes";

export type SealProphecyRequest = Readonly<{
  text: string;
  category?: string;
  expirationPulse?: KaiPulse;
  escrowPhiMicro?: PhiMicro;
  evidence?: EvidenceBundle;
}>;

export type SealProphecyResult =
  | Readonly<{ ok: true; record: ProphecyRecord; sigil: ProphecySigilArtifact }>
  | Readonly<{ ok: false; error: string }>;

export type UseProphecySigilsResult = Readonly<{
  prophecies: readonly ProphecyRecord[];
  activeVault: ReturnType<typeof useActiveVault>;
  actions: Readonly<{
    sealProphecy: (req: SealProphecyRequest) => Promise<SealProphecyResult>;
    remove: (id: ProphecyRecord["id"]) => void;
    requireAuth: () => void;
  }>;
}>;

export const useProphecySigils = (): UseProphecySigilsResult => {
  const { state, actions } = useSigilMarketsProphecySigilStore();
  const activeVault = useActiveVault();
  const { actions: ui } = useSigilMarketsUi();

  const prophecies = useMemo(
    () => state.ids.map((id) => state.byId[id as unknown as string]).filter((p): p is ProphecyRecord => Boolean(p)),
    [state.byId, state.ids],
  );

  const requireAuth = useCallback(() => {
    ui.pushSheet({ id: "inhale-glyph", reason: "auth" });
  }, [ui]);

  const sealProphecy = useCallback(
    async (req: SealProphecyRequest): Promise<SealProphecyResult> => {
      if (!activeVault) {
        requireAuth();
        return { ok: false, error: "not authenticated" };
      }

      const text = req.text.trim();
      if (!text) return { ok: false, error: "prophecy text required" };

      const moment = momentFromUTC();
      const { encoded, enc } = encodeProphecyText(text);

      const evidence = await canonicalizeEvidenceBundleV2(req.evidence);

      const prophecyId = await deriveProphecyId({
        userPhiKey: activeVault.owner.userPhiKey,
        pulse: moment.pulse,
        text,
      });

      const escrowPhiMicro = toMicroDecimal(req.escrowPhiMicro);

      const payloadBase = buildProphecyPayloadBase({
        prophecyId,
        text,
        textEnc: enc,
        category: req.category,
        expirationPulse: req.expirationPulse,
        escrowPhiMicro,
        evidence,
        userPhiKey: activeVault.owner.userPhiKey,
        kaiSignature: activeVault.owner.kaiSignature,
        moment,
      });

      const canonicalHash = await computeProphecyCanonicalHash(payloadBase);
      const { hash: poseidonHash, secret } = await computeZkPoseidonHash(canonicalHash);

      const proofHints = buildProofHints(poseidonHash, { scheme: "groth16-poseidon" });
      const generated = await generateZkProofFromPoseidonHash({
        poseidonHash,
        secret,
        proofHints,
      });

      if (!generated) {
        return { ok: false, error: "ZK proof unavailable" };
      }

      const payload = {
        ...payloadBase,
        canonicalHash,
        zk: {
          scheme: "groth16-poseidon",
          proof: generated.proof,
          publicInputs: generated.zkPublicInputs,
          poseidonHash,
        },
      };

      let sigilId = prophecyId as unknown as string;
      const res = await fetch("/sigils/seal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "prophecy", payload, textEncoded: encoded }),
      });

      if (!res.ok) {
        return { ok: false, error: "seal failed" };
      }

      const body = (await res.json()) as {
        sigilId?: string;
        svg?: string;
        svgHash?: string;
      };

      if (!body || typeof body.svg !== "string" || typeof body.svgHash !== "string") {
        return { ok: false, error: "seal payload missing" };
      }

      sigilId = typeof body.sigilId === "string" ? body.sigilId : sigilId;
      const svgHash = asSvgHash(body.svgHash);
      const svgUrl = `/sigils/${sigilId}.svg`;
      const sharePayload: SigilSharePayloadLoose = {
        pulse: payload.pulse,
        beat: payload.beat,
        stepIndex: payload.stepIndex,
        stepPct: payload.stepPct,
        chakraDay: payload.chakraDay as SigilSharePayloadLoose["chakraDay"],
        stepsPerBeat: STEPS_BEAT,
        kaiSignature: payload.kaiSignature,
        userPhiKey: payload.userPhiKey,
        canonicalHash: payload.canonicalHash,
        sigilKind: "prophecy",
        sigilId: payload.prophecyId,
        prophecyPayload: payload,
        svgUrl,
      };
      const sigilUrl = makeSigilUrlLoose(payload.canonicalHash, sharePayload);

      const sigil: ProphecySigilArtifact = {
        sigilId: prophecyId,
        svgHash,
        svg: body.svg,
        url: sigilUrl,
        canonicalHash,
        payload,
        zk: payload.zk,
      };

      const record = actions.addProphecy({
        text,
        category: req.category,
        expirationPulse: req.expirationPulse,
        escrowPhiMicro: req.escrowPhiMicro,
        evidence,
        sigil,
        createdAtPulse: moment.pulse,
      });

      registerSigilUrl(sigilUrl);
      ui.toast("success", "Prophecy sealed", undefined, { atPulse: moment.pulse });

      return { ok: true, record, sigil };
    },
    [actions, activeVault, requireAuth, ui],
  );

  const remove = useCallback(
    (id: ProphecyRecord["id"]) => {
      actions.removeProphecy(id);
      ui.toast("info", "Removed", "Prophecy removed");
    },
    [actions, ui],
  );

  return {
    prophecies,
    activeVault,
    actions: {
      sealProphecy,
      remove,
      requireAuth,
    },
  };
};