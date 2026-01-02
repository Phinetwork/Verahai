// src/utils/useSigilPayload.ts

/**
 * v47 — useSigilPayload.ts
 * -----------------------------------------------------------------------------
 * Purpose
 * -------
 * Purely derive Sigil payload state from the URL query (?p=) with optional
 * overrides.
 *
 * It exposes:
 *   - payload: SigilPayload | null
 *   - loading: boolean
 *   - verified: "checking" | "ok" | "notfound" | "error"
 *   - error: string | null
 *   - setPayload: override the derived payload
 *   - setLoading: override the derived loading flag
 *
 * Behavior
 * --------
 * - Synchronously decodes ?p= via decodePayloadFromQuery(search).
 * - No effects, no synchronous setState inside effects (React 19 friendly).
 * - If you never call setPayload/setLoading, everything is fully derived
 *   from `search` + `routeHash`.
 * -----------------------------------------------------------------------------
 */

import type * as React from "react";
import { useMemo, useState } from "react";
import type { SigilPayload } from "../types/sigil";
import { decodePayloadFromQuery } from "./payload";

type VerifyState = "checking" | "ok" | "notfound" | "error";

type UseSigilPayload = {
  payload: SigilPayload | null;
  loading: boolean;
  verified: VerifyState;
  error: string | null;
  setPayload: React.Dispatch<React.SetStateAction<SigilPayload | null>>;
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
};

function computeFromQuery(
  search: string,
  routeHash: string | null
): Pick<UseSigilPayload, "payload" | "verified" | "error" | "loading"> {
  try {
    const decoded = decodePayloadFromQuery(search);
    if (decoded) {
      return {
        payload: decoded as SigilPayload,
        verified: "ok",
        error: null,
        loading: false,
      };
    }

    return {
      payload: null,
      verified: routeHash ? "notfound" : "checking",
      error: null,
      loading: false,
    };
  } catch (e) {
    return {
      payload: null,
      verified: "error",
      error:
        e instanceof Error ? e.message : "Failed to decode payload",
      loading: false,
    };
  }
}

export function useSigilPayload(
  search: string,
  routeHash: string | null = null
): UseSigilPayload {
  // Optional overrides that callers can choose to set.
  const [payloadOverride, setPayloadOverride] = useState<
    SigilPayload | null | undefined
  >(undefined);
  const [loadingOverride, setLoadingOverride] = useState<
    boolean | undefined
  >(undefined);

  // Base derived state from the query string.
  const base = useMemo(
    () => computeFromQuery(search, routeHash),
    [search, routeHash]
  );

  // Effective values (override wins if present).
  const payload: SigilPayload | null =
    payloadOverride !== undefined ? payloadOverride : base.payload;

  const loading: boolean =
    loadingOverride !== undefined ? loadingOverride : base.loading;

  // setPayload / setLoading remain fully compatible with the original types.
  const setPayload: UseSigilPayload["setPayload"] = (next) => {
    setPayloadOverride(() => {
      const current = payload;
      if (typeof next === "function") {
        return (next as (value: SigilPayload | null) => SigilPayload | null)(
          current
        );
      }
      return next;
    });
  };

  const setLoading: UseSigilPayload["setLoading"] = (next) => {
    setLoadingOverride(() => {
      const current = loading;
      if (typeof next === "function") {
        return (next as (value: boolean) => boolean)(current);
      }
      return next;
    });
  };

  return {
    payload,
    loading,
    verified: base.verified,
    error: base.error,
    setPayload,
    setLoading,
  };
}
