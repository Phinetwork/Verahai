// SigilMarkets/views/MarketRoom/MarketOrderPanel.tsx
"use client";

import React, { useMemo, useState } from "react";
import type { KaiMoment, Market, MarketQuote, MarketQuoteRequest, MarketSide, PhiMicro, PriceMicro } from "../../types/marketTypes";
import { ONE_PHI_MICRO } from "../../types/marketTypes";

import { Card, CardContent } from "../../ui/atoms/Card";
import { Button } from "../../ui/atoms/Button";
import { Divider } from "../../ui/atoms/Divider";
import { Icon } from "../../ui/atoms/Icon";

import { YesNoToggle } from "./YesNoToggle";
import { StakeSlider } from "./StakeSlider";
import { QuotePreview } from "./QuotePreview";
import { LockConfirmSheet } from "./LockConfirmSheet";
import { MintPositionSheet } from "./MintPositionSheet";

import { useActiveVault, useSigilMarketsVaultStore } from "../../state/vaultStore";
import { useSigilMarketsUi } from "../../state/uiStore";
import { useSigilMarketsPositionStore } from "../../state/positionStore";
import { useSigilMarketsFeedStore } from "../../state/feedStore";

import { useHaptics } from "../../hooks/useHaptics";
import { useSfx } from "../../hooks/useSfx";

import { executeLocalTrade } from "../../api/positionApi";
import type { PositionRecord } from "../../types/sigilPositionTypes";
import { deriveMarketStatus } from "../../utils/marketTiming";

export type MarketOrderPanelProps = Readonly<{
  market: Market;
  now: KaiMoment;
}>;

const deriveNoPriceMicro = (yes: bigint): bigint => ONE_PHI_MICRO - yes;

export const MarketOrderPanel = (props: MarketOrderPanelProps) => {
  const activeVault = useActiveVault();
  const { actions: ui } = useSigilMarketsUi();
  const { actions: vaultActions } = useSigilMarketsVaultStore();
  const { actions: posActions } = useSigilMarketsPositionStore();
  const { actions: feedActions } = useSigilMarketsFeedStore();

  const haptics = useHaptics();
  const sfx = useSfx();

  const yesPriceMicro = props.market.state.pricesMicro.yes;
  const noPriceMicro = (deriveNoPriceMicro(yesPriceMicro as unknown as bigint) as unknown) as PriceMicro;

  const marketStatus = useMemo(() => deriveMarketStatus(props.market, props.now.pulse), [props.market, props.now.pulse]);
  const tradingOpen = marketStatus === "open";
  const statusMessage = useMemo(() => {
    if (marketStatus === "closed") return "Trading closed • awaiting resolution.";
    if (marketStatus === "resolving") return "Resolution in progress.";
    if (marketStatus === "resolved") return "Resolved • claims available.";
    if (marketStatus === "voided") return "Market voided.";
    if (marketStatus === "canceled") return "Market canceled.";
    return null;
  }, [marketStatus]);

  const [side, setSide] = useState<MarketSide>("YES");
  const [stakeMicro, setStakeMicro] = useState<PhiMicro>(0n as PhiMicro);

  const [quote, setQuote] = useState<MarketQuote | null>(null);

  const [confirmOpen, setConfirmOpen] = useState<boolean>(false);
  const [mintOpen, setMintOpen] = useState<boolean>(false);
  const [pendingPosition, setPendingPosition] = useState<PositionRecord | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  const spendableMicro = activeVault?.spendableMicro ?? (0n as PhiMicro);

  const canTrade = useMemo(() => {
    const s = stakeMicro as unknown as bigint;
    const spend = spendableMicro as unknown as bigint;
    return tradingOpen && !!activeVault && s > 0n && spend >= s;
  }, [activeVault, stakeMicro, spendableMicro, tradingOpen]);

  const updateQuote = async (nextStake: PhiMicro, nextSide: MarketSide): Promise<void> => {
    if (!activeVault) {
      setQuote(null);
      return;
    }
    const s = nextStake as unknown as bigint;
    if (s <= 0n) {
      setQuote(null);
      return;
    }

    const req: MarketQuoteRequest = {
      marketId: props.market.def.id,
      side: nextSide,
      orderType: "market",
      stakeMicro: nextStake,
      maxSlippageBps: 400,
    };

    const res = await executeLocalTrade({
      market: props.market,
      vault: activeVault,
      now: props.now,
      request: req,
      nonce: "quote",
    });

    if (!res.ok) {
      setQuote(null);
      return;
    }
    setQuote(res.quote);
  };

  const onSide = (next: MarketSide): void => {
    haptics.fire("toggle");
    sfx.play("toggle");
    setSide(next);
    void updateQuote(stakeMicro, next);
  };

  const onStake = (next: PhiMicro): void => {
    setStakeMicro(next);
    void updateQuote(next, side);
  };

  const requireAuth = (): void => {
    ui.pushSheet({ id: "inhale-glyph", reason: "trade", marketId: props.market.def.id });
  };

  const beginConfirm = (): void => {
    if (!activeVault) return requireAuth();
    if (!quote) return;

    haptics.fire("confirm");
    sfx.play("lock");
    setConfirmOpen(true);
  };

  const confirmLockAndOpenPosition = async (): Promise<void> => {
    if (!activeVault) return;
    if (!quote) return;

    setLoading(true);

    const req: MarketQuoteRequest = {
      marketId: props.market.def.id,
      side,
      orderType: "market",
      stakeMicro,
      maxSlippageBps: 400,
    };

    const res = await executeLocalTrade({
      market: props.market,
      vault: activeVault,
      now: props.now,
      request: req,
      nonce: `${props.now.pulse}:${Math.random().toString(16).slice(2)}`,
    });

    if (!res.ok) {
      setLoading(false);
      ui.toast("error", "Trade failed", res.error, { atPulse: props.now.pulse });
      sfx.play("error");
      return;
    }

    vaultActions.openLock({
      vaultId: res.lock.vaultId,
      lockId: res.lock.lockId,
      amountMicro: res.lock.amountMicro,
      reason: res.lock.reason,
      createdAt: res.lock.createdAt,
      updatedPulse: res.lock.updatedPulse,
      marketId: res.lock.marketId as unknown as string,
      positionId: res.lock.positionId as unknown as string,
      note: `Stake ${side}`,
    });

    const opened = posActions.openPosition({
      id: res.position.id,
      marketId: res.position.marketId,
      lock: res.position.lock,
      entry: res.position.entry,
      payoutModel: res.position.payoutModel,
      updatedPulse: res.position.updatedPulse,
    });

    feedActions.appendMarketActivity({
      marketId: res.activity.marketId,
      events: [
        {
          type: "trade",
          marketId: res.activity.marketId,
          side: res.activity.side,
          stakeMicro: res.activity.stakeMicro,
          sharesMicro: res.activity.sharesMicro,
          avgPriceMicro: res.activity.avgPriceMicro,
          atPulse: res.activity.atPulse,
          vaultId: res.activity.vaultId,
          lockId: res.activity.lockId,
        },
      ],
      updatedPulse: props.now.pulse,
    });

    setPendingPosition(opened);
    setConfirmOpen(false);
    setMintOpen(true);

    ui.toast("success", "Locked", "Position opened", { atPulse: props.now.pulse });
    sfx.play("mint");
    haptics.fire("success");

    setLoading(false);
  };

  return (
    <div className="sm-order" data-sm="order">
      <Card variant="glass">
        <CardContent>
          <div className="sm-order-top">
            <div className="sm-order-title">Take a side</div>
          <div className="sm-order-sub">Lock Φ into your glyph and mint the position.</div>
          {!tradingOpen && statusMessage ? <div className="sm-order-status">{statusMessage}</div> : null}
        </div>

          <Divider />

          <YesNoToggle
            value={side}
            onChange={onSide}
            yesPriceMicro={yesPriceMicro}
            noPriceMicro={noPriceMicro}
            priceMode="cents"
            disabled={!tradingOpen}
          />

          <Divider />

          <StakeSlider
            spendableMicro={spendableMicro}
            valueMicro={stakeMicro}
            onChangeMicro={onStake}
            disabled={!tradingOpen}
          />

          <Divider />

          <QuotePreview quote={quote} nowPulse={props.now.pulse} />

          <div className="sm-order-cta">
            {!activeVault ? (
              <Button variant="primary" onClick={requireAuth} leftIcon={<Icon name="scan" size={14} tone="cyan" />}>
                Inhale glyph to trade
              </Button>
            ) : (
              <Button
                variant="primary"
                onClick={beginConfirm}
                disabled={!canTrade || !quote}
                leftIcon={<Icon name="vault" size={14} tone="gold" />}
              >
                Lock & mint
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <LockConfirmSheet
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        now={props.now}
        quote={quote}
        spendableMicro={spendableMicro}
        onConfirm={confirmLockAndOpenPosition}
        loading={loading}
      />

      <MintPositionSheet
        open={mintOpen}
        onClose={() => setMintOpen(false)}
        now={props.now}
        position={pendingPosition}
      />
    </div>
  );
};
