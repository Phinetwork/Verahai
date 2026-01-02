"use client";

import type React from "react";
import { useEffect, useRef, useState } from "react";
import type { FeedPostPayload } from "../../../utils/feedPayload";
import type { KaiMomentStrict } from "../core/types";
import { pad2 } from "../core/utils";
import { expandShortAliasToCanonical } from "../core/alias";
import { useToasts } from "../data/toast/toast";

import { AttachmentGallery } from "../attachments/gallery";
import type { AttachmentManifest } from "../attachments/types";

import "./PayloadBanner.css";

type Props = {
  payload: FeedPostPayload | null;
  payloadKai: KaiMomentStrict | null;
  payloadAttachments: AttachmentManifest | null;
  payloadError: string | null;
  children?: React.ReactNode;
};

/** Type guard for optional `sigilId` without using `any`. */
function hasSigilId(p: FeedPostPayload): p is FeedPostPayload & { sigilId: string } {
  const r = p as unknown as Record<string, unknown>;
  return typeof r.sigilId === "string";
}

function hasSeal(p: FeedPostPayload): boolean {
  const r = p as unknown as Record<string, unknown>;
  return r.seal !== undefined && r.seal !== null;
}

/** Map/pretty-print a source tag (Manual -> Proof of Memory™). */
function prettySource(src: string | undefined): string {
  const s = (src ?? "").trim().toLowerCase();
  if (!s) return "Proof of Memory™";
  if (s === "x") return "From X";
  if (s === "manual") return "Proof of Memory™";
  return s.slice(0, 1).toUpperCase() + s.slice(1);
}

/** Clipboard helpers (toast-sound parity: NO await before toast). */
function tryCopyExecCommand(text: string): boolean {
  if (typeof document === "undefined") return false;

  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "true");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.style.top = "0";
    document.body.appendChild(ta);

    const prevFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ta.focus();
    ta.select();

    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    if (prevFocus) prevFocus.focus();

    return ok;
  } catch {
    return false;
  }
}

function clipboardWriteTextPromise(text: string): Promise<void> | null {
  if (typeof window === "undefined") return null;
  const nav = window.navigator;
  const canClipboard =
    typeof nav !== "undefined" &&
    typeof nav.clipboard !== "undefined" &&
    typeof nav.clipboard.writeText === "function" &&
    window.isSecureContext;

  if (!canClipboard) return null;
  return nav.clipboard.writeText(text);
}

/** Kai label display helpers (fallback if payloadKai is null). */
const WEEKDAYS: readonly string[] = ["Solhara", "Aquaris", "Flamora", "Verdari", "Sonari", "Kaelith"] as const;
const CHAKRA_DAYS: readonly string[] = [
  "Root",
  "Sacral",
  "Solar Plexus",
  "Heart",
  "Throat",
  "Third Eye",
  "Crown",
] as const;

function safeModulo(n: number, m: number): number {
  const r = n % m;
  return r < 0 ? r + m : r;
}

function pulseToBeatStep(pulse: number): { beat: number; stepIndex: number } {
  const PULSES_PER_STEP = 11;
  const STEPS_PER_BEAT = 44;
  const BEATS_PER_DAY = 36;
  const GRID_PULSES_PER_DAY = PULSES_PER_STEP * STEPS_PER_BEAT * BEATS_PER_DAY; // 17424
  const PULSES_PER_BEAT = PULSES_PER_STEP * STEPS_PER_BEAT; // 484

  const gp = safeModulo(pulse, GRID_PULSES_PER_DAY);
  const beat = Math.floor(gp / PULSES_PER_BEAT);
  const stepIndex = Math.floor((gp % PULSES_PER_BEAT) / PULSES_PER_STEP);
  return { beat, stepIndex };
}

function pulseToWeekday(pulse: number): string {
  const GRID_PULSES_PER_DAY = 17424;
  const day = Math.floor(pulse / GRID_PULSES_PER_DAY);
  return WEEKDAYS[safeModulo(day, WEEKDAYS.length)] ?? "Kaelith";
}

function stepIndexToChakraDay(stepIndex: number): string {
  const STEPS_PER_BEAT = 44;
  const idx = Math.min(
    CHAKRA_DAYS.length - 1,
    Math.max(0, Math.floor((stepIndex / STEPS_PER_BEAT) * CHAKRA_DAYS.length)),
  );
  return CHAKRA_DAYS[idx] ?? "Crown";
}

function chakraDisplayLabel(chakraDay: string): string {
  return /^crown$/i.test(chakraDay) ? "Krown" : chakraDay;
}

function kaiLabelFromStrict(k: KaiMomentStrict): string {
  const beat = pad2(k.beat);
  const step = pad2(k.stepIndex);
  const chakra = chakraDisplayLabel(String(k.chakraDay));
  return `Kairos ${beat}:${step} — ${k.weekday} • ${chakra}`;
}

function kaiLabelFromPulse(pulse: number): string {
  const { beat, stepIndex } = pulseToBeatStep(pulse);
  const weekday = pulseToWeekday(pulse);
  const chakraDay = chakraDisplayLabel(stepIndexToChakraDay(stepIndex));
  return `Kairos ${pad2(beat)}:${pad2(stepIndex)} — ${weekday} • ${chakraDay}`;
}

export function PayloadBanner({
  payload,
  payloadKai,
  payloadAttachments,
  payloadError,
  children,
}: Props): React.JSX.Element | null {
  const toasts = useToasts();
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  if (payloadError && !payload) {
    return (
      <div className="sf-error" role="alert">
        {payloadError}
      </div>
    );
  }
  if (!payload) return null;

  const srcLabel = prettySource(payload.source);
  const kaiText =
    payloadKai ? kaiLabelFromStrict(payloadKai) : typeof payload.pulse === "number" ? kaiLabelFromPulse(payload.pulse) : null;

  return (
    <div className="sf-payload" role="region" aria-label="Current payload">
      {/* Pills row */}
      <div className="sf-payload-line">
        <span className="sf-pill sf-pill--source">{srcLabel}</span>

        {hasSeal(payload) && (
          <span className="sf-pill sf-pill--sealed" title="Private (Sealed)">
            🔒 SEALED
          </span>
        )}

        {payload.author && <span className="sf-pill sf-pill--author">{payload.author}</span>}

        {hasSigilId(payload) && (
          <span className="sf-pill sf-pill--sigil">
            Sigil-Glyph {payload.sigilId}
          </span>
        )}

        {payload.phiKey && <span className="sf-pill sf-pill--phikey">ΦKey {payload.phiKey}</span>}
      </div>

      {/* Core row: pulse + Kai label + optional caption */}
      <div className="sf-payload-core">
        <span className="sf-pulse">
          <span className="sf-pulse__k">Pulse</span>
          <span className="sf-pulse__v">{payload.pulse}</span>
        </span>

        {kaiText && <span className="sf-kai-label"> • {kaiText}</span>}

        {payload.caption && <span className="sf-caption"> — “{payload.caption}”</span>}
      </div>

      {/* Remember (canonical link) */}
      <div className="sf-actions">
        <button
          className="sf-btn"
          type="button"
          onClick={() => {
            try {
              const url = typeof window !== "undefined" ? window.location.href : "";
              const canonical = expandShortAliasToCanonical(url);

              const okSync = tryCopyExecCommand(canonical);
              if (okSync) {
                setCopied(true);
                if (timerRef.current !== null) window.clearTimeout(timerRef.current);
                timerRef.current = window.setTimeout(() => setCopied(false), 1200);
                toasts.push("success", "Remembered");
                return;
              }

              const p = clipboardWriteTextPromise(canonical);
              if (p) {
                setCopied(true);
                if (timerRef.current !== null) window.clearTimeout(timerRef.current);
                timerRef.current = window.setTimeout(() => setCopied(false), 1200);

                toasts.push("success", "Remembered");

                p.catch(() => {
                  setCopied(false);
                  toasts.push("warn", "Remember failed. Select the address bar.");
                });
                return;
              }

              toasts.push("warn", "Remember failed. Select the address bar.");
            } catch {
              toasts.push("warn", "Remember failed. Select the address bar.");
            }
          }}
        >
          <span className="sf-btn__glow" aria-hidden="true" />
          <span className="sf-btn__text">{copied ? "Remembered" : "Remember"}</span>
        </button>
      </div>

      {/* Injected sealed gate + body UI from SigilStreamRoot */}
      {children ? <div className="sf-payload-children">{children}</div> : null}

      {/* Attachments (existing, from payload) */}
      {payloadAttachments ? (
        <div className="sf-attachments-wrap">
          <AttachmentGallery manifest={payloadAttachments} />
        </div>
      ) : null}
    </div>
  );
}

export default PayloadBanner;
