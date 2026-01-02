// SigilMarkets/ui/motion/WinBurst.tsx
"use client";

import { useEffect } from "react";
import { confettiBurst } from "../../utils/confetti";

export const WinBurst = (props: Readonly<{ fire: boolean }>) => {
  useEffect(() => {
    if (!props.fire) return;
    confettiBurst({ intensity: 1, durationMs: 900 });
  }, [props.fire]);

  return null;
};
