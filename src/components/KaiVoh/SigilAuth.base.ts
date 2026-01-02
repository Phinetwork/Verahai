// src/components/KaiVoh/SigilAuth.base.ts
"use client";

import { createContext } from "react";

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
