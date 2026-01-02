// SigilMarkets/views/MarketGrid/MarketCell.tsx
"use client";

import { useMemo } from "react";
import type { Market, MarketCategory, MarketId, PriceMicro } from "../../types/marketTypes";
import { useSigilMarketsUi } from "../../state/uiStore";
import { useHaptics } from "../../hooks/useHaptics";
import { useSfx } from "../../hooks/useSfx";

import { Card, CardContent } from "../../ui/atoms/Card";
import { Icon } from "../../ui/atoms/Icon";
import { ProgressRing } from "../../ui/atoms/ProgressRing";
import { Chip } from "../../ui/atoms/Chip";

import { formatCloseIn, formatPriceMicro } from "../../utils/format";

export type MarketCellProps = Readonly<{
  market: Market;
  marketId: MarketId;

  yesPriceMicro: PriceMicro;
  noPriceMicro: PriceMicro;

  closeInPulses: number;
  isClosingSoon: boolean;

  /** 0..1 heat score for UI emphasis */
  heat: number;
}>;

const heatTone = (heat: number): "dim" | "cyan" | "violet" | "gold" => {
  if (heat > 0.82) return "gold";
  if (heat > 0.58) return "violet";
  if (heat > 0.30) return "cyan";
  return "dim";
};

const toneForCategory = (c: MarketCategory): "default" | "cyan" | "violet" | "gold" => {
  if (c === "weather") return "cyan";
  if (c === "crypto") return "violet";
  if (c === "finance") return "gold";
  return "default";
};

const ringProgress = (closeInPulses: number): number => {
  // 0 far, 1 at close. Ramp within 3000 pulses.
  if (closeInPulses <= 0) return 1;
  const t = 1 - Math.min(1, closeInPulses / 3000);
  return t < 0 ? 0 : t > 1 ? 1 : t;
};

export const MarketCell = (props: MarketCellProps) => {
  const { actions } = useSigilMarketsUi();
  const haptics = useHaptics();
  const sfx = useSfx();

  const yesCents = useMemo(
    () => formatPriceMicro(props.yesPriceMicro, { mode: "cents", decimals: 0 }),
    [props.yesPriceMicro],
  );
  const noCents = useMemo(
    () => formatPriceMicro(props.noPriceMicro, { mode: "cents", decimals: 0 }),
    [props.noPriceMicro],
  );

  const closeLabel = useMemo(() => formatCloseIn(props.closeInPulses), [props.closeInPulses]);

  const ring = useMemo(() => ringProgress(props.closeInPulses), [props.closeInPulses]);
  const ringTone = useMemo(() => heatTone(props.heat), [props.heat]);

  const q = props.market.def.question;
  const cat = props.market.def.category;

  const cls = useMemo(
    () => `sm-grid-cell ${props.isClosingSoon ? "is-soon sm-breathe" : ""}`,
    [props.isClosingSoon],
  );

  const open = (): void => {
    haptics.fire("tap");
    sfx.play("tap");
    actions.navigate({ view: "market", marketId: props.marketId });
  };

  return (
    <button type="button" className={cls} onClick={open} aria-label={q}>
      <Card variant="glass" className="sm-grid-card" breathe={props.isClosingSoon}>
        <CardContent compact>
          <div className="sm-grid-card-top">
            <div className="sm-grid-q">{q}</div>
            <div className="sm-grid-ring">
              <ProgressRing
                value={ring}
                size={44}
                stroke={5}
                tone={ringTone === "dim" ? "dim" : ringTone}
                label={props.isClosingSoon ? "soon" : ""}
              />
            </div>
          </div>

          <div className="sm-grid-meta">
            <span className="sm-pill">
              <Icon name="clock" size={14} tone="dim" />
              {closeLabel}
            </span>

            <Chip as="span" size="sm" selected={false} variant="outline" tone={toneForCategory(cat)}>
              {cat}
            </Chip>
          </div>

          <div className="sm-grid-prices">
            <div className="sm-grid-price yes">
              <div className="sm-grid-price-k">YES</div>
              <div className="sm-grid-price-v">{yesCents}</div>
            </div>
            <div className="sm-grid-price no">
              <div className="sm-grid-price-k">NO</div>
              <div className="sm-grid-price-v">{noCents}</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </button>
  );
};
