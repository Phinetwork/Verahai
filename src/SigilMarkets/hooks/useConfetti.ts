// SigilMarkets/hooks/useConfetti.ts
"use client";

import { useCallback } from "react";
import { useSigilMarketsUi } from "../state/uiStore";
import { confettiBurst } from "../utils/confetti";

/**
 * useConfetti
 * - Arms confetti from uiStore.motion.confettiArmed
 * - Fire once, then disarm.
 */
export const useConfetti = (): Readonly<{ fire: () => void; armed: boolean }> => {
  const { state, actions } = useSigilMarketsUi();

  const armed = state.motion.confettiArmed;

  const fire = useCallback(() => {
    if (!armed) return;
    confettiBurst({ intensity: 1, durationMs: 900 });
    actions.armConfetti(false);
  }, [actions, armed]);

  return { fire, armed };
};
