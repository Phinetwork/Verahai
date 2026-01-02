import React, { useMemo } from "react";
import { useKaiTicker } from "../hooks/useKaiTicker";
import { momentFromUTC } from "../utils/kai_pulse";
import { DEFAULT_ISSUANCE_POLICY, quotePhiForUsd } from "../utils/phi-issuance";
import type { SigilMetadataLite } from "../utils/valuation";
import "./HomePriceChartCard.compact.css";

type Props = {
  ctaAmountUsd?: number;
  title?: string;
  onActivate?: () => void;
};

const FALLBACK_META = { ip: { expectedCashflowPhi: [] } } as unknown as SigilMetadataLite;
const PULSES_PER_DAY = 17_491;

function PhiIconInline(): React.JSX.Element {
  return <img className="hp-phi-icon" src="/phi.svg" alt="Φ" />;
}

export default function HomePriceTickerFallback({
  ctaAmountUsd = 250,
  title = "Value Index",
  onActivate,
}: Props): React.JSX.Element {
  const { pulse: livePulse } = useKaiTicker();
  const pulse = useMemo(() => {
    if (typeof livePulse === "number" && Number.isFinite(livePulse)) return livePulse;
    return momentFromUTC(new Date()).pulse;
  }, [livePulse]);

  const priceNow = useMemo(() => {
    const usdSample = Math.max(1, Math.round(Number.isFinite(ctaAmountUsd) ? ctaAmountUsd : 1));
    const q = quotePhiForUsd(
      {
        meta: FALLBACK_META,
        nowPulse: Math.floor(pulse),
        usd: usdSample,
        currentStreakDays: 0,
        lifetimeUsdSoFar: 0,
        plannedHoldBeats: 0,
      },
      DEFAULT_ISSUANCE_POLICY,
    );
    return q.phiPerUsd > 0 ? 1 / q.phiPerUsd : 0;
  }, [ctaAmountUsd, pulse]);

  const pct24h = useMemo(() => {
    const usdSample = Math.max(1, Math.round(Number.isFinite(ctaAmountUsd) ? ctaAmountUsd : 1));
    const prev = quotePhiForUsd(
      {
        meta: FALLBACK_META,
        nowPulse: Math.floor(pulse) - PULSES_PER_DAY,
        usd: usdSample,
        currentStreakDays: 0,
        lifetimeUsdSoFar: 0,
        plannedHoldBeats: 0,
      },
      DEFAULT_ISSUANCE_POLICY,
    );
    const prevPrice = prev.phiPerUsd > 0 ? 1 / prev.phiPerUsd : 0;
    if (!(prevPrice > 0)) return 0;
    return ((priceNow - prevPrice) / prevPrice) * 100;
  }, [ctaAmountUsd, pulse, priceNow]);

  const hasPrice = Number.isFinite(priceNow) && priceNow > 0;
  const priceAria = hasPrice ? `$${priceNow.toFixed(2)} / Φ` : "—";

  const pctLabel = (() => {
    if (!Number.isFinite(pct24h)) return "0.00%";
    const abs = Math.abs(pct24h);
    return `${pct24h >= 0 ? "+" : "−"}${abs.toFixed(2)}%`;
  })();

  const pctClass = pct24h >= 0 ? "hp-up" : "hp-down";

  return (
    <div className="hp-card" role="group" aria-label="Sovereign asset">
      <div
        className="hp-ticker"
        role="button"
        tabIndex={0}
        onClick={onActivate}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onActivate?.();
          }
        }}
      >
        <div className="hp-left">
          <span className="hp-title" aria-label={title}>
            <span className="hp-titleText">{title}</span>
          </span>
        </div>

        <div className="hp-right">
          <span className="hp-price" aria-live="polite" aria-label={priceAria}>
            {hasPrice ? (
              <span className="hp-price-row" aria-label={priceAria}>
                <span className="hp-price-usd">{`$${priceNow.toFixed(2)}`}</span>
                <span className="hp-price-slash" aria-hidden>
                  {" "}
                  /{" "}
                </span>
                <PhiIconInline />
              </span>
            ) : (
              "—"
            )}
          </span>
          <span className={`hp-pct ${pctClass}`} aria-live="polite">
            {pct24h >= 0 ? "▲" : "▼"} {pctLabel}
          </span>
        </div>
      </div>
    </div>
  );
}
