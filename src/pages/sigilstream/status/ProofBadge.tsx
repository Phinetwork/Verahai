// src/pages/sigilstream/status/ProofBadge.tsx

"use client";

import * as React from "react";
import "./ProofBadge.css";

const TM = "\u2122";

export type ProofBadgeMode = "memory" | "breath";

type Props = {
  mode: ProofBadgeMode;
  /** Used only for deterministic phase animation (no Chronos). */
  pulse?: number;
  /** Optional: override the visible label */
  label?: string;
  /** Smaller footprint for tight layouts */
  compact?: boolean;
  className?: string;
  title?: string;
};

function phase13(pulse: number): number {
  const p = Number.isFinite(pulse) ? Math.floor(pulse) : 0;
  return ((p % 13) + 13) % 13;
}

export function ProofBadge({
  mode,
  pulse,
  label,
  compact = false,
  className,
  title,
}: Props): React.JSX.Element {
  const p = typeof pulse === "number" ? pulse : 0;
  const ph = phase13(p);

  const accent: readonly [number, number, number] =
    mode === "memory" ? ([88, 255, 174] as const) : ([164, 126, 255] as const);

  const text =
    label ??
    (mode === "memory" ? `PROOF OF MEMORY${TM}` : `PROOF OF BREATH${TM}`);

  const tooltip =
    title ??
    (mode === "memory"
      ? "Proof of Memory: self-contained witness (offline-recoverable)"
      : "Proof of Breath: sigil-only (no embedded memory chain)");

  const style: React.CSSProperties = {
    ["--pb-accent-r" as never]: String(accent[0]),
    ["--pb-accent-g" as never]: String(accent[1]),
    ["--pb-accent-b" as never]: String(accent[2]),
    ["--pb-phase" as never]: String(ph),
  };

  const cls =
    `pb pb--${mode}` +
    (compact ? " pb--compact" : "") +
    (className ? ` ${className}` : "");

  return (
    <span className={cls} style={style} title={tooltip} aria-label={text}>
      <span className="pb__seal" aria-hidden="true">
        <span className="pb__glyph">{mode === "memory" ? "☤" : "⟁"}</span>
      </span>

      <span className="pb__label" aria-hidden="true">
        <span className="pb__text">
          {mode === "memory" ? "PROOF OF MEMORY" : "PROOF OF BREATH"}
        </span>
        <span className="pb__tm">{TM}</span>
      </span>

      <span className="pb__spark" aria-hidden="true" />
    </span>
  );
}

export default ProofBadge;
