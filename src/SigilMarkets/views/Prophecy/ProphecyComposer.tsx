// SigilMarkets/views/Prophecy/ProphecyComposer.tsx
"use client";

import React, { useMemo, useState } from "react";
import type { KaiMoment, MarketId, MarketSide } from "../../types/marketTypes";
import { useMarkets } from "../../state/marketStore";
import { useProphecyFeed } from "../../hooks/useProphecyFeed";
import { YesNoToggle } from "../MarketRoom/YesNoToggle";
import { Card, CardContent } from "../../ui/atoms/Card";
import { Button } from "../../ui/atoms/Button";
import { Divider } from "../../ui/atoms/Divider";
import { Icon } from "../../ui/atoms/Icon";

export const ProphecyComposer = (props: Readonly<{ now: KaiMoment; initialMarketId?: MarketId }>) => {
  const markets = useMarkets();
  const { actions, activeVault } = useProphecyFeed({ visibility: "all", includeResolved: true });

  const [marketIdStr, setMarketIdStr] = useState<string>(props.initialMarketId ? (props.initialMarketId as unknown as string) : "");
  const [side, setSide] = useState<MarketSide>("YES");
  const [note, setNote] = useState("");

  const market = useMemo(
    () => markets.find((m) => (m.def.id as unknown as string) === marketIdStr) ?? null,
    [markets, marketIdStr],
  );

  const seal = (): void => {
    if (!market) return;
    actions.sealPrediction({
      marketId: market.def.id,
      side,
      createdAt: props.now,
      visibility: "public",
      note: note.trim().length ? note.trim() : undefined,
    });
    setNote("");
  };

  return (
    <Card variant="glass2">
      <CardContent>
        <div className="sm-title" style={{ fontSize: 14 }}>Seal a prophecy</div>
        <div className="sm-subtitle" style={{ marginTop: 6 }}>
          Proof-of-forecast. Portable. Verifiable. No wager required.
        </div>

        <Divider />

        <select className="sm-select" value={marketIdStr} onChange={(e) => setMarketIdStr(e.target.value)}>
          <option value="">Select market…</option>
          {markets.map((m) => (
            <option key={m.def.id as unknown as string} value={m.def.id as unknown as string}>
              {m.def.question}
            </option>
          ))}
        </select>

        <Divider />

        <YesNoToggle value={side} onChange={setSide} />

        <Divider />

        <textarea className="sm-textarea" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note…" />

        <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end" }}>
          <Button
            variant="primary"
            onClick={seal}
            disabled={!market || !activeVault}
            leftIcon={<Icon name="spark" size={14} tone="gold" />}
          >
            Seal
          </Button>
        </div>

        {!activeVault ? (
          <div className="sm-small" style={{ marginTop: 10 }}>
            Inhale a glyph to bind your identity before sealing.
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
};
