// src/components/SigilGlyphButton.tsx
/* ────────────────────────────────────────────────────────────────
   SigilGlyphButton.tsx · Atlantean Lumitech “Kairos Sigil Glyph”
   v7.2 — EXACT match with SigilModal (μpulse math + deterministic hash)
          + persistent glyph after modal close (unique origin + remount key)
───────────────────────────────────────────────────────────────── */

import React, { useState, useEffect, useRef, useCallback } from "react";
import KaiSigil, { type KaiSigilProps, type KaiSigilHandle } from "./KaiSigil";
import SigilModal from "./SigilModal";
import "./SigilGlyphButton.css";

import {
  GENESIS_TS,
  PULSE_MS,
  latticeFromMicroPulses,
  microPulsesSinceGenesis,
  momentFromUTC,
} from "../utils/kai_pulse";

/* compute the exact render state the modal uses */
function computeLocalKai(now: Date): {
  pulse: number;
  beat: number;
  chakraDay: KaiSigilProps["chakraDay"];
} {
  const pμ = microPulsesSinceGenesis(now);
  const { beat } = latticeFromMicroPulses(pμ);
  const { pulse, chakraDay } = momentFromUTC(now);

  return { pulse, beat, chakraDay };
}

/* aligned φ-boundary scheduler (same idea as the modal) */
const epochNow = () => performance.timeOrigin + performance.now();
const nextBoundary = (nowMs: number) => {
  const elapsed = nowMs - GENESIS_TS;
  const periods = Math.ceil(elapsed / PULSE_MS);
  return GENESIS_TS + periods * PULSE_MS;
};

/* ═════════════ Component ═════════════ */
interface Props { kaiPulse?: number } // optional seed; ignored once live

const SigilGlyphButton: React.FC<Props> = () => {
  const [pulse, setPulse] = useState<number>(0);
  const [beat, setBeat] = useState<number>(0);
  const [chakraDay, setChakraDay] = useState<KaiSigilProps["chakraDay"]>("Root");
  const [open, setOpen] = useState(false);

  // 🔑 unique, stable scope for this instance’s internal SVG ids (prevents collisions with modal)
  const [idScope] = useState(() => `btn-${Math.random().toString(36).slice(2)}`);

  // Force a tiny remount of the <KaiSigil> whenever modal opens/closes (refresh any stale <use> hrefs)
  const instanceKey = open ? "sigil-open" : "sigil-closed";

  const sigilRef = useRef<KaiSigilHandle | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const targetRef = useRef<number>(0);

  const applyNow = useCallback(() => {
    const { pulse: p, beat: b, chakraDay: cd } = computeLocalKai(new Date());
    setPulse(p);
    setBeat(b);
    setChakraDay(cd);
  }, []);

  const clearTimer = () => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  };

  const scheduleAligned = useCallback(() => {
    clearTimer();
    const now = epochNow();
    targetRef.current = nextBoundary(now);

    const fire = () => {
      // Catch up if tab slept
      const nowMs = epochNow();
      const missed = Math.floor((nowMs - targetRef.current) / PULSE_MS);
      const runs = Math.max(0, missed) + 1;
      for (let i = 0; i < runs; i++) {
        applyNow();
        targetRef.current += PULSE_MS;
      }
      const delay = Math.max(0, targetRef.current - epochNow());
      timeoutRef.current = window.setTimeout(fire, delay) as unknown as number;
    };

    const initialDelay = Math.max(0, targetRef.current - now);
    timeoutRef.current = window.setTimeout(fire, initialDelay) as unknown as number;
  }, [applyNow]);

  /* mount: compute immediately and align to boundary */
  useEffect(() => {
    applyNow();
    scheduleAligned();
    return () => clearTimer();
  }, [applyNow, scheduleAligned]);

  /* visibility: re-align when returning to foreground */
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") scheduleAligned();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [scheduleAligned]);


  return (
    <>
      <button
        className="sigil-button"
        title="View & save this sigil"
        onClick={() => setOpen(true)}
        data-chakra={chakraDay}
        aria-label="Open Kairos Sigil"
        type="button"
      >
        {/* Decorative thumbnail only — link-proof via shield */}
        <span
          className="sigil-thumb"
          aria-hidden="true"
          inert="true"
        >
          <KaiSigil
            key={instanceKey}
            ref={sigilRef}
            pulse={pulse}
            beat={beat}
            chakraDay={chakraDay}
            size={40}
            hashMode="deterministic"
            origin={idScope}
            onReady={(payload?: { hash?: string; pulse?: number }) => {
              if (payload && typeof payload.pulse === "number" && payload.pulse !== pulse) {
                setPulse(payload.pulse);
              }
            }}
          />
          {/* ⛨ Transparent shield that intercepts all clicks/taps */}
          <span className="sigil-shield" aria-hidden="true" />
        </span>
      </button>

      {open && (
        <SigilModal
          initialPulse={pulse}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
};

export default SigilGlyphButton;
