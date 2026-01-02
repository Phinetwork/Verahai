// src/session/SigilSessionContext.ts
"use client";

import { createContext } from "react";
import type { CtxShape } from "./SigilSessionTypes";

export const SigilSessionContext = createContext<CtxShape>({
  session: null,
  login: () => false,
  logout: () => {},
});
