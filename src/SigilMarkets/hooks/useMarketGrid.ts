// SigilMarkets/hooks/useMarketGrid.ts
"use client";

import { useMemo } from "react";
import type { KaiPulse, Market, MarketCategory, MarketId, PhiMicro, PriceMicro } from "../types/marketTypes";
import { useMarkets } from "../state/marketStore";
import { useSigilMarketsUi } from "../state/uiStore";
import type { MarketGridFilters, MarketGridPrefs, MarketSort } from "../types/uiTypes";
import { normalizeMarketCategory } from "../constants/marketCategories";

export type MarketGridItem = Readonly<{
  market: Market;
  marketId: MarketId;

  /** Convenience for rendering. */
  yesPriceMicro: PriceMicro;
  noPriceMicro: PriceMicro;

  /** Close timing. */
  closePulse: KaiPulse;
  closeInPulses: number; // 0 if already closed
  isClosingSoon: boolean;

  /** Lightweight "heat" score for UI glow (0..1). */
  heat: number;
}>;

export type UseMarketGridResult = Readonly<{
  items: readonly MarketGridItem[];
  totalCount: number;
  filteredCount: number;

  filters: MarketGridFilters;
  prefs: MarketGridPrefs;

  /** Derived, for UI hints */
  activeCategoryCount: number;
  queryActive: boolean;
}>;

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

const normText = (s: string): string => s.trim().toLowerCase();

const matchesQuery = (m: Market, q: string): boolean => {
  const qq = normText(q);
  if (qq.length === 0) return true;

  const hay = [
    m.def.question,
    m.def.description ?? "",
    m.def.slug as unknown as string,
    ...(m.def.tags ?? []),
    m.def.category as unknown as string,
  ]
    .join(" ")
    .toLowerCase();

  return hay.includes(qq);
};

const categoryAllowed = (cat: MarketCategory, allowed: readonly MarketCategory[]): boolean => {
  if (allowed.length === 0) return true;
  const normalized = normalizeMarketCategory(cat);
  return allowed.some((entry) => normalizeMarketCategory(entry) === normalized);
};

const tagsAllowed = (tags: readonly string[], required?: readonly string[]): boolean => {
  if (!required || required.length === 0) return true;
  if (!tags || tags.length === 0) return false;
  const set = new Set(tags.map(normText));
  for (const t of required) {
    if (!set.has(normText(t))) return false;
  }
  return true;
};

const isResolvedLike = (status: string): boolean => status === "resolved" || status === "voided" || status === "canceled";

const microToNumberSafe = (v?: PhiMicro): number => {
  if (v === undefined) return 0;
  // For UI scoring only; clamp to safe float range.
  const asNum = Number(v);
  if (!Number.isFinite(asNum) || asNum < 0) return 0;
  return asNum;
};

/**
 * Heat score:
 * - closeness to close (more urgent)
 * - volume & liquidity (more alive)
 * - price imbalance (more drama)
 */
const computeHeat = (m: Market, closeInPulses: number): number => {
  const v = microToNumberSafe(m.state.volume24hMicro);
  const l = microToNumberSafe(m.state.liquidityMicro);

  // urgency: within 3000 pulses ramps up to 1
  const urgency = closeInPulses <= 0 ? 1 : clamp01(1 - closeInPulses / 3000);

  // activity: log scaled
  const activity = clamp01(Math.log10(1 + v + l) / 12);

  // drama: how far from 0.5
  const yes = Number(m.state.pricesMicro.yes);
  const no = Number(m.state.pricesMicro.no);
  const sum = yes + no;
  const yesPct = sum > 0 ? yes / sum : 0.5;
  const drama = clamp01(Math.abs(0.5 - yesPct) * 2);

  // weighted blend
  return clamp01(0.45 * urgency + 0.35 * activity + 0.2 * drama);
};

const calcCloseInPulses = (closePulse: KaiPulse, nowPulse: KaiPulse): number => {
  const c = Number.isFinite(closePulse) ? Math.floor(closePulse) : 0;
  const n = Number.isFinite(nowPulse) ? Math.floor(nowPulse) : 0;
  const d = c - n;
  return d <= 0 ? 0 : d;
};

const compareDeterministic = (a: MarketGridItem, b: MarketGridItem): number => {
  const ida = a.marketId as unknown as string;
  const idb = b.marketId as unknown as string;
  return ida < idb ? -1 : ida > idb ? 1 : 0;
};

const sortItems = (items: readonly MarketGridItem[], sort: MarketSort, nowPulse: KaiPulse): MarketGridItem[] => {
  const arr = [...items];

  arr.sort((a, b) => {
    if (sort === "closing-soon") {
      if (a.closeInPulses !== b.closeInPulses) return a.closeInPulses - b.closeInPulses;
      if (b.heat !== a.heat) return b.heat - a.heat;
      return compareDeterministic(a, b);
    }

    if (sort === "new") {
      const ap = a.market.def.timing.createdPulse ?? 0;
      const bp = b.market.def.timing.createdPulse ?? 0;
      if (bp !== ap) return bp - ap;
      return compareDeterministic(a, b);
    }

    if (sort === "volume") {
      const av = microToNumberSafe(a.market.state.volume24hMicro);
      const bv = microToNumberSafe(b.market.state.volume24hMicro);
      if (bv !== av) return bv - av;
      return compareDeterministic(a, b);
    }

    if (sort === "liquidity") {
      const al = microToNumberSafe(a.market.state.liquidityMicro);
      const bl = microToNumberSafe(b.market.state.liquidityMicro);
      if (bl !== al) return bl - al;
      return compareDeterministic(a, b);
    }

    if (sort === "big-movers") {
      // Without a time series, approximate "mover" by imbalance from 50/50 AND recency of update.
      const ay = Number(a.yesPriceMicro);
      const an = Number(a.noPriceMicro);
      const by = Number(b.yesPriceMicro);
      const bn = Number(b.noPriceMicro);

      const aSum = ay + an;
      const bSum = by + bn;

      const aYesPct = aSum > 0 ? ay / aSum : 0.5;
      const bYesPct = bSum > 0 ? by / bSum : 0.5;

      const aMove = Math.abs(0.5 - aYesPct);
      const bMove = Math.abs(0.5 - bYesPct);

      if (bMove !== aMove) return bMove - aMove;

      // tiebreaker: most recently updated
      const ap = a.market.state.updatedPulse ?? 0;
      const bp = b.market.state.updatedPulse ?? 0;
      if (bp !== ap) return bp - ap;

      return compareDeterministic(a, b);
    }

    // default: trending
    // Trending is heat + recency weighting.
    const aRecency = clamp01(1 - (nowPulse - (a.market.state.updatedPulse ?? nowPulse)) / 6000);
    const bRecency = clamp01(1 - (nowPulse - (b.market.state.updatedPulse ?? nowPulse)) / 6000);

    const aScore = 0.7 * a.heat + 0.3 * aRecency;
    const bScore = 0.7 * b.heat + 0.3 * bRecency;

    if (bScore !== aScore) return bScore - aScore;
    return compareDeterministic(a, b);
  });

  return arr;
};

/**
 * useMarketGrid
 * - Derives filtered + sorted market list from marketStore + uiStore.
 * - You pass nowPulse from usePulseTicker for pulse-accurate "closing soon".
 */
export const useMarketGrid = (nowPulse: KaiPulse): UseMarketGridResult => {
  const markets = useMarkets();
  const { state: ui } = useSigilMarketsUi();

  const filters = ui.grid.filters;
  const prefs = ui.grid.prefs;

  const totalCount = markets.length;

  const items = useMemo<readonly MarketGridItem[]>(() => {
    const out: MarketGridItem[] = [];

    for (const m of markets) {
      // includeResolved gate
      if (!filters.includeResolved && isResolvedLike(m.state.status)) continue;

      // query
      if (!matchesQuery(m, filters.query)) continue;

      // categories
      if (!categoryAllowed(m.def.category, filters.categories)) continue;

      // tags
      if (!tagsAllowed(m.def.tags, filters.tags)) continue;

      // closeWithinPulses
      const closePulse = m.def.timing.closePulse;
      const closeInPulses = calcCloseInPulses(closePulse, nowPulse);

      if (filters.closeWithinPulses !== undefined && closeInPulses > filters.closeWithinPulses) continue;

      const isClosingSoon = closeInPulses > 0 && closeInPulses <= 600; // ~“soon” band for UI glow

      const yesPriceMicro = m.state.pricesMicro.yes;
      const noPriceMicro = m.state.pricesMicro.no;

      out.push({
        market: m,
        marketId: m.def.id,
        yesPriceMicro,
        noPriceMicro,
        closePulse,
        closeInPulses,
        isClosingSoon,
        heat: computeHeat(m, closeInPulses),
      });
    }

    return sortItems(out, prefs.sort, nowPulse);
  }, [markets, filters.includeResolved, filters.query, filters.categories, filters.tags, filters.closeWithinPulses, prefs.sort, nowPulse]);

  const filteredCount = items.length;

  const activeCategoryCount = filters.categories.length;
  const queryActive = normText(filters.query).length > 0;

  return {
    items,
    totalCount,
    filteredCount,
    filters,
    prefs,
    activeCategoryCount,
    queryActive,
  };
};
