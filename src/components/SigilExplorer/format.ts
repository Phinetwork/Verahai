// src/components/SigilExplorer/format.ts
/* ─────────────────────────────────────────────────────────────────────
   Formatting helpers (parity with SigilExplorer.tsx)
────────────────────────────────────────────────────────────────────── */

import type { SigilSharePayloadLoose } from "./types";

/** Human shortener for long strings. */
export function short(s?: string, n = 10): string {
  if (!s) return "—";
  if (s.length <= n * 2 + 3) return s;
  return `${s.slice(0, n)}…${s.slice(-n)}`;
}

/** Safe compare by pulse/beat/step; ascending (earlier first). */
export function byKaiTime(a: SigilSharePayloadLoose, b: SigilSharePayloadLoose): number {
  if ((a.pulse ?? 0) !== (b.pulse ?? 0)) return (a.pulse ?? 0) - (b.pulse ?? 0);
  if ((a.beat ?? 0) !== (b.beat ?? 0)) return (a.beat ?? 0) - (b.beat ?? 0);
  return (a.stepIndex ?? 0) - (b.stepIndex ?? 0);
}

/** Φ formatter — 6dp, trimmed. */
export function formatPhi(value: number): string {
  const fixed = value.toFixed(6);
  return fixed.replace(/0+$/u, "").replace(/\.$/u, "");
}

const USD_FORMATTER = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return "0.00";
  return USD_FORMATTER.format(value);
}

/** Extract Φ sent from a payload (tolerant to field names). */
export function getPhiFromPayload(payload: SigilSharePayloadLoose): number | undefined {
  const record = payload as unknown as Record<string, unknown>;
  const candidates = [
    "phiSent",
    "sentPhi",
    "phi_amount",
    "amountPhi",
    "phi",
    "phiValue",
    "phi_amount_sent",
    "childAllocationPhi",
    "branchBasePhi",
  ];

  for (const key of candidates) {
    const v = record[key];
    if (typeof v === "number") {
      if (!Number.isFinite(v)) continue;
      if (Math.abs(v) < 1e-12) continue;
      return v;
    }
    if (typeof v === "string") {
      const n = Number(v);
      if (!Number.isNaN(n) && Math.abs(n) >= 1e-12) return n;
    }
  }
  return undefined;
}
