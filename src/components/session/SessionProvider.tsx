// src/components/session/SessionProvider.tsx
"use client";

import { useEffect, useMemo, useState, type ReactNode, type ReactElement } from "react";
import { SessionContext } from "./SessionContext";
import type { SessionContextType, SessionData } from "./sessionTypes";
import {
  SESSION_STORAGE_KEY,
  clearSessionStorage,
  readSessionStorage,
  writeSessionStorage,
} from "./sessionStorage";

interface Props {
  children: ReactNode;
}

export function SessionProvider({ children }: Props): ReactElement {
  const [session, setSessionState] = useState<SessionData | null>(() => readSessionStorage());

  useEffect(() => {
    if (session) {
      writeSessionStorage(session);
    } else {
      clearSessionStorage();
    }
  }, [session]);

  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key === null) return;
      if (event.key !== SESSION_STORAGE_KEY) return;
      setSessionState(readSessionStorage());
    };

    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const value = useMemo<SessionContextType>(
    () => ({
      session,
      setSession: (data: SessionData) => setSessionState(data),
      clearSession: () => setSessionState(null),
    }),
    [session],
  );

  return (
    <SessionContext.Provider value={value}>
      {children}
    </SessionContext.Provider>
  );
}
