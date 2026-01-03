// SigilMarkets/state/uiStore.tsx
"use client";

/* eslint-disable @typescript-eslint/consistent-type-definitions */

import React, { createContext, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  SM_UI_STATE_KEY,
  decodeEnvelope,
  getDefaultStorage,
  loadFromStorage,
  removeFromStorage,
  saveToStorage,
  wrapEnvelope,
  type Decoder,
  type JsonValue,
  type PersistResult,
  type StorageLike,
} from "./persistence";

import {
  asToastId,
  isMarketSort,
  isSheetId,
  isSigilMarketsView,
  routeKey,
  type MarketGridFilters,
  type MarketGridPrefs,
  type SheetPayload,
  type SigilMarketsRoute,
  type SigilMarketsTheme,
  type SigilMarketsUiState,
  type SheetStackItem,
  type ToastKind,
  type ToastModel,
} from "../types/uiTypes";

import { asMarketId, asVaultId, type MarketId, type VaultId } from "../types/marketTypes";
import { asPositionId, type PositionId } from "../types/sigilPositionTypes";

/**
 * KaiPulse is used in UI-only affordances (e.g., toast annotations).
 * If you already have a canonical KaiPulse brand type elsewhere, import it here
 * and delete this alias.
 */
type KaiPulse = number;

type UnknownRecord = Record<string, unknown>;

const isRecord = (v: unknown): v is UnknownRecord => typeof v === "object" && v !== null;
const isString = (v: unknown): v is string => typeof v === "string";
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isBoolean = (v: unknown): v is boolean => typeof v === "boolean";

const clampInt = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Math.floor(n)));

/** UI-only time (not canonical Kai time). Used for debounce + toast ids. */
const nowMs = (): number => {
  const t = Date.now();
  return Number.isFinite(t) ? t : 0;
};

const genToastId = (): string => `t_${nowMs()}_${Math.random().toString(16).slice(2)}`;

const prefersReducedMotion = (): boolean => {
  try {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

const detectTheme = (): SigilMarketsTheme => "auto";

/** Defaults */
const defaultFilters = (): MarketGridFilters => ({
  query: "",
  categories: [],
  includeResolved: false,
});

const defaultPrefs = (): MarketGridPrefs => ({
  sort: "trending",
  layout: "honeycomb",
  showSparklines: true,
});

const defaultRoute = (): SigilMarketsRoute => ({ view: "grid" });

export const defaultUiState = (): SigilMarketsUiState => ({
  theme: detectTheme(),
  hapticsEnabled: true,
  sfxEnabled: true,
  route: defaultRoute(),
  grid: {
    filters: defaultFilters(),
    prefs: defaultPrefs(),
    scrollYByKey: {},
  },
  sheets: [],
  toasts: [],
  motion: {
    reduceMotion: prefersReducedMotion(),
    confettiArmed: true,
  },
});

/** Runtime decode (lenient, safe, no-throw). */
const decodeRoute = (v: unknown): PersistResult<SigilMarketsRoute> => {
  if (!isRecord(v)) return { ok: false, error: "route: not an object" };
  const view = v["view"];
  if (!isSigilMarketsView(view)) return { ok: false, error: "route: bad view" };

  if (view === "grid") return { ok: true, value: { view: "grid" } };

  if (view === "market") {
    const marketId = v["marketId"];
    if (!isString(marketId) || marketId.length === 0) return { ok: false, error: "route.market: bad marketId" };
    return { ok: true, value: { view: "market", marketId: asMarketId(marketId) } };
  }

  if (view === "vault") {
    const vaultId = v["vaultId"];
    if (!isString(vaultId) || vaultId.length === 0) return { ok: false, error: "route.vault: bad vaultId" };
    return { ok: true, value: { view: "vault", vaultId: asVaultId(vaultId) } };
  }

  if (view === "positions") return { ok: true, value: { view: "positions" } };

  if (view === "position") {
    const positionId = v["positionId"];
    if (!isString(positionId) || positionId.length === 0) return { ok: false, error: "route.position: bad id" };
    return { ok: true, value: { view: "position", positionId: asPositionId(positionId) } };
  }

  if (view === "prophecy") return { ok: true, value: { view: "prophecy" } };

  if (view === "resolution") {
    const marketId = v["marketId"];
    if (!isString(marketId) || marketId.length === 0) return { ok: false, error: "route.resolution: bad marketId" };
    return { ok: true, value: { view: "resolution", marketId: asMarketId(marketId) } };
  }

  // exhaustive
  return { ok: false, error: "route: unsupported" };
};

const decodeFilters = (v: unknown): PersistResult<MarketGridFilters> => {
  if (!isRecord(v)) return { ok: false, error: "filters: not an object" };
  const query = isString(v["query"]) ? v["query"] : "";
  const includeResolved = isBoolean(v["includeResolved"]) ? v["includeResolved"] : false;

  const categoriesRaw = v["categories"];
  const categories: string[] = Array.isArray(categoriesRaw)
    ? categoriesRaw.filter((x): x is string => isString(x) && x.length > 0)
    : [];

  const closeWithinPulsesRaw = v["closeWithinPulses"];
  const closeWithinPulses =
    typeof closeWithinPulsesRaw === "number" && Number.isFinite(closeWithinPulsesRaw) && closeWithinPulsesRaw > 0
      ? clampInt(closeWithinPulsesRaw, 1, 1_000_000_000)
      : undefined;

  const tagsRaw = v["tags"];
  const tags: string[] | undefined = Array.isArray(tagsRaw)
    ? tagsRaw.filter((x): x is string => isString(x) && x.length > 0)
    : undefined;

  return {
    ok: true,
    value: {
      query,
      categories,
      includeResolved,
      closeWithinPulses,
      tags,
    },
  };
};

const decodePrefs = (v: unknown): PersistResult<MarketGridPrefs> => {
  if (!isRecord(v)) return { ok: false, error: "prefs: not an object" };
  const sort = isMarketSort(v["sort"]) ? v["sort"] : "trending";
  const layout = v["layout"] === "list" ? "list" : "honeycomb";
  const showSparklines = isBoolean(v["showSparklines"]) ? v["showSparklines"] : true;
  return { ok: true, value: { sort, layout, showSparklines } };
};

const decodeSheetPayload = (v: unknown): PersistResult<SheetPayload> => {
  if (!isRecord(v)) return { ok: false, error: "sheet: not an object" };
  const id = v["id"];
  if (!isSheetId(id)) return { ok: false, error: "sheet: bad id" };

  // Build each sheet payload with minimal validation.
  if (id === "inhale-glyph") {
    const reason = v["reason"];
    const marketId = v["marketId"];
    const okReason = reason === "auth" || reason === "trade" || reason === "vault";
    return {
      ok: true,
      value: {
        id,
        reason: okReason ? reason : "auth",
        marketId: isString(marketId) && marketId.length > 0 ? asMarketId(marketId) : undefined,
      },
    };
  }

  if (id === "lock-confirm") {
    const marketId = v["marketId"];
    const side = v["side"];
    const stakeMicroStr = v["stakeMicroStr"];
    if (!isString(marketId) || marketId.length === 0) return { ok: false, error: "lock-confirm: marketId" };
    if (side !== "YES" && side !== "NO") return { ok: false, error: "lock-confirm: side" };
    if (!isString(stakeMicroStr) || stakeMicroStr.length === 0) return { ok: false, error: "lock-confirm: stake" };
    return { ok: true, value: { id, marketId: asMarketId(marketId), side, stakeMicroStr } };
  }

  if (id === "mint-position" || id === "claim" || id === "export-position" || id === "transfer-position") {
    const positionId = v["positionId"];
    if (!isString(positionId) || positionId.length === 0) return { ok: false, error: `${id}: positionId` };
    return { ok: true, value: { id, positionId: asPositionId(positionId) } as SheetPayload };
  }

  if (id === "deposit-withdraw") {
    const vaultId = v["vaultId"];
    const mode = v["mode"];
    if (!isString(vaultId) || vaultId.length === 0) return { ok: false, error: "deposit-withdraw: vaultId" };
    const m = mode === "deposit" || mode === "withdraw" ? mode : undefined;
    return { ok: true, value: { id, vaultId: asVaultId(vaultId), mode: m } };
  }

  if (id === "seal-prediction") {
    const marketId = v["marketId"];
    const parsedMarketId =
      isString(marketId) && marketId.length > 0 ? asMarketId(marketId) : undefined;
    return { ok: true, value: { id, marketId: parsedMarketId } as SheetPayload };
  }

  if (id === "dispute") {
    const marketId = v["marketId"];
    if (!isString(marketId) || marketId.length === 0) return { ok: false, error: `${id}: marketId` };
    return { ok: true, value: { id, marketId: asMarketId(marketId) } as SheetPayload };
  }

  if (id === "share-sigil") {
    const kind = v["kind"];
    const refId = v["refId"];
    const okKind = kind === "position" || kind === "resolution" || kind === "vault";
    if (!okKind) return { ok: false, error: "share-sigil: kind" };
    if (!isString(refId) || refId.length === 0) return { ok: false, error: "share-sigil: refId" };
    return { ok: true, value: { id, kind, refId } };
  }

  return { ok: false, error: "sheet: unsupported" };
};

const decodeSheetStackItem = (v: unknown): PersistResult<SheetStackItem> => {
  if (!isRecord(v)) return { ok: false, error: "sheetItem: not an object" };
  const payload = decodeSheetPayload(v["payload"]);
  if (!payload.ok) return { ok: false, error: payload.error };
  const openedAtMs = isNumber(v["openedAtMs"]) ? v["openedAtMs"] : nowMs();
  return { ok: true, value: { payload: payload.value, openedAtMs } };
};

const decodeToast = (v: unknown): PersistResult<ToastModel> => {
  if (!isRecord(v)) return { ok: false, error: "toast: not an object" };
  const id = v["id"];
  const kind = v["kind"];
  const title = v["title"];
  const message = v["message"];
  const atPulse = v["atPulse"];
  const ttlMs = v["ttlMs"];

  const okKind: ToastKind = kind === "success" || kind === "warning" || kind === "error" ? kind : "info";

  if (!isString(id) || id.length === 0) return { ok: false, error: "toast: id" };
  if (!isString(title) || title.length === 0) return { ok: false, error: "toast: title" };

  return {
    ok: true,
    value: {
      id: asToastId(id),
      kind: okKind,
      title,
      message: isString(message) ? message : undefined,
      atPulse: isNumber(atPulse) ? (Math.floor(atPulse) as KaiPulse) : undefined,
      ttlMs: isNumber(ttlMs) ? ttlMs : undefined,
    },
  };
};

const decodeUiState: Decoder<SigilMarketsUiState> = (v: unknown) => {
  if (!isRecord(v)) return { ok: false, error: "ui: not an object" };

  const themeRaw = v["theme"];
  const theme: SigilMarketsTheme =
    themeRaw === "dark" || themeRaw === "light" || themeRaw === "auto" ? themeRaw : "auto";

  const hapticsEnabled = isBoolean(v["hapticsEnabled"]) ? v["hapticsEnabled"] : true;
  const sfxEnabled = isBoolean(v["sfxEnabled"]) ? v["sfxEnabled"] : true;

  const routeRes = decodeRoute(v["route"]);
  const route = routeRes.ok ? routeRes.value : defaultRoute();

  const gridRaw = v["grid"];
  const grid = isRecord(gridRaw) ? gridRaw : {};
  const filtersRes = decodeFilters(grid["filters"]);
  const prefsRes = decodePrefs(grid["prefs"]);
  const scrollRaw = grid["scrollYByKey"];
  const scrollYByKey: Record<string, number> = {};
  if (isRecord(scrollRaw)) {
    for (const [k, vv] of Object.entries(scrollRaw)) {
      if (isNumber(vv)) scrollYByKey[k] = Math.max(0, Math.floor(vv));
    }
  }

  const sheetsRaw = v["sheets"];
  const sheets: SheetStackItem[] = [];
  if (Array.isArray(sheetsRaw)) {
    for (const item of sheetsRaw) {
      const di = decodeSheetStackItem(item);
      if (di.ok) sheets.push(di.value);
    }
  }

  const toastsRaw = v["toasts"];
  const toasts: ToastModel[] = [];
  if (Array.isArray(toastsRaw)) {
    for (const t of toastsRaw) {
      const dt = decodeToast(t);
      if (dt.ok) toasts.push(dt.value);
    }
  }

  const motionRaw = v["motion"];
  const motion = isRecord(motionRaw) ? motionRaw : {};
  const reduceMotion = isBoolean(motion["reduceMotion"]) ? motion["reduceMotion"] : prefersReducedMotion();
  const confettiArmed = isBoolean(motion["confettiArmed"]) ? motion["confettiArmed"] : true;

  return {
    ok: true,
    value: {
      theme,
      hapticsEnabled,
      sfxEnabled,
      route,
      grid: {
        filters: filtersRes.ok ? filtersRes.value : defaultFilters(),
        prefs: prefsRes.ok ? prefsRes.value : defaultPrefs(),
        scrollYByKey,
      },
      sheets,
      toasts,
      motion: { reduceMotion, confettiArmed },
    },
  };
};

const UI_ENVELOPE_VERSION = 1;

const loadUiState = (storage: StorageLike | null): SigilMarketsUiState => {
  const res = loadFromStorage(
    SM_UI_STATE_KEY,
    (raw) => decodeEnvelope(raw, UI_ENVELOPE_VERSION, decodeUiState),
    storage,
  );
  if (!res.ok || res.value === null) return defaultUiState();

  const env = res.value;
  // env is {data, savedAtMs}, but we only store the data as uiState
  return env.data;
};

const saveUiState = (storage: StorageLike | null, state: SigilMarketsUiState): void => {
  // Wrap into an envelope so we can evolve later without breaking.
  const env = wrapEnvelope(state as unknown as JsonValue, UI_ENVELOPE_VERSION);
  saveToStorage(SM_UI_STATE_KEY, env, storage);
};

export type SigilMarketsUiActions = Readonly<{
  /** Routing */
  navigate: (route: SigilMarketsRoute) => void;
  openMarket: (marketId: MarketId) => void;
  openVault: (vaultId: VaultId) => void;
  openPosition: (positionId: PositionId) => void;
  backToGrid: () => void;

  /** Sheets */
  pushSheet: (payload: SheetPayload) => void;
  popSheet: () => void;
  clearSheets: () => void;

  /** Grid */
  setGridQuery: (query: string) => void;
  setGridSort: (sort: MarketGridPrefs["sort"]) => void;
  setGridLayout: (layout: MarketGridPrefs["layout"]) => void;
  toggleSparklines: () => void;
  toggleIncludeResolved: () => void;
  setCategories: (categories: readonly string[]) => void;
  setCloseWithinPulses: (pulses?: number) => void;
  setScrollY: (route: SigilMarketsRoute, y: number) => void;

  /** Toggles */
  setTheme: (theme: SigilMarketsTheme) => void;
  toggleHaptics: () => void;
  toggleSfx: () => void;
  setReduceMotion: (reduce: boolean) => void;
  armConfetti: (armed: boolean) => void;

  /** Toasts */
  toast: (
    kind: ToastKind,
    title: string,
    message?: string,
    opts?: Readonly<{ ttlMs?: number; atPulse?: KaiPulse }>,
  ) => void;
  dismissToast: (id: ToastModel["id"]) => void;
  clearToasts: () => void;

  /** Reset */
  resetUi: () => void;
  clearPersistedUi: () => void;
}>;

export type SigilMarketsUiStore = Readonly<{
  state: SigilMarketsUiState;
  actions: SigilMarketsUiActions;
}>;

const SigilMarketsUiContext = createContext<SigilMarketsUiStore | null>(null);

export const SigilMarketsUiProvider = (props: Readonly<{ children: React.ReactNode }>) => {
  const storage = useMemo(() => getDefaultStorage(), []);
  const [state, setState] = useState<SigilMarketsUiState>(() => loadUiState(storage));

  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPersistedJsonRef = useRef<string>("");

  useEffect(() => {
    return () => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
    };
  }, []);

  const schedulePersist = useCallback(
    (next: SigilMarketsUiState) => {
      if (!storage) return;

      // Debounce saves to avoid spamming during scroll.
      if (persistTimer.current) clearTimeout(persistTimer.current);

      persistTimer.current = setTimeout(() => {
        // Avoid redundant writes by tracking last JSON.
        const json = JSON.stringify(next);
        if (json === lastPersistedJsonRef.current) return;
        lastPersistedJsonRef.current = json;
        saveUiState(storage, next);
      }, 250);
    },
    [storage],
  );

  const setAndPersist = useCallback(
    (updater: (prev: SigilMarketsUiState) => SigilMarketsUiState) => {
      setState((prev) => {
        const next = updater(prev);
        schedulePersist(next);
        return next;
      });
    },
    [schedulePersist],
  );

  // Cross-tab sync
  useEffect(() => {
    if (!storage || typeof window === "undefined") return;

    const onStorage = (e: StorageEvent): void => {
      if (e.key !== SM_UI_STATE_KEY) return;
      if (e.newValue === null) return;

      try {
        const parsed = JSON.parse(e.newValue) as unknown;
        const env = decodeEnvelope(parsed, UI_ENVELOPE_VERSION, decodeUiState);
        if (!env.ok) return;
        setState(env.value.data);
      } catch {
        // Ignore malformed storage events
      }
    };

    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [storage]);

  const actions: SigilMarketsUiActions = useMemo(() => {
    const navigate = (route: SigilMarketsRoute): void => {
      setAndPersist((s) => ({ ...s, route }));
    };

    const openMarket = (marketId: MarketId): void => navigate({ view: "market", marketId });
    const openVault = (vaultId: VaultId): void => navigate({ view: "vault", vaultId });
    const openPosition = (positionId: PositionId): void => navigate({ view: "position", positionId });
    const backToGrid = (): void => navigate({ view: "grid" });

    const pushSheet = (payload: SheetPayload): void => {
      setAndPersist((s) => ({
        ...s,
        sheets: [...s.sheets, { payload, openedAtMs: nowMs() }],
      }));
    };

    const popSheet = (): void => {
      setAndPersist((s) => ({
        ...s,
        sheets: s.sheets.length > 0 ? s.sheets.slice(0, -1) : s.sheets,
      }));
    };

    const clearSheets = (): void => {
      setAndPersist((s) => ({ ...s, sheets: [] }));
    };

    const setGridQuery = (query: string): void => {
      setAndPersist((s) => ({
        ...s,
        grid: { ...s.grid, filters: { ...s.grid.filters, query } },
      }));
    };

    const setGridSort = (sort: MarketGridPrefs["sort"]): void => {
      setAndPersist((s) => ({
        ...s,
        grid: { ...s.grid, prefs: { ...s.grid.prefs, sort } },
      }));
    };

    const setGridLayout = (layout: MarketGridPrefs["layout"]): void => {
      setAndPersist((s) => ({
        ...s,
        grid: { ...s.grid, prefs: { ...s.grid.prefs, layout } },
      }));
    };

    const toggleSparklines = (): void => {
      setAndPersist((s) => ({
        ...s,
        grid: { ...s.grid, prefs: { ...s.grid.prefs, showSparklines: !s.grid.prefs.showSparklines } },
      }));
    };

    const toggleIncludeResolved = (): void => {
      setAndPersist((s) => ({
        ...s,
        grid: { ...s.grid, filters: { ...s.grid.filters, includeResolved: !s.grid.filters.includeResolved } },
      }));
    };

    const setCategories = (categories: readonly string[]): void => {
      setAndPersist((s) => ({
        ...s,
        grid: { ...s.grid, filters: { ...s.grid.filters, categories: [...categories] } },
      }));
    };

    const setCloseWithinPulses = (pulses?: number): void => {
      const v =
        typeof pulses === "number" && Number.isFinite(pulses) && pulses > 0
          ? clampInt(pulses, 1, 1_000_000_000)
          : undefined;
      setAndPersist((s) => ({
        ...s,
        grid: { ...s.grid, filters: { ...s.grid.filters, closeWithinPulses: v } },
      }));
    };

    const setScrollY = (route: SigilMarketsRoute, y: number): void => {
      const key = routeKey(route);
      const yy = Math.max(0, Math.floor(y));
      setAndPersist((s) => ({
        ...s,
        grid: { ...s.grid, scrollYByKey: { ...s.grid.scrollYByKey, [key]: yy } },
      }));
    };

    const setTheme = (theme: SigilMarketsTheme): void => {
      setAndPersist((s) => ({ ...s, theme }));
    };

    const toggleHaptics = (): void => setAndPersist((s) => ({ ...s, hapticsEnabled: !s.hapticsEnabled }));
    const toggleSfx = (): void => setAndPersist((s) => ({ ...s, sfxEnabled: !s.sfxEnabled }));
    const setReduceMotion = (reduce: boolean): void =>
      setAndPersist((s) => ({ ...s, motion: { ...s.motion, reduceMotion: reduce } }));
    const armConfetti = (armed: boolean): void =>
      setAndPersist((s) => ({ ...s, motion: { ...s.motion, confettiArmed: armed } }));

    const toast = (
      kind: ToastKind,
      title: string,
      message?: string,
      opts?: Readonly<{ ttlMs?: number; atPulse?: KaiPulse }>,
    ): void => {
      const id = asToastId(genToastId());
      const ttlMs =
        typeof opts?.ttlMs === "number" && Number.isFinite(opts.ttlMs) ? Math.max(500, Math.floor(opts.ttlMs)) : 2600;
      const atPulse =
        typeof opts?.atPulse === "number" && Number.isFinite(opts.atPulse) ? (Math.floor(opts.atPulse) as KaiPulse) : undefined;

      setAndPersist((s) => ({
        ...s,
        toasts: [...s.toasts, { id, kind, title, message, ttlMs, atPulse }],
      }));

      // Auto-dismiss: UI-only timer, safe even if tab sleeps.
      if (typeof window !== "undefined") {
        window.setTimeout(() => {
          setAndPersist((s) => ({ ...s, toasts: s.toasts.filter((t) => t.id !== id) }));
        }, ttlMs);
      }
    };

    const dismissToast = (id: ToastModel["id"]): void => {
      setAndPersist((s) => ({ ...s, toasts: s.toasts.filter((t) => t.id !== id) }));
    };

    const clearToasts = (): void => setAndPersist((s) => ({ ...s, toasts: [] }));

    const resetUi = (): void => {
      const fresh = defaultUiState();
      setState(fresh);
      schedulePersist(fresh);
    };

    const clearPersistedUi = (): void => {
      removeFromStorage(SM_UI_STATE_KEY, storage);
      resetUi();
    };

    return {
      navigate,
      openMarket,
      openVault,
      openPosition,
      backToGrid,

      pushSheet,
      popSheet,
      clearSheets,

      setGridQuery,
      setGridSort,
      setGridLayout,
      toggleSparklines,
      toggleIncludeResolved,
      setCategories,
      setCloseWithinPulses,
      setScrollY,

      setTheme,
      toggleHaptics,
      toggleSfx,
      setReduceMotion,
      armConfetti,

      toast,
      dismissToast,
      clearToasts,

      resetUi,
      clearPersistedUi,
    };
  }, [schedulePersist, setAndPersist, storage]);

  const store = useMemo<SigilMarketsUiStore>(() => ({ state, actions }), [state, actions]);

  return <SigilMarketsUiContext.Provider value={store}>{props.children}</SigilMarketsUiContext.Provider>;
};

export const useSigilMarketsUi = (): SigilMarketsUiStore => {
  const ctx = React.useContext(SigilMarketsUiContext);
  if (!ctx) {
    // Fail fast: this module must be wrapped in SigilMarketsUiProvider.
    throw new Error("useSigilMarketsUi must be used within <SigilMarketsUiProvider>");
  }
  return ctx;
};

/** Convenience selectors */
export const useSigilMarketsRoute = (): SigilMarketsRoute => useSigilMarketsUi().state.route;
export const useSigilMarketsSheets = (): readonly SheetStackItem[] => useSigilMarketsUi().state.sheets;
export const useSigilMarketsToasts = (): readonly ToastModel[] => useSigilMarketsUi().state.toasts;
