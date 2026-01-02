// SigilMarkets/SigilMarketsShell.tsx
"use client";

import React, { useEffect, useMemo, useRef } from "react";
import "./styles/sigilMarkets.css";
import "./styles/breathe.css";
import "./styles/motion.css";

import { SigilMarketsUiProvider, useSigilMarketsUi } from "./state/uiStore";
import { SigilMarketsMarketProvider, useSigilMarketsMarketStore } from "./state/marketStore";
import { SigilMarketsVaultProvider } from "./state/vaultStore";
import { SigilMarketsPositionProvider, useSigilMarketsPositionStore } from "./state/positionStore";
import { SigilMarketsFeedProvider, useSigilMarketsFeedStore } from "./state/feedStore";

import { SigilMarketsRoutes } from "./SigilMarketsRoutes";

import { usePulseTicker } from "./hooks/usePulseTicker";
import { useSfx } from "./hooks/useSfx";

import { defaultMarketApiConfig, fetchMarkets, type SigilMarketsMarketApiConfig } from "./api/marketApi";
import type { KaiMoment, KaiPulse, Market, MarketOutcome } from "./types/marketTypes";

export type SigilMarketsShellProps = Readonly<{
  className?: string;
  style?: React.CSSProperties;

  /** Optional override: remote/local config for market list. */
  marketApiConfig?: SigilMarketsMarketApiConfig;

  /**
   * If true, renders without an internal scroll container and assumes window scroll.
   * Default: false (container scroll).
   */
  windowScroll?: boolean;
}>;

type AppliedResolutionKey = string;

const isResolvedLike = (status: string): boolean => status === "resolved" || status === "voided" || status === "canceled";

const resolutionKey = (m: Market): AppliedResolutionKey => {
  const rid = m.state.resolution;
  if (!rid) return `${m.def.id}:none`;
  return `${m.def.id}:${rid.outcome}:${rid.resolvedPulse}`;
};

// Toggle is a small app-level type; keep this predicate permissive and runtime-safe.
const isToggleOn = (t: unknown): boolean =>
  t === true || t === 1 || t === "on" || t === "true" || t === "enabled";

const ShellInner = (props: Readonly<{ marketApiConfig?: SigilMarketsMarketApiConfig; windowScroll: boolean }>) => {
  const { state: uiState, actions: ui } = useSigilMarketsUi();
  const { state: marketState, actions: markets } = useSigilMarketsMarketStore();
  const { actions: positions } = useSigilMarketsPositionStore();
  const { actions: feed } = useSigilMarketsFeedStore();

  const scrollRef = useRef<HTMLDivElement | null>(null);

  const { moment } = usePulseTicker({
    enabled: true,
    syncOnVisibility: true,
    pauseWhenHidden: false,
  });

  // Use KaiMoment explicitly (typed UI + provenance).
  const now: KaiMoment = moment as KaiMoment;

  const marketCfg = useMemo(() => props.marketApiConfig ?? defaultMarketApiConfig(), [props.marketApiConfig]);

  // Use uiState intentionally: theme + user toggles (sfx/haptics).
  const themeClass = useMemo(() => {
    const t = (uiState.theme as unknown as string) || "default";
    return `sm-theme-${t}`;
  }, [uiState.theme]);

  const sfxEnabled = useMemo(() => isToggleOn(uiState.sfxEnabled as unknown), [uiState.sfxEnabled]);

  // Audio unlock on first gesture (best-effort).
  const sfx = useSfx();
  useEffect(() => {
    if (typeof window === "undefined") return;

    const onGesture = (): void => {
      if (sfxEnabled) sfx.unlock();
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("touchstart", onGesture);
      window.removeEventListener("keydown", onGesture);
    };

    window.addEventListener("pointerdown", onGesture, { passive: true });
    window.addEventListener("touchstart", onGesture, { passive: true });
    window.addEventListener("keydown", onGesture);

    return () => {
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("touchstart", onGesture);
      window.removeEventListener("keydown", onGesture);
    };
  }, [sfx, sfxEnabled]);

  // Market fetch orchestration (offline-first, event-driven).
  const inFlightRef = useRef<boolean>(false);
  const lastFetchPulseRef = useRef<number>(-1);

  const doFetchMarkets = async (reason: "mount" | "focus" | "visible" | "online" | "manual" | "pulse"): Promise<void> => {
    if (inFlightRef.current) return;

    // Avoid refetching multiple times inside the same pulse unless manual.
    if (reason !== "manual" && lastFetchPulseRef.current === now.pulse) return;

    inFlightRef.current = true;
    lastFetchPulseRef.current = now.pulse;

    markets.setStatus("loading");

    const res = await fetchMarkets(marketCfg, now.pulse);

    if (!res.ok) {
      markets.setStatus("error", res.error);
      ui.toast("warning", "Markets offline", res.error);
      inFlightRef.current = false;
      return;
    }

    markets.setMarkets(res.markets, { lastSyncedPulse: res.lastSyncedPulse });

    if (res.isStale) {
      ui.toast("info", "Using cached markets", "Refreshing…");
    }

    inFlightRef.current = false;
  };

  useEffect(() => {
    void doFetchMarkets("mount");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marketCfg]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return;

    const onFocus = (): void => void doFetchMarkets("focus");
    const onOnline = (): void => void doFetchMarkets("online");
    const onVisibility = (): void => {
      if (document.visibilityState === "visible") void doFetchMarkets("visible");
    };

    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marketCfg, now.pulse]);

  const lastAutoRefreshPulseRef = useRef<Map<string, KaiPulse>>(new Map());

  useEffect(() => {
    if (marketState.ids.length === 0) return;

    const list = marketState.ids
      .map((id) => marketState.byId[id as unknown as string])
      .filter((m): m is Market => m !== undefined);

    let shouldRefresh = false;

    for (const m of list) {
      if (isResolvedLike(m.state.status)) continue;

      let boundaryPulse: KaiPulse | null = null;
      if (m.state.status === "open") boundaryPulse = m.def.timing.closePulse;
      if (m.state.status === "closed" || m.state.status === "resolving") {
        boundaryPulse = m.def.timing.resolveEarliestPulse ?? m.def.timing.resolveByPulse ?? null;
      }

      if (boundaryPulse == null) continue;
      if (now.pulse < boundaryPulse) continue;

      const key = m.def.id as unknown as string;
      const last = lastAutoRefreshPulseRef.current.get(key) ?? -1;
      if (last >= boundaryPulse) continue;

      lastAutoRefreshPulseRef.current.set(key, boundaryPulse);
      shouldRefresh = true;
    }

    if (shouldRefresh) void doFetchMarkets("pulse");
  }, [marketState.byId, marketState.ids, now.pulse]);

  // Apply market resolutions to positions + prophecies exactly once per (marketId,outcome,resolvedPulse).
  const appliedResolutionsRef = useRef<Set<AppliedResolutionKey>>(new Set());

  useEffect(() => {
    const list = marketState.ids
      .map((id) => marketState.byId[id as unknown as string])
      .filter((m): m is Market => m !== undefined);

    for (const m of list) {
      if (!isResolvedLike(m.state.status)) continue;
      const r = m.state.resolution;
      if (!r) continue;

      const key = resolutionKey(m);
      if (appliedResolutionsRef.current.has(key)) continue;

      appliedResolutionsRef.current.add(key);

      const outcome: MarketOutcome = r.outcome;

      // Apply to all open positions for the market (positionStore).
      positions.applyMarketResolution({
        marketId: m.def.id,
        outcome,
        resolvedPulse: r.resolvedPulse,
        evidenceHashes: r.evidence?.hashes,
      });

      // Apply to prophecies for the market (feedStore).
      feed.applyMarketResolutionToProphecies({
        marketId: m.def.id,
        outcome,
        resolvedPulse: r.resolvedPulse,
        evidenceHashes: r.evidence?.hashes,
      });

      ui.toast("info", "Market resolved", `${m.def.question}`, { atPulse: r.resolvedPulse });
      if (sfxEnabled) sfx.play("resolve");
    }
  }, [feed, marketState.byId, marketState.ids, positions, sfx, sfxEnabled, ui]);

  const shellClass = `sm-shell ${themeClass}${props.windowScroll ? " sm-window-scroll" : " sm-container-scroll"}`;

  if (props.windowScroll) {
    return (
      <div className={shellClass} data-sm="shell" data-sm-theme={String(uiState.theme)}>
        <SigilMarketsRoutes now={now} scrollMode="window" scrollRef={null} />
      </div>
    );
  }

  return (
    <div className={shellClass} data-sm="shell" data-sm-theme={String(uiState.theme)}>
      <div className="sm-scroll" ref={scrollRef}>
        <SigilMarketsRoutes now={now} scrollMode="container" scrollRef={scrollRef} />
      </div>
    </div>
  );
};

export const SigilMarketsShell = (props: SigilMarketsShellProps) => {
  const windowScroll = props.windowScroll ?? false;

  return (
    <div className={props.className} style={props.style} data-sm-root="1">
      <SigilMarketsUiProvider>
        <SigilMarketsMarketProvider>
          <SigilMarketsVaultProvider>
            <SigilMarketsPositionProvider>
              <SigilMarketsFeedProvider>
                <ShellInner marketApiConfig={props.marketApiConfig} windowScroll={windowScroll} />
              </SigilMarketsFeedProvider>
            </SigilMarketsPositionProvider>
          </SigilMarketsVaultProvider>
        </SigilMarketsMarketProvider>
      </SigilMarketsUiProvider>
    </div>
  );
};
