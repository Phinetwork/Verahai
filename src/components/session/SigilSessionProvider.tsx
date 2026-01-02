// src/session/SigilSessionProvider.tsx
"use client";

import { useState, useMemo, useCallback } from "react";
import type { CtxShape, SigilSessionData } from "./SigilSessionTypes";
import { SigilSessionContext } from "./SigilSessionContext";
import { unpackCapsuleParam } from "../../utils/sigilCapsule";

function isNum(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

export function SigilSessionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [session, setSession] = useState<SigilSessionData | null>(null);

  const login = useCallback((url: string): boolean => {
    try {
      const u = new URL(url, typeof window !== "undefined" ? window.location.origin : "https://example.org");
      const parts = u.pathname.split("/").filter(Boolean);
      if (parts[0] !== "s" || parts.length < 2) return false;

      const appId = parts[1];
      const meta = unpackCapsuleParam(u.searchParams.get("p"));
      if (!meta) return false;

      const { userPhiKey, kaiSignature, pulse, beat, stepIndex, expiresAtPulse, canonicalHash } = meta;

      if (!userPhiKey || !kaiSignature) return false;
      if (!isNum(pulse) || !isNum(beat) || !isNum(stepIndex)) return false;
      if (canonicalHash && canonicalHash !== appId) return false;

      setSession({
        appId,
        userGlyphUrl: url,
        userPhiKey,
        kaiSignature,
        pulse,
        beat,
        stepIndex,
        expiresAtPulse,
      });

      return true;
    } catch {
      return false;
    }
  }, []);

  const logout = useCallback(() => setSession(null), []);

  const value = useMemo<CtxShape>(() => ({ session, login, logout }), [
    session,
    login,
    logout,
  ]);

  return (
    <SigilSessionContext.Provider value={value}>
      {children}
    </SigilSessionContext.Provider>
  );
}
