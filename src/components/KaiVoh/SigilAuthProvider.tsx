// src/components/KaiVoh/SigilAuthProvider.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  SigilAuthContext,
  type SigilAuthCtx,
  type SigilAuthMeta,
  type SigilAuthState,
} from "./SigilAuthContext";

const LS_KEY = "kai.sigilAuth.v1";
const EMPTY: SigilAuthState = { svgText: null, meta: null };

function isSigilAuthMeta(x: unknown): x is SigilAuthMeta {
  if (typeof x !== "object" || x === null) return false;
  const o = x as Record<string, unknown>;

  const req =
    typeof o.pulse === "number" &&
    Number.isFinite(o.pulse) &&
    typeof o.beat === "number" &&
    Number.isFinite(o.beat) &&
    typeof o.stepIndex === "number" &&
    Number.isFinite(o.stepIndex) &&
    typeof o.chakraDay === "string" &&
    typeof o.kaiSignature === "string";

  if (!req) return false;

  const optStr = (v: unknown) => v === undefined || typeof v === "string";
  return optStr(o.userPhiKey) && optStr(o.sigilId) && optStr(o.sigilActionUrl);
}

function isSigilAuthState(x: unknown): x is SigilAuthState {
  if (typeof x !== "object" || x === null) return false;
  const o = x as Record<string, unknown>;

  const svgOk = o.svgText === null || typeof o.svgText === "string";
  const metaOk =
    o.meta === null || (typeof o.meta === "object" && o.meta !== null && isSigilAuthMeta(o.meta));

  return svgOk && metaOk;
}

function readStorage(): SigilAuthState {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return EMPTY;
    const parsed: unknown = JSON.parse(raw);
    return isSigilAuthState(parsed) ? parsed : EMPTY;
  } catch {
    return EMPTY;
  }
}

function writeStorage(next: SigilAuthState): void {
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

function clearStorage(): void {
  try {
    window.localStorage.removeItem(LS_KEY);
  } catch {
    /* ignore */
  }
}

export function SigilAuthProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  // ✅ hydrate in initializer (no setState synchronously in effect body)
  const [auth, setAuthState] = useState<SigilAuthState>(() => readStorage());

  const setAuth = useCallback((svgText: string, meta: SigilAuthMeta) => {
    const next: SigilAuthState = { svgText, meta };
    setAuthState(next);
    if (typeof window !== "undefined") writeStorage(next);
  }, []);

  const clearAuth = useCallback(() => {
    setAuthState(EMPTY);
    if (typeof window !== "undefined") clearStorage();
  }, []);

  // Cross-tab sync: setState happens in event callback (good)
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== LS_KEY) return;
      setAuthState(readStorage());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const value = useMemo<SigilAuthCtx>(
    () => ({ auth, setAuth, clearAuth }),
    [auth, setAuth, clearAuth],
  );

  return <SigilAuthContext.Provider value={value}>{children}</SigilAuthContext.Provider>;
}
