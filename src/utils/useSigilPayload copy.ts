// src/utils/useSigilPayload.ts

/**
 * v46 — useSigilPayload.ts
 * -----------------------------------------------------------------------------
 * Purpose
 * -------
 * Small hook that lifts the "load payload from ?p=" concern out of the page.
 * It does not attempt to validate history, debits, or ownership — those concerns
 * live elsewhere. This hook gives you:
 *   - payload: SigilPayload | null
 *   - loading: boolean
 *   - verified: "checking" | "ok" | "notfound" | "error"
 *   - error: string | null
 *   - setPayload: React.Dispatch<React.SetStateAction<SigilPayload | null>>
 *   - setLoading: React.Dispatch<React.SetStateAction<boolean>>
 *
 * Behavior
 * --------
 * - On mount or whenever `search` changes, tries to decode ?p=.
 * - If present and valid => { payload, verified: "ok" }.
 * - If missing => verified: routeHash ? "notfound" : "checking".
 * - If invalid => verified: "error" with message.
 *
 * Integration
 * -----------
 *   const { payload, loading, verified, error, setPayload, setLoading } =
 *     useSigilPayload(location.search, routeHash);
 * -----------------------------------------------------------------------------
 */

import { useCallback, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { SigilPayload } from "../types/sigil";
import { decodePayloadFromQuery } from "./payload";

type VerifyState = "checking" | "ok" | "notfound" | "error";

type UseSigilPayload = {
  payload: SigilPayload | null;
  loading: boolean;
  verified: VerifyState;
  error: string | null;
  setPayload: Dispatch<SetStateAction<SigilPayload | null>>;
  setLoading: Dispatch<SetStateAction<boolean>>;
};

type DerivedState = {
  payload: SigilPayload | null;
  loading: boolean;
  verified: VerifyState;
  error: string | null;
};

type ValueWithKey<T> = {
  key: string;
  value: T;
};

export function useSigilPayload(
  search: string,
  routeHash: string | null = null
): UseSigilPayload {
  /**
   * 1) Purely derived state from URL params (no side effects).
   *    Runs during render via useMemo and never calls setState.
   */
  const derived = useMemo<DerivedState>(() => {
    let payload: SigilPayload | null = null;
    let verified: VerifyState = "checking";
    let error: string | null = null;

    try {
      const decoded = decodePayloadFromQuery(search);

      if (decoded) {
        payload = decoded as SigilPayload;
        verified = "ok";
      } else {
        payload = null;
        verified = routeHash ? "notfound" : "checking";
      }
    } catch (err) {
      payload = null;
      verified = "error";
      error =
        err instanceof Error
          ? err.message
          : "Failed to decode payload";
    }

    // Internal decode is synchronous; by the time we return,
    // we have a final verdict, so loading is false.
    return {
      payload,
      loading: false,
      verified,
      error,
    };
  }, [search, routeHash]);

  /**
   * 2) Optional overrides (payload/loading) keyed by the current `search`.
   *    This lets callers use setPayload / setLoading without fighting
   *    the derived value when the URL changes.
   */

  const [payloadOverride, setPayloadOverride] = useState<
    ValueWithKey<SigilPayload | null> | null
  >(null);

  const [loadingOverride, setLoadingOverride] = useState<
    ValueWithKey<boolean> | null
  >(null);

  const effectivePayload: SigilPayload | null =
    payloadOverride && payloadOverride.key === search
      ? payloadOverride.value
      : derived.payload;

  const effectiveLoading: boolean =
    loadingOverride && loadingOverride.key === search
      ? loadingOverride.value
      : derived.loading;

  /**
   * 3) Exposed setters that *only* update overrides for the current `search`.
   *    No effects, no cascading setState warnings.
   */

  const setPayload: Dispatch<SetStateAction<SigilPayload | null>> =
    useCallback(
      (update) => {
        setPayloadOverride((prev) => {
          const key = search;

          const baseValue =
            prev && prev.key === key
              ? prev.value
              : derived.payload;

          const nextValue =
            typeof update === "function"
              ? (update as (prev: SigilPayload | null) => SigilPayload | null)(
                  baseValue
                )
              : update;

          return { key, value: nextValue };
        });
      },
      [search, derived.payload]
    );

  const setLoading: Dispatch<SetStateAction<boolean>> = useCallback(
    (update) => {
      setLoadingOverride((prev) => {
        const key = search;

        const baseValue =
          prev && prev.key === key
            ? prev.value
            : derived.loading;

        const nextValue =
          typeof update === "function"
            ? (update as (prev: boolean) => boolean)(baseValue)
            : update;

        return { key, value: nextValue };
      });
    },
    [search, derived.loading]
  );

  return {
    payload: effectivePayload,
    loading: effectiveLoading,
    verified: derived.verified,
    error: derived.error,
    setPayload,
    setLoading,
  };
}
