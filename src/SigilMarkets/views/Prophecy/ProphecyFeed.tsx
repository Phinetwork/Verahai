// SigilMarkets/views/Prophecy/ProphecyFeed.tsx
"use client";

import { useMemo, useState } from "react";
import type { KaiMoment, MarketId } from "../../types/marketTypes";
import { useSigilMarketsUi } from "../../state/uiStore";
import { useScrollRestoration } from "../../hooks/useScrollRestoration";
import { useProphecyFeed } from "../../hooks/useProphecyFeed";
import { useProphecySigils } from "../../hooks/useProphecySigils";
import { useMarkets } from "../../state/marketStore";

import { TopBar } from "../../ui/chrome/TopBar";
import { Card, CardContent } from "../../ui/atoms/Card";
import { Chip } from "../../ui/atoms/Chip";
import { Icon } from "../../ui/atoms/Icon";

import { ProphecyCard } from "./ProphecyCard";
import { ProphecySigilComposer } from "./ProphecySigilComposer";
import { ProphecySigilCard } from "./ProphecySigilCard";
import { SealPredictionSheet } from "./SealPredictionSheet";
import { ProphecyLeaderboard } from "./ProphecyLeaderboard";

export type ProphecyFeedProps = Readonly<{
  now: KaiMoment;
  scrollMode: "window" | "container";
  scrollRef: React.RefObject<HTMLDivElement | null> | null;
}>;

type ViewMode = "sigils" | "feed" | "leaderboard";

export const ProphecyFeed = (props: ProphecyFeedProps) => {
  const { state: uiState, actions: ui } = useSigilMarketsUi();

  useScrollRestoration(uiState.route, {
    mode: props.scrollMode,
    containerRef: props.scrollRef ?? undefined,
    restoreDelayMs: 0,
  });

  const markets = useMarkets();
  const questionById = useMemo(() => {
    const m = new Map<string, string>();
    for (const x of markets) {
      m.set(x.def.id as unknown as string, x.def.question);
    }
    return m;
  }, [markets]);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetMarketId, setSheetMarketId] = useState<MarketId | null>(null);

  const [mode, setMode] = useState<ViewMode>("sigils");

  const { prophecies, counts, leaderboard, activeVault, actions } = useProphecyFeed({
    visibility: "all",
    includeResolved: true,
  });
  const { prophecies: sigils, activeVault: sigilVault, actions: sigilActions } = useProphecySigils();

  const subtitle = useMemo(() => {
    if (mode === "sigils") return `${sigils.length} sealed sigils`;
    const parts: string[] = [];
    parts.push(`${counts.total} total`);
    if (counts.sealed > 0) parts.push(`${counts.sealed} sealed`);
    if (counts.fulfilled > 0) parts.push(`${counts.fulfilled} fulfilled`);
    if (counts.missed > 0) parts.push(`${counts.missed} missed`);
    return parts.join(" • ");
  }, [counts.fulfilled, counts.missed, counts.sealed, counts.total, mode, sigils.length]);

  return (
    <div className="sm-page" data-sm="prophecy">
      <TopBar title="Prophecy" subtitle={subtitle} now={props.now} scrollMode={props.scrollMode} scrollRef={props.scrollRef} />

      <div className="sm-proph-toolbar">
        <div className="sm-proph-left">
          <Chip
            size="sm"
            selected={mode === "sigils"}
            onClick={() => setMode("sigils")}
            left={<Icon name="spark" size={14} tone="gold" />}
          >
            Sigils
          </Chip>

          <Chip
            size="sm"
            selected={mode === "feed"}
            onClick={() => setMode("feed")}
            left={<Icon name="spark" size={14} tone="gold" />}
          >
            Feed
          </Chip>

          <Chip
            size="sm"
            selected={mode === "leaderboard"}
            onClick={() => setMode("leaderboard")}
            left={<Icon name="positions" size={14} tone="dim" />}
          >
            Leaderboard
          </Chip>
        </div>

        <div className="sm-proph-right">
          {mode === "feed" ? (
            <>
              <Chip
                size="sm"
                selected={false}
                tone="gold"
                onClick={() => {
                  setSheetMarketId(null);
                  setSheetOpen(true);
                }}
                left={<Icon name="plus" size={14} tone="gold" />}
              >
                Seal
              </Chip>

              {!activeVault ? (
                <Chip
                  size="sm"
                  selected={false}
                  variant="outline"
                  onClick={() => actions.requireAuth("auth")}
                  left={<Icon name="scan" size={14} tone="cyan" />}
                >
                  Inhale
                </Chip>
              ) : (
                <Chip size="sm" selected={false} variant="outline" left={<Icon name="vault" size={14} tone="dim" />}>
                  bound
                </Chip>
              )}
            </>
          ) : null}

          {mode === "sigils" ? (
            !sigilVault ? (
              <Chip
                size="sm"
                selected={false}
                variant="outline"
                onClick={() => sigilActions.requireAuth()}
                left={<Icon name="scan" size={14} tone="cyan" />}
              >
                Inhale
              </Chip>
            ) : (
              <Chip size="sm" selected={false} variant="outline" left={<Icon name="vault" size={14} tone="dim" />}>
                bound
              </Chip>
            )
          ) : null}
        </div>
      </div>

      {mode === "leaderboard" ? (
        <ProphecyLeaderboard rows={leaderboard} />
      ) : mode === "sigils" ? (
        <div className="sm-proph-sigil-grid">
          <ProphecySigilComposer now={props.now} />

          {sigils.length === 0 ? (
            <Card variant="glass">
              <CardContent>
                <div className="sm-title">No prophecy sigils yet.</div>
                <div className="sm-subtitle" style={{ marginTop: 8 }}>
                  Seal a textual claim into a self-verifying SVG. Proofs verify offline, without a server.
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="sm-proph-sigil-list">
              {sigils.slice(0, 60).map((p) => (
                <ProphecySigilCard
                  key={p.id as unknown as string}
                  prophecy={p}
                  now={props.now}
                  onRemove={() => sigilActions.remove(p.id)}
                />
              ))}
            </div>
          )}
        </div>
      ) : prophecies.length === 0 ? (
        <Card variant="glass">
          <CardContent>
            <div className="sm-title">No market prophecies yet.</div>
            <div className="sm-subtitle" style={{ marginTop: 8 }}>
              Seal a prediction as a portable proof-of-forecast. It can stand alone or accompany a wager.
            </div>
            <div style={{ marginTop: 12 }}>
              <Chip
                size="sm"
                selected={false}
                tone="gold"
                onClick={() => {
                  setSheetMarketId(null);
                  setSheetOpen(true);
                }}
                left={<Icon name="spark" size={14} tone="gold" />}
              >
                Seal your first prophecy
              </Chip>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="sm-proph-list">
          {prophecies.slice(0, 60).map((p) => (
            <ProphecyCard
              key={p.id as unknown as string}
              prophecy={p}
              now={props.now}
              marketQuestion={questionById.get(p.marketId as unknown as string) ?? "Prophecy"}
              onSealMore={() => {
                setSheetMarketId(p.marketId);
                setSheetOpen(true);
              }}
              onOpenMarket={() => ui.navigate({ view: "market", marketId: p.marketId })}
              onRemove={() => actions.remove(p.id)}
            />
          ))}
        </div>
      )}

      <SealPredictionSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        now={props.now}
        initialMarketId={sheetMarketId}
      />
    </div>
  );
};
