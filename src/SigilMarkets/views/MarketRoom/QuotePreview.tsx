// SigilMarkets/views/MarketRoom/QuotePreview.tsx
"use client";

import { useMemo } from "react";
import type { MarketQuote } from "../../types/marketTypes";
import { Card, CardContent } from "../../ui/atoms/Card";
import { Divider } from "../../ui/atoms/Divider";
import { Icon } from "../../ui/atoms/Icon";
import { formatPhiMicro, formatPriceMicro, formatSharesMicro } from "../../utils/format";

export type QuotePreviewProps = Readonly<{
  quote: MarketQuote | null;
  /** If provided, show a warning if quote is stale by pulses. */
  nowPulse?: number;
}>;

export const QuotePreview = (props: QuotePreviewProps) => {
  const q = props.quote;

  // ✅ Hooks must be called unconditionally — compute memoized display values
  // with safe null-guards and render conditionally afterward.

  const stake = useMemo(
    () => (q ? formatPhiMicro(q.stakeMicro, { withUnit: true, maxDecimals: 6, trimZeros: true }) : ""),
    [q?.stakeMicro],
  );

  const fee = useMemo(
    () => (q ? formatPhiMicro(q.feeMicro, { withUnit: true, maxDecimals: 6, trimZeros: true }) : ""),
    [q?.feeMicro],
  );

  const total = useMemo(
    () => (q ? formatPhiMicro(q.totalCostMicro, { withUnit: true, maxDecimals: 6, trimZeros: true }) : ""),
    [q?.totalCostMicro],
  );

  const shares = useMemo(() => (q ? formatSharesMicro(q.expectedSharesMicro, { maxDecimals: 2 }) : ""), [
    q?.expectedSharesMicro,
  ]);

  const avg = useMemo(() => (q ? formatPriceMicro(q.avgPriceMicro, { mode: "cents", decimals: 0 }) : ""), [
    q?.avgPriceMicro,
  ]);

  const worst = useMemo(() => (q ? formatPriceMicro(q.worstPriceMicro, { mode: "cents", decimals: 0 }) : ""), [
    q?.worstPriceMicro,
  ]);

  const stale = useMemo(() => {
    if (!q) return false;
    if (props.nowPulse === undefined) return false;
    const d = props.nowPulse - q.quotedAtPulse;
    return d > 2;
  }, [props.nowPulse, q?.quotedAtPulse]);

  if (!q) {
    return (
      <Card variant="glass2">
        <CardContent>
          <div className="sm-subtitle">Adjust stake to preview.</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card variant="glass2" className={stale ? "sm-loss-fade" : ""}>
      <CardContent>
        <div className="sm-quote-head">
          <div className="sm-quote-title">
            <Icon name="check" size={14} tone="dim" /> Quote
          </div>
          <div className="sm-quote-side">
            <span className={`sm-quote-side-pill ${q.side === "YES" ? "is-yes" : "is-no"}`}>{q.side}</span>
          </div>
        </div>

        {stale ? <div className="sm-small">Quote may be stale — pulse moved.</div> : null}

        <Divider />

        <div className="sm-quote-grid">
          <div className="sm-quote-row">
            <span className="sm-quote-k">Stake</span>
            <span className="sm-quote-v">{stake}</span>
          </div>
          <div className="sm-quote-row">
            <span className="sm-quote-k">Fee</span>
            <span className="sm-quote-v">{fee}</span>
          </div>
          <div className="sm-quote-row">
            <span className="sm-quote-k">Total</span>
            <span className="sm-quote-v">{total}</span>
          </div>

          <Divider />

          <div className="sm-quote-row">
            <span className="sm-quote-k">Shares</span>
            <span className="sm-quote-v">{shares}</span>
          </div>
          <div className="sm-quote-row">
            <span className="sm-quote-k">Avg price</span>
            <span className="sm-quote-v">{avg}</span>
          </div>
          <div className="sm-quote-row">
            <span className="sm-quote-k">Worst</span>
            <span className="sm-quote-v">{worst}</span>
          </div>
        </div>

        <div className="sm-small" style={{ marginTop: 10 }}>
          Winning shares redeem at 1Φ each.
        </div>
      </CardContent>
    </Card>
  );
};
