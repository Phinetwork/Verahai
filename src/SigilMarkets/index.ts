// SigilMarkets/index.ts
/* eslint-disable @typescript-eslint/consistent-type-definitions */

/**
 * SigilMarkets — public module exports
 *
 * This file is the single import surface for wiring SigilMarkets into:
 * - phi.network (main app)
 * - verahai.com (standalone TSX app)
 *
 * Pattern:
 *   import { SigilMarketsShell } from "@/components/SigilMarkets";
 *   <SigilMarketsShell />
 */

export { SigilMarketsShell } from "./SigilMarketsShell";
export { SigilMarketsRoutes } from "./SigilMarketsRoutes";
export { SigilMarketsDock } from "./SigilMarketsDock";

/** Providers (module-local state) */
export { SigilMarketsUiProvider, useSigilMarketsUi, useSigilMarketsRoute } from "./state/uiStore";
export { SigilMarketsMarketProvider, useSigilMarketsMarketStore, useMarkets, useMarketById } from "./state/marketStore";
export { SigilMarketsVaultProvider, useSigilMarketsVaultStore, useActiveVault, useVaultById } from "./state/vaultStore";
export { SigilMarketsPositionProvider, useSigilMarketsPositionStore } from "./state/positionStore";
export { SigilMarketsFeedProvider, useSigilMarketsFeedStore } from "./state/feedStore";
export { SigilMarketsRuntimeConfigProvider, useSigilMarketsRuntimeConfig } from "./state/runtimeConfig";

/** Hooks */
export { useKaiNow } from "./hooks/useKaiNow";
export { usePulseTicker } from "./hooks/usePulseTicker";
export { useMarketGrid } from "./hooks/useMarketGrid";
export { useMarket, useMarketFromRoute, useRouteMarketId } from "./hooks/useMarket";
export { useVault, useVaultActions } from "./hooks/useVault";
export { usePositions, usePositionsForMarket, usePosition } from "./hooks/usePositions";
export { useProphecyFeed } from "./hooks/useProphecyFeed";
export { useHaptics } from "./hooks/useHaptics";
export { useSfx } from "./hooks/useSfx";
export { useStickyHeader } from "./hooks/useStickyHeader";
export { useScrollRestoration } from "./hooks/useScrollRestoration";

/** APIs (local-first; remote-ready) */
export { defaultMarketApiConfig, fetchMarkets, seedDemoMarkets } from "./api/marketApi";
export { defaultVaultApiConfig, fetchVaultSnapshot } from "./api/vaultApi";
export { defaultPositionApiConfig, executeLocalTrade, executeTrade } from "./api/positionApi";
export { defaultOracleApiConfig, createLocalProposal, createLocalFinalization, makeResolutionSigilPayload } from "./api/oracleApi";
export { cachedJsonFetch, clearSigilMarketsCache, pruneSigilMarketsCache, setSigilMarketsCacheStorageEnabled } from "./api/cacheApi";

/** Utils */
export { formatPhiMicro, formatPhiMicroCompact, formatPriceMicro, formatSharesMicro, formatCloseIn, parsePhiToMicro } from "./utils/format";
export { quoteAmmTrade, quoteParimutuelStake, payoutForShares, sharesForStakeAtPrice, feeFromBps, checkSlippage } from "./utils/math";
export { deriveVaultId, deriveLockId, derivePositionId, newPositionId, newLockId, sha256Hex } from "./utils/ids";
export { safeJsonParse, safeJsonStringify, parsePhiMicro, parseShareMicro, parsePriceMicro } from "./utils/guards";

/** Views (optional direct imports) */
export { MarketGrid } from "./views/MarketGrid/MarketGrid";
export { MarketRoom } from "./views/MarketRoom/MarketRoom";
export { VaultPanel } from "./views/Vault/VaultPanel";
export { PositionsHome } from "./views/Positions/PositionsHome";
export { ProphecyFeed } from "./views/Prophecy/ProphecyFeed";
export { ResolutionCenter } from "./views/Resolution/ResolutionCenter";

/** Types (barrel) */
export * from "./types/marketTypes";
export * from "./types/vaultTypes";
export * from "./types/sigilPositionTypes";
export * from "./types/oracleTypes";
export * from "./types/uiTypes";
