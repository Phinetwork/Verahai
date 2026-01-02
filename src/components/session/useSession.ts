// src/components/session/useSession.ts
"use client";

import { useContext } from "react";
import { SessionContext } from "./SessionContext";
import type { SessionContextType } from "./sessionTypes";

export function useSession(): SessionContextType {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within a SessionProvider");
  return ctx;
}
