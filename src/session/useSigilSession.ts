// src/session/useSigilSession.ts
"use client";

import { useContext } from "react";
import { SigilSessionContext } from "./SigilSessionContext";
import type { CtxShape } from "./SigilSessionTypes";

export function useSigilSession(): CtxShape {
  return useContext(SigilSessionContext);
}
