// SigilMarkets/types/uiTypes.ts
/* eslint-disable @typescript-eslint/consistent-type-definitions */

/**
 * SigilMarkets — uiTypes (normative)
 *
 * UI types define:
 * - routing + view ids
 * - sheet/modal ids and their payloads
 * - filter/sort models for the MarketGrid
 * - ephemeral UI state that should not leak into protocol logic
 */

import type { Brand, KaiPulse, MarketCategory, MarketId, MarketSide } from "./marketTypes";
import type { PositionId } from "./sigilPositionTypes";
import type { VaultId } from "./marketTypes";

/** View ids for routes inside SigilMarkets. */
export type SigilMarketsView =
  | "grid"
  | "market"
  | "vault"
  | "positions"
  | "position"
  | "prophecy"
  | "resolution";

export const isSigilMarketsView = (v: unknown): v is SigilMarketsView =>
  v === "grid" ||
  v === "market" ||
  v === "vault" ||
  v === "positions" ||
  v === "position" ||
  v === "prophecy" ||
  v === "resolution";

/** Internal route params for SigilMarkets. */
export type SigilMarketsRoute =
  | Readonly<{ view: "grid" }>
  | Readonly<{ view: "market"; marketId: MarketId }>
  | Readonly<{ view: "vault"; vaultId: VaultId }>
  | Readonly<{ view: "positions" }>
  | Readonly<{ view: "position"; positionId: PositionId }>
  | Readonly<{ view: "prophecy" }>
  | Readonly<{ view: "resolution"; marketId: MarketId }>;

/** UI theme modes for the module (can map to your global theme). */
export type SigilMarketsTheme = "auto" | "dark" | "light";

/** Sound/haptics toggle. */
export type Toggle = boolean;

/** A lightweight alert/toast id. */
export type ToastId = Brand<string, "ToastId">;
export const asToastId = (v: string): ToastId => v as ToastId;

export type ToastKind = "info" | "success" | "warning" | "error";

/** Toast payload. */
export type ToastModel = Readonly<{
  id: ToastId;
  kind: ToastKind;
  title: string;
  message?: string;
  /** Pulse for ordering in a deterministic UI timeline (optional). */
  atPulse?: KaiPulse;
  /** Auto-dismiss after ms (UI only). */
  ttlMs?: number;
}>;

/** Market grid sorting. */
export type MarketSort =
  | "trending"
  | "closing-soon"
  | "new"
  | "volume"
  | "liquidity"
  | "big-movers";

export const isMarketSort = (v: unknown): v is MarketSort =>
  v === "trending" ||
  v === "closing-soon" ||
  v === "new" ||
  v === "volume" ||
  v === "liquidity" ||
  v === "big-movers";

/** Market grid filter model. */
export type MarketGridFilters = Readonly<{
  query: string;
  categories: readonly MarketCategory[];
  /** Only show markets that close within this many pulses (optional). */
  closeWithinPulses?: number;
  /** Only show markets with tags (optional). */
  tags?: readonly string[];
  /** Hide resolved/voided/canceled by default. */
  includeResolved: boolean;
}>;

/** Market grid UI prefs. */
export type MarketGridPrefs = Readonly<{
  sort: MarketSort;
  /** "honeycomb" = default addictive; "list" for accessibility. */
  layout: "honeycomb" | "list";
  /** Whether to show mini sparkline in cells. */
  showSparklines: boolean;
}>;

/** A generic sheet id for mobile-first UX. */
export type SheetId =
  | "inhale-glyph"
  | "lock-confirm"
  | "mint-position"
  | "deposit-withdraw"
  | "claim"
  | "export-position"
  | "transfer-position"
  | "seal-prediction"
  | "dispute"
  | "share-sigil";

export const isSheetId = (v: unknown): v is SheetId =>
  v === "inhale-glyph" ||
  v === "lock-confirm" ||
  v === "mint-position" ||
  v === "deposit-withdraw" ||
  v === "claim" ||
  v === "export-position" ||
  v === "transfer-position" ||
  v === "seal-prediction" ||
  v === "dispute" ||
  v === "share-sigil";

/** Specific payloads per sheet. Keep small and UI-only. */
export type SheetPayload =
  | Readonly<{ id: "inhale-glyph"; reason: "auth" | "trade" | "vault"; marketId?: MarketId }>
  | Readonly<{
      id: "lock-confirm";
      marketId: MarketId;
      side: MarketSide;
      stakeMicroStr: string; // UI string; logic uses bigint elsewhere
    }>
  | Readonly<{ id: "mint-position"; positionId: PositionId }>
  | Readonly<{ id: "deposit-withdraw"; vaultId: VaultId; mode?: "deposit" | "withdraw" }>
  | Readonly<{ id: "claim"; positionId: PositionId }>
  | Readonly<{ id: "export-position"; positionId: PositionId }>
  | Readonly<{ id: "transfer-position"; positionId: PositionId }>
  | Readonly<{ id: "seal-prediction"; marketId?: MarketId }>
  | Readonly<{ id: "dispute"; marketId: MarketId }>
  | Readonly<{ id: "share-sigil"; kind: "position" | "resolution" | "vault"; refId: string }>;

/** Current sheet stack model (supports nested sheets). */
export type SheetStackItem = Readonly<{
  payload: SheetPayload;
  openedAtMs: number;
}>;

/** Global UI state for the SigilMarkets module. */
export type SigilMarketsUiState = Readonly<{
  theme: SigilMarketsTheme;
  hapticsEnabled: Toggle;
  sfxEnabled: Toggle;

  /** Active route. */
  route: SigilMarketsRoute;

  /** Market grid UI model. */
  grid: Readonly<{
    filters: MarketGridFilters;
    prefs: MarketGridPrefs;
    /** Remember last scroll position per route (UI only). */
    scrollYByKey: Readonly<Record<string, number>>;
  }>;

  /** Sheet stack. */
  sheets: readonly SheetStackItem[];

  /** Toast queue. */
  toasts: readonly ToastModel[];

  /** Animation hints (UI only). */
  motion: Readonly<{
    reduceMotion: boolean;
    /** When true, show confetti on next win claim. */
    confettiArmed: boolean;
  }>;
}>;

/** Convenience helper for route keys. */
export const routeKey = (r: SigilMarketsRoute): string => {
  switch (r.view) {
    case "grid":
      return "grid";
    case "market":
      return `market:${r.marketId}`;
    case "vault":
      return `vault:${r.vaultId}`;
    case "positions":
      return "positions";
    case "position":
      return `position:${r.positionId}`;
    case "prophecy":
      return "prophecy";
    case "resolution":
      return `resolution:${r.marketId}`;
    default: {
      // exhaustive check
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const _never: never = r;
      return "grid";
    }
  }
};
