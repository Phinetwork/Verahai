// src/components/session/sessionStorage.ts
"use client";

import type { SessionData } from "./sessionTypes";

export const SESSION_STORAGE_KEY = "kai.voh.session.v1";

function isSessionData(value: unknown): value is SessionData {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;

  if (typeof v.phiKey !== "string" || typeof v.kaiSignature !== "string") return false;
  if (typeof v.pulse !== "number" || !Number.isFinite(v.pulse)) return false;

  if (typeof v.connectedAccounts !== "object" || v.connectedAccounts === null) return false;
  if (!Array.isArray(v.postLedger)) return false;

  const ledgerOk = v.postLedger.every((entry) => {
    if (typeof entry !== "object" || entry === null) return false;
    const e = entry as Record<string, unknown>;
    return typeof e.pulse === "number" && Number.isFinite(e.pulse) && typeof e.platform === "string" && typeof e.link === "string";
  });

  if (!ledgerOk) return false;

  if (v.chakraDay !== undefined && typeof v.chakraDay !== "string") return false;

  return true;
}

export function readSessionStorage(): SessionData | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isSessionData(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeSessionStorage(session: SessionData): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    /* ignore */
  }
}

export function clearSessionStorage(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
