// SigilMarkets/hooks/useGlyphBalance.ts
"use client";

import { useEffect, useMemo, useState } from "react";
import type { KaiMoment, PhiMicro } from "../types/marketTypes";
import type { VaultRecord } from "../types/vaultTypes";
import { formatPhiMicro } from "../utils/format";
import { usd as formatUsd } from "../../components/valuation/display";
import { roundScaledToDecimals } from "../../components/verifier/utils/decimal";
import { getSpentScaledFor, listen as listenLedger } from "../../utils/sendLedger";
import { DEFAULT_ISSUANCE_POLICY, quotePhiForUsd } from "../../utils/phi-issuance";
import type { SigilMetadataLite } from "../../utils/valuation";

const SCALED_PER_MICRO = 1_000_000_000_000n;
const FALLBACK_META = { ip: { expectedCashflowPhi: [] } } as unknown as SigilMetadataLite;

type GlyphBalance = Readonly<{
  availableMicro: PhiMicro | null;
  availableLabel: string;
  availableUsd: number | null;
  availableUsdLabel: string;
  usdPerPhi: number;
  canonicalHash: string | null;
}>;

const clampNonNegative = (v: bigint): bigint => (v < 0n ? 0n : v);

const minBigInt = (a: bigint, b: bigint): bigint => (a < b ? a : b);

export const useGlyphBalance = (vault: VaultRecord | null, now: KaiMoment): GlyphBalance => {
  const [ledgerTick, setLedgerTick] = useState(0);

  useEffect(() => {
    return listenLedger(() => setLedgerTick((t) => t + 1));
  }, []);

  const canonicalHash = useMemo(() => {
    const raw = vault?.owner.identitySigil?.canonicalHash;
    return raw ? raw.toLowerCase() : null;
  }, [vault?.owner.identitySigil?.canonicalHash]);

  const availableMicro = useMemo<PhiMicro | null>(() => {
    if (!vault?.owner.identitySigil) return null;

    const valueMicro = vault.owner.identitySigil.valuePhiMicro;
    const storedAvailable = vault.owner.identitySigil.availablePhiMicro;

    let baseScaled =
      valueMicro !== undefined
        ? (valueMicro as unknown as bigint) * SCALED_PER_MICRO
        : storedAvailable !== undefined
          ? (storedAvailable as unknown as bigint) * SCALED_PER_MICRO
          : 0n;

    if (canonicalHash) {
      const spentScaled = getSpentScaledFor(canonicalHash);
      baseScaled = clampNonNegative(baseScaled - spentScaled);
    }

    if (valueMicro !== undefined && storedAvailable !== undefined) {
      const storedScaled = (storedAvailable as unknown as bigint) * SCALED_PER_MICRO;
      baseScaled = minBigInt(baseScaled, storedScaled);
    }

    const rounded = roundScaledToDecimals(baseScaled, 6);
    return (rounded / SCALED_PER_MICRO) as PhiMicro;
  }, [canonicalHash, ledgerTick, vault?.owner.identitySigil]);

  const usdPerPhi = useMemo(() => {
    try {
      const q = quotePhiForUsd(
        {
          meta: FALLBACK_META,
          nowPulse: Math.floor(now.pulse),
          usd: 100,
          currentStreakDays: 0,
          lifetimeUsdSoFar: 0,
          plannedHoldBeats: 0,
        },
        DEFAULT_ISSUANCE_POLICY,
      );
      return q.usdPerPhi ?? 0;
    } catch {
      return 0;
    }
  }, [now.pulse]);

  const availableLabel = useMemo(() => {
    if (availableMicro === null) return "—";
    return formatPhiMicro(availableMicro, { withUnit: true, maxDecimals: 6, trimZeros: true });
  }, [availableMicro]);

  const availableUsd = useMemo(() => {
    if (availableMicro === null || !Number.isFinite(usdPerPhi) || usdPerPhi <= 0) return null;
    const phi = Number(availableMicro) / 1_000_000;
    return phi * usdPerPhi;
  }, [availableMicro, usdPerPhi]);

  const availableUsdLabel = useMemo(() => {
    if (availableUsd === null || !Number.isFinite(availableUsd)) return "—";
    return formatUsd(availableUsd);
  }, [availableUsd]);

  return {
    availableMicro,
    availableLabel,
    availableUsd,
    availableUsdLabel,
    usdPerPhi,
    canonicalHash,
  };
};
