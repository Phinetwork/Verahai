// src/components/KaiVoh/useSigilAuth.ts
"use client";

import { useContext } from "react";
import { SigilAuthContext, type SigilAuthCtx } from "./SigilAuthContext";

export function useSigilAuth(): SigilAuthCtx {
  const ctx = useContext(SigilAuthContext);
  if (!ctx) throw new Error("useSigilAuth must be used inside <SigilAuthProvider>");
  return ctx;
}
