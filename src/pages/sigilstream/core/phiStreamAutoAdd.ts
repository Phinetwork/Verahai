// src/pages/sigilstream/core/phiStreamAutoAdd.ts
"use client";

/**
 * PhiStream Auto-Add (Visit → Inhale)
 * - If the user visits a single-post stream view and the payload is valid,
 *   we auto-add the payload URL to the local PhiStream registry IF missing.
 * - Emits a single beautiful toast on first add:
 *     "Φ Memory added to PhiStream."
 *
 * Guarantees:
 * - Never toasts if already present
 * - Never toasts twice in the same session for the same token/url
 * - Survives Safari/private-mode storage edge cases (fails silently, returns reason)
 */

import { LS_KEY, parseStringArray, prependUniqueToStorage } from "../data/storage";
import { registerSigilUrl } from "../../../utils/sigilRegistry";

export type ToastKind = "success" | "warn" | "info";

export type PhiStreamAutoAddResult =
  | { ok: true; added: true; url: string; reason: "added" }
  | { ok: true; added: false; url: string; reason: "already_present" | "already_notified" }
  | { ok: false; added: false; url: null; reason: "no_window" | "no_url" | "invalid_url" | "storage_unavailable" };

const NOTICE_TEXT = "Φ Memory added to PhiStream.";

/** Same safety pattern you already use: long tokens get a stable key. */
export function sessionTokenKey(token: string): string {
  const t = (token || "").trim();
  if (!t) return "root";
  if (t.length <= 140) return t;
  return `${t.slice(0, 96)}:${t.slice(-32)}`;
}

/** Session guard key (prevents double-toast on rerender/navigation churn). */
function notifiedKey(tokenOrKey: string): string {
  return `sf.phistream.autoadd.notified:${sessionTokenKey(tokenOrKey)}`;
}

function canUseWindow(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function safeHttpOrRelativeToAbsolute(input: string): string | null {
  const raw = (input || "").trim();
  if (!raw) return null;
  if (!canUseWindow()) return null;

  try {
    // Allow site-relative internal URLs
    if (raw.startsWith("/")) {
      const origin = window.location?.origin ?? "https://kaiklok.com";
      const u = new URL(raw, origin);
      if (u.protocol === "http:" || u.protocol === "https:") return u.toString();
      return null;
    }

    // Allow full http(s)
    const u = new URL(raw);
    if (u.protocol === "http:" || u.protocol === "https:") return u.toString();
    return null;
  } catch {
    return null;
  }
}

function readRegistry(): string[] {
  // parseStringArray already tolerates null / invalid JSON
  const raw = localStorage.getItem(LS_KEY);
  return parseStringArray(raw);
}

function isAlreadyInRegistry(url: string): boolean {
  try {
    const existing = readRegistry();
    return existing.includes(url);
  } catch {
    // If storage is blocked, act as "unknown"; caller decides behavior.
    return false;
  }
}

function alreadyNotified(token: string): boolean {
  try {
    return sessionStorage.getItem(notifiedKey(token)) === "1";
  } catch {
    return false;
  }
}

function markNotified(token: string): void {
  try {
    sessionStorage.setItem(notifiedKey(token), "1");
  } catch {
    // ignore
  }
}

/**
 * Auto-add the payload URL to PhiStream registry if missing.
 *
 * Call this ONLY when:
 * - you are in a single-post view (token exists)
 * - payload decoded successfully
 *
 * Inputs:
 * - token: the active payload token (any form; we use it for session guard)
 * - payloadUrl: decoded.payload.url (preferred)
 * - fallbackUrl: optional (e.g. preferredShareUrl(token) or canonicalizeCurrentStreamUrl(token))
 * - toast: optional toast emitter (toasts.push)
 */
export function autoAddVisitedPayloadToPhiStream(args: {
  token: string;
  payloadUrl?: string | null;
  fallbackUrl?: string | null;
  toast?: (kind: ToastKind, msg: string) => void;
}): PhiStreamAutoAddResult {
  const { token, payloadUrl, fallbackUrl, toast } = args;

  if (!canUseWindow()) return { ok: false, added: false, url: null, reason: "no_window" };

  const candidateRaw = (payloadUrl && payloadUrl.trim().length ? payloadUrl : fallbackUrl) ?? "";
  if (!candidateRaw.trim()) return { ok: false, added: false, url: null, reason: "no_url" };

  const url = safeHttpOrRelativeToAbsolute(candidateRaw);
  if (!url) return { ok: false, added: false, url: null, reason: "invalid_url" };

  // If already in registry, do nothing.
  // (Still registerSigilUrl defensively so Explorer lineage stays hot.)
  try {
    registerSigilUrl(url);
  } catch {
    // ignore
  }

  // If we already toasted this token in this session, don’t toast again.
  // But we still ensure the URL is present if possible.
  const notified = alreadyNotified(token);

  // Storage access can throw (Safari private mode, blocked policies, etc.)
  try {
    const already = isAlreadyInRegistry(url);
    if (already) {
      return { ok: true, added: false, url, reason: "already_present" };
    }

    // Ensure it’s in local registry (prependUniqueToStorage is deterministic)
    prependUniqueToStorage([url]);

    // Mark session notification only after successful write attempt
    if (!notified) {
      markNotified(token);
      toast?.("success", NOTICE_TEXT);
      return { ok: true, added: true, url, reason: "added" };
    }

    return { ok: true, added: false, url, reason: "already_notified" };
  } catch {
    return { ok: false, added: false, url: null, reason: "storage_unavailable" };
  }
}
