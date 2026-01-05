// SigilMarkets/views/Prophecy/SealPredictionSheet.tsx
"use client";

import { useMemo, useState } from "react";
import type { KaiMoment, MarketId, MarketSide } from "../../types/marketTypes";
import { useMarkets } from "../../state/marketStore";
import { useProphecyFeed } from "../../hooks/useProphecyFeed";

import { Sheet } from "../../ui/atoms/Sheet";
import { Button } from "../../ui/atoms/Button";
import { Divider } from "../../ui/atoms/Divider";
import { Chip } from "../../ui/atoms/Chip";
import { Icon } from "../../ui/atoms/Icon";

import { YesNoToggle } from "../MarketRoom/YesNoToggle";

export type SealPredictionSheetProps = Readonly<{
  open: boolean;
  onClose: () => void;
  now: KaiMoment;
  /** If provided, pre-selects a market */
  initialMarketId: MarketId | null;
}>;

type Visibility = "public" | "private";

export const SealPredictionSheet = (props: SealPredictionSheetProps) => {
  const markets = useMarkets();
  const { activeVault, actions } = useProphecyFeed({ visibility: "all", includeResolved: true });

  const [marketIdStr, setMarketIdStr] = useState<string>(props.initialMarketId ? (props.initialMarketId as unknown as string) : "");
  const [side, setSide] = useState<MarketSide>("YES");
  const [visibility, setVisibility] = useState<Visibility>("public");
  const [note, setNote] = useState<string>("");

  // Keep selection updated if sheet is opened with a preselect
  const effectiveMarketIdStr = useMemo(() => {
    if (props.initialMarketId) return props.initialMarketId as unknown as string;
    return marketIdStr;
  }, [marketIdStr, props.initialMarketId]);

  const selectedMarket = useMemo(() => {
    const id = effectiveMarketIdStr.trim();
    if (id.length === 0) return null;
    return markets.find((m) => (m.def.id as unknown as string) === id) ?? null;
  }, [effectiveMarketIdStr, markets]);

  const canSeal = !!selectedMarket && !!activeVault;

  const subtitle = useMemo(() => {
    if (!activeVault) return "Inhale a glyph first to bind your prophecy to your identity.";
    return "A proof-of-forecast artifact. No wager required.";
  }, [activeVault]);

  const submit = (): void => {
    if (!selectedMarket) return;

    if (!activeVault) {
      actions.requireAuth("auth", selectedMarket.def.id);
      return;
    }

    actions.sealPrediction({
      marketId: selectedMarket.def.id,
      side,
      createdAt: props.now,
      visibility,
      note: note.trim().length > 0 ? note.trim() : undefined,
    });

    // Light reset (keep market selected for fast streak sealing)
    setNote("");
    props.onClose();
  };

  return (
    <Sheet
      open={props.open}
      onClose={props.onClose}
      title="Seal Prophecy"
      subtitle={subtitle}
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" }}>
          <Button variant="ghost" onClick={props.onClose}>
            Cancel
          </Button>

          {!activeVault ? (
            <Button
              variant="primary"
              onClick={() => actions.requireAuth("auth", selectedMarket?.def.id)}
              leftIcon={<Icon name="scan" size={14} tone="cyan" />}
            >
              Inhale glyph
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={submit}
              disabled={!canSeal}
              leftIcon={<Icon name="spark" size={14} tone="gold" />}
            >
              Seal
            </Button>
          )}
        </div>
      }
    >
      <div className="sm-seal">
        <div className="sm-seal-field">
          <div className="sm-seal-label">Prophecy</div>

          <select
            className="sm-select"
            value={effectiveMarketIdStr}
            onChange={(e) => setMarketIdStr(e.target.value)}
            disabled={!!props.initialMarketId}
          >
            <option value="">Select…</option>
            {markets.slice(0, 400).map((m) => (
              <option key={m.def.id as unknown as string} value={m.def.id as unknown as string}>
                {m.def.question}
              </option>
            ))}
          </select>

          {selectedMarket ? <div className="sm-small">close p{selectedMarket.def.timing.closePulse}</div> : null}
        </div>

        <Divider />

        <YesNoToggle value={side} onChange={setSide} />

        <Divider />

        <div className="sm-seal-field">
          <div className="sm-seal-label">Visibility</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Chip size="sm" selected={visibility === "public"} onClick={() => setVisibility("public")} tone="gold">
              public
            </Chip>
            <Chip
              size="sm"
              selected={visibility === "private"}
              onClick={() => setVisibility("private")}
              variant="outline"
              tone="default"
            >
              private
            </Chip>
          </div>
          <div className="sm-small">
            Private prophecies stay local unless you export/share them.
          </div>
        </div>

        <Divider />

        <div className="sm-seal-field">
          <div className="sm-seal-label">Note</div>
          <textarea
            className="sm-textarea"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional: what did you see?"
            rows={3}
          />
          <div className="sm-small">
            Notes are optional. The proof is the pulse + your identity binding.
          </div>
        </div>

        <Divider />

        <div className="sm-small">
          Sealing binds your forecast to pulse {props.now.pulse} (Kai time) and your identity glyph.
        </div>
      </div>
    </Sheet>
  );
};
