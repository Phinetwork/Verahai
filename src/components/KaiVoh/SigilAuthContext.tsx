// src/components/KaiVoh/SigilAuthContext.tsx
"use client";

import { createContext, useContext } from "react";

/** Minimal meta SocialConnector needs (no app secrets, no Chronos). */
export type SigilAuthMeta = {
  pulse: number;
  beat: number;
  stepIndex: number;
  chakraDay: string;
  kaiSignature: string;
  userPhiKey?: string;
  sigilId?: string;
  sigilActionUrl?: string;
};

export type SigilAuthState = {
  svgText: string | null;
  meta: SigilAuthMeta | null;
};

export type SigilAuthCtx = {
  auth: SigilAuthState;
  setAuth: (svgText: string, meta: SigilAuthMeta) => void;
  clearAuth: () => void;
};

export const SigilAuthContext = createContext<SigilAuthCtx | null>(null);

/**
 * Hook to read SigilAuthContext safely.
 * Requires <SigilAuthProvider> somewhere above.
 */
export function useSigilAuth(): SigilAuthCtx {
  const ctx = useContext(SigilAuthContext);
  if (!ctx) {
    throw new Error("useSigilAuth must be used within <SigilAuthProvider>.");
  }
  return ctx;
}

// Optional default export so BOTH import styles work:
export default useSigilAuth;
