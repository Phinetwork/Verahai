// src/components/session/SessionContext.ts
"use client";

import { createContext } from "react";
import type { SessionContextType } from "./sessionTypes";

export const SessionContext = createContext<SessionContextType | undefined>(
  undefined,
);
