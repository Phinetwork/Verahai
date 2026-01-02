// SigilMarkets/views/MarketGrid/MarketHeat.tsx
"use client";

import { useMemo } from "react";

export const MarketHeat = (props: Readonly<{ heat: number }>) => {
  const cls = useMemo(() => {
    const h = props.heat;
    if (h > 0.82) return "sm-heat is-hot";
    if (h > 0.58) return "sm-heat is-warm";
    if (h > 0.30) return "sm-heat is-live";
    return "sm-heat is-dim";
  }, [props.heat]);

  return <span className={cls} aria-hidden="true" />;
};
