// SigilMarkets/hooks/useProphecyFeed.ts
"use client";

import { useCallback, useMemo } from "react";
import type { KaiMoment, KaiPulse, MarketId, MarketOutcome, MarketSide } from "../types/marketTypes";
import type { VaultRecord } from "../types/vaultTypes";
import { useActiveVault } from "../state/vaultStore";
import { useSigilMarketsUi } from "../state/uiStore";
import {
  useProphecyFeed as useProphecyFeedStoreList,
  useSigilMarketsFeedStore,
  type ProphecyAuthor,
  type ProphecyId,
  type ProphecyRecord,
  type ProphecySigilArtifact,
  type ProphecyStatus,
  type ProphecyVisibility,
} from "../state/feedStore";
import type { PositionId } from "../types/sigilPositionTypes";

export type ActionResult<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: string }>;

export type ProphecyFeedQuery = Readonly<{
  /** If provided, only prophecies for this market. */
  marketId?: MarketId;
  /**
   * Visibility filter:
   * - "public" | "private" to filter
   * - "all" to include both
   */
  visibility?: ProphecyVisibility | "all";
  /** Include resolved prophecies (fulfilled/missed/void). Default: true */
  includeResolved?: boolean;
}>;

export type ProphecyLeaderRow = Readonly<{
  /** Stable identity key (userPhiKey). */
  userPhiKey: string;
  /** Optional display label (first 8 chars) */
  label: string;

  total: number;
  sealed: number;
  fulfilled: number;
  missed: number;
  voided: number;

  /** fulfilled / (fulfilled + missed), 0..1 */
  accuracy: number;

  /** Simple “heat” score for ranking: accuracy weighted by volume. */
  score: number;
}>;

export type UseProphecyFeedResult = Readonly<{
  prophecies: readonly ProphecyRecord[];
  counts: Readonly<{
    total: number;
    sealed: number;
    fulfilled: number;
    missed: number;
    voided: number;
  }>;
  leaderboard: readonly ProphecyLeaderRow[];

  /** Convenience: are we authenticated (have an active vault identity)? */
  activeVault: VaultRecord | null;

  actions: Readonly<{
    /** Seal a prophecy; if not authenticated, opens inhale gate sheet. */
    sealPrediction: (req: Readonly<{
      marketId: MarketId;
      side: MarketSide;
      createdAt: KaiMoment;
      visibility?: ProphecyVisibility;
      note?: string;
      positionId?: PositionId;
      sigil?: ProphecySigilArtifact;
    }>) => ActionResult<ProphecyRecord>;

    /** Remove a prophecy by id. */
    remove: (id: ProphecyId) => void;

    /** If not authed, open inhale gate. */
    requireAuth: (reason: "auth" | "trade" | "vault", marketId?: MarketId) => void;

    /** Apply a market resolution snapshot to prophecies (usually called by Shell/controller). */
    applyResolutionToProphecies: (req: Readonly<{
      marketId: MarketId;
      outcome: MarketOutcome;
      resolvedPulse: KaiPulse;
    }>) => Readonly<{ updated: number }>;
  }>;
}>;

const isResolvedStatus = (s: ProphecyStatus): boolean => s === "fulfilled" || s === "missed" || s === "void";

const shortKey = (k: string): string => (k.length <= 10 ? k : `${k.slice(0, 8)}…${k.slice(-2)}`);

const filterProphecies = (items: readonly ProphecyRecord[], q?: ProphecyFeedQuery): readonly ProphecyRecord[] => {
  if (!q) return items;

  let out = items;

  if (q.marketId) {
    const mid = q.marketId as unknown as string;
    out = out.filter((p) => (p.marketId as unknown as string) === mid);
  }

  const vis = q.visibility ?? "all";
  if (vis !== "all") {
    out = out.filter((p) => p.visibility === vis);
  }

  const includeResolved = q.includeResolved ?? true;
  if (!includeResolved) {
    // ✅ Use the guard exactly as intended:
    // "resolved" means fulfilled/missed/void — exclude those, keep sealed/unresolved.
    out = out.filter((p) => !p.resolution || !isResolvedStatus(p.resolution.status));
  }

  return out;
};

const computeCounts = (items: readonly ProphecyRecord[]): UseProphecyFeedResult["counts"] => {
  let sealed = 0;
  let fulfilled = 0;
  let missed = 0;
  let voided = 0;

  for (const p of items) {
    const st = p.resolution?.status ?? "sealed";
    if (st === "sealed") sealed += 1;
    else if (st === "fulfilled") fulfilled += 1;
    else if (st === "missed") missed += 1;
    else voided += 1;
  }

  return {
    total: items.length,
    sealed,
    fulfilled,
    missed,
    voided,
  };
};

const computeLeaderboard = (items: readonly ProphecyRecord[]): readonly ProphecyLeaderRow[] => {
  type Agg = {
    userPhiKey: string;
    total: number;
    sealed: number;
    fulfilled: number;
    missed: number;
    voided: number;
  };

  const map = new Map<string, Agg>();

  for (const p of items) {
    const k = p.author.userPhiKey as unknown as string;
    const a = map.get(k) ?? { userPhiKey: k, total: 0, sealed: 0, fulfilled: 0, missed: 0, voided: 0 };

    a.total += 1;
    const st = p.resolution?.status ?? "sealed";
    if (st === "sealed") a.sealed += 1;
    else if (st === "fulfilled") a.fulfilled += 1;
    else if (st === "missed") a.missed += 1;
    else a.voided += 1;

    map.set(k, a);
  }

  const rows: ProphecyLeaderRow[] = [];
  for (const a of map.values()) {
    const denom = a.fulfilled + a.missed;
    const accuracy = denom <= 0 ? 0 : a.fulfilled / denom;

    // Score: accuracy (0..1) * log volume (1..)
    const score = accuracy * Math.log10(1 + a.total);

    rows.push({
      userPhiKey: a.userPhiKey,
      label: shortKey(a.userPhiKey),
      total: a.total,
      sealed: a.sealed,
      fulfilled: a.fulfilled,
      missed: a.missed,
      voided: a.voided,
      accuracy,
      score,
    });
  }

  rows.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.total !== a.total) return b.total - a.total;
    return a.userPhiKey < b.userPhiKey ? -1 : a.userPhiKey > b.userPhiKey ? 1 : 0;
  });

  return rows;
};

const authorFromVault = (v: VaultRecord): ProphecyAuthor => ({
  userPhiKey: v.owner.userPhiKey,
  kaiSignature: v.owner.kaiSignature,
});

export const useProphecyFeed = (query?: ProphecyFeedQuery): UseProphecyFeedResult => {
  const list = useProphecyFeedStoreList();
  const activeVault = useActiveVault();
  const { actions: ui } = useSigilMarketsUi();
  const { actions: feed } = useSigilMarketsFeedStore();

  const prophecies = useMemo(
    () => filterProphecies(list, query),
    [list, query?.marketId, query?.visibility, query?.includeResolved],
  );

  const counts = useMemo(() => computeCounts(prophecies), [prophecies]);

  const leaderboard = useMemo(() => computeLeaderboard(prophecies), [prophecies]);

  const requireAuth = useCallback(
    (reason: "auth" | "trade" | "vault", marketId?: MarketId) => {
      ui.pushSheet({ id: "inhale-glyph", reason, marketId });
    },
    [ui],
  );

  const sealPrediction = useCallback(
    (req: Readonly<{
      marketId: MarketId;
      side: MarketSide;
      createdAt: KaiMoment;
      visibility?: ProphecyVisibility;
      note?: string;
      positionId?: PositionId;
      sigil?: ProphecySigilArtifact;
    }>): ActionResult<ProphecyRecord> => {
      if (!activeVault) {
        requireAuth("auth", req.marketId);
        return { ok: false, error: "not authenticated" };
      }

      const rec = feed.addProphecy({
        marketId: req.marketId,
        side: req.side,
        createdAt: req.createdAt,
        author: authorFromVault(activeVault),
        visibility: req.visibility ?? "public",
        note: req.note,
        positionId: req.positionId,
        sigil: req.sigil,
      });

      ui.toast("success", "Prophecy sealed", undefined, { atPulse: req.createdAt.pulse });
      return { ok: true, value: rec };
    },
    [activeVault, feed, requireAuth, ui],
  );

  const remove = useCallback(
    (id: ProphecyId) => {
      feed.removeProphecy(id);
      ui.toast("info", "Removed", "Prophecy removed");
    },
    [feed, ui],
  );

  const applyResolutionToProphecies = useCallback(
    (req: Readonly<{ marketId: MarketId; outcome: MarketOutcome; resolvedPulse: KaiPulse }>) => {
      const r = feed.applyMarketResolutionToProphecies({
        marketId: req.marketId,
        outcome: req.outcome,
        resolvedPulse: req.resolvedPulse,
      });
      return { updated: r.updated };
    },
    [feed],
  );

  return {
    prophecies,
    counts,
    leaderboard,
    activeVault,
    actions: {
      sealPrediction,
      remove,
      requireAuth,
      applyResolutionToProphecies,
    },
  };
};
