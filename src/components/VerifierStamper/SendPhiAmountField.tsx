// src/components/VerifierStamper/SendPhiAmountField.tsx
import React, { useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import "./SendPhiAmountField.css";

export type Props = {
  amountMode: "USD" | "PHI";
  setAmountMode: Dispatch<SetStateAction<"USD" | "PHI">>;

  usdInput: string;
  phiInput: string;
  setUsdInput: Dispatch<SetStateAction<string>>;
  setPhiInput: Dispatch<SetStateAction<string>>;

  convDisplayRight: string;
  remainingPhiDisplay4: string;
  canonicalContext: "parent" | "derivative" | null;

  /** Optional compact formatter (kept for compat; not used while typing). */
  phiFormatter?: (s: string) => string;

  /** Optional attachment control (sits in-line with the segment buttons). */
  onAttachClick?: () => void;
  attachmentLabel?: string;
  attachmentActive?: boolean;
};

/* Input guards (leading dot allowed, graceful while typing) */
const DEC4 = /^\d*(?:\.\d{0,4})?$/;
const USD2 = /^\d*(?:\.\d{0,2})?$/;

/** Tasteful, official, ephemeral toast that never shifts the footer */
const ErrorToast: React.FC<{ msg: string | null }> = ({ msg }) => {
  if (!msg) return null;
  return (
    <div className="phi-error-toast" role="status" aria-live="polite">
      <div className="phi-error-card">
        <span className="badge">OFFICIAL</span>
        <p className="phi-error-text">{msg}</p>
      </div>
    </div>
  );
};

type PhiMoveMode = "send" | "receive";

type PhiMoveSuccessDetail = {
  mode: PhiMoveMode;
  amountPhiDisplay?: string;
  amountDisplay?: string;
  amountPhi?: number;
  downloadUrl?: string;
  downloadLabel?: string;
  message?: string;
};

type PhiMoveSuccessState = {
  mode: PhiMoveMode;
  amountDisplay?: string;
  downloadUrl?: string;
  downloadLabel?: string;
  message?: string;
};

/** Double-tap heartbeat haptic for important Φ moves */
const HEARTBEAT_PATTERN: number[] = [26, 70, 38];

const triggerHeartbeatHaptic = (): void => {
  if (typeof window === "undefined") return;

  const nav = window.navigator as Navigator & {
    vibrate?: (pattern: number | number[]) => boolean;
  };

  if (typeof nav.vibrate !== "function") return;

  try {
    nav.vibrate(HEARTBEAT_PATTERN);
  } catch {
    // noop — haptics are best-effort only
  }
};

/** Success overlay: Φ movement sealed + fancy download CTA */
const PhiMoveSuccessPopup: React.FC<{
  state: PhiMoveSuccessState;
  onClose: () => void;
}> = ({ state, onClose }) => {
  const title =
    state.mode === "receive" ? "Φ Inhale Complete" : "Φ Exhale Complete";
  const pill = state.mode === "receive" ? "RECEIVED" : "SENT";
  const body =
    state.message ??
    (state.mode === "receive"
      ? "You just inhaled Φ into your Sovereign field. This moment is sealed."
      : "You just exhaled Φ from your Sovereign field. This moment is sealed.");

  return (
    <div
      className="phi-send-success-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Φ move complete"
      onClick={onClose}
    >
      <div
        className="phi-send-success-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="phi-success-orb" aria-hidden="true">
          <div className="phi-success-orb-inner" />
        </div>

        <div className="phi-success-header">
          <span className="phi-success-pill">{pill}</span>
          <button
            type="button"
            className="phi-success-close"
            onClick={onClose}
            aria-label="Close confirmation"
          >
            ✕
          </button>
        </div>

        <h2 className="phi-success-title">{title}</h2>

        {state.amountDisplay && (
          <p className="phi-success-amount">
            <span className="mono">{state.amountDisplay}</span>
          </p>
        )}

        <p className="phi-success-body">{body}</p>

        {state.downloadUrl && (
          <a
            className="phi-send-success-download"
            href={state.downloadUrl}
            download={state.downloadLabel || "phi-receipt"}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span
              className="phi-send-success-download-icon"
              aria-hidden="true"
            >
              ⬇︎
            </span>
            <span className="phi-send-success-download-text">
              Download sealed receipt
            </span>
          </a>
        )}

        <button
          type="button"
          className="phi-success-ok"
          onClick={onClose}
        >
          Done
        </button>
      </div>
    </div>
  );
};

const SendPhiAmountField: React.FC<Props> = ({
  amountMode,
  setAmountMode,
  usdInput,
  phiInput,
  setUsdInput,
  setPhiInput,
  convDisplayRight,
  remainingPhiDisplay4,
  canonicalContext,
  onAttachClick,
  attachmentLabel,
  attachmentActive,
}) => {
  const isChild = canonicalContext === "derivative"; // send-sigil (uploaded) view

  const [toast, setToast] = useState<string | null>(null);
  const [focused, setFocused] = useState<boolean>(false);
  const [success, setSuccess] = useState<PhiMoveSuccessState | null>(null);

  // Ephemeral error toast auto-dismiss
  useEffect(() => {
    if (!toast || isChild) return;
    const id = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(id);
  }, [toast, isChild]);

  // Global success listener for send / receive
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handlePhiMoveSuccess = (event: Event): void => {
      const customEvent = event as CustomEvent<PhiMoveSuccessDetail>;
      const detail = customEvent.detail;

      if (!detail) {
        return;
      }

      const mode: PhiMoveMode =
        detail.mode === "receive" ? "receive" : "send";

      triggerHeartbeatHaptic();

      const amountDisplay =
        detail.amountPhiDisplay ??
        detail.amountDisplay ??
        (typeof detail.amountPhi === "number"
          ? String(detail.amountPhi)
          : undefined);

      setSuccess({
        mode,
        amountDisplay,
        downloadUrl: detail.downloadUrl,
        downloadLabel: detail.downloadLabel,
        message: detail.message,
      });
    };

    window.addEventListener("kk:phi-move-success", handlePhiMoveSuccess);

    return () => {
      window.removeEventListener("kk:phi-move-success", handlePhiMoveSuccess);
    };
  }, []);

  const showError = (m: string): void => {
    setToast(m);
    try {
      window.dispatchEvent(
        new CustomEvent("kk:error", {
          detail: { where: "SendPhiAmountField", error: m },
        })
      );
    } catch {
      /* noop */
    }
  };

  const unitPattern = useMemo(
    () =>
      amountMode === "USD"
        ? "\\d*(?:\\.\\d{0,2})?"
        : "\\d*(?:\\.\\d{0,4})?",
    [amountMode]
  );

  const unitGlyph = amountMode === "USD" ? "$" : "Φ";
  const ariaLabel =
    amountMode === "USD" ? "Dollar amount to exhale" : "Phi amount to exhale";

  const handleChange = (raw: string): void => {
    const v = raw.replace(/\s+/g, "");
    if (amountMode === "USD") {
      if (USD2.test(v)) setUsdInput(v);
    } else {
      if (DEC4.test(v)) setPhiInput(v); // allow ".1" while typing; no forced "0."
    }
  };

  /** Gentle preflight on Enter (Φ is source of truth) */
  const handleKeyDown: React.KeyboardEventHandler<HTMLInputElement> = (e) => {
    if (e.key !== "Enter") return;

    if (amountMode !== "PHI") {
      showError("Enter a Φ amount or switch to Φ to exhale.");
      return;
    }

    const raw = (phiInput || "").trim();
    if (raw === "" || raw === ".") {
      showError("No Φ entered — specify an amount to exhale.");
      return;
    }

    const want = Number((raw.startsWith(".") ? "0" : "") + raw);
    if (!Number.isFinite(want) || want <= 0) {
      showError("Invalid Φ amount — enter a number greater than 0.");
      return;
    }

    const rem = Number(String(remainingPhiDisplay4).replace(/[^\d.]/g, ""));
    if (Number.isFinite(rem) && want > rem + 1e-9) {
      showError(`Exceeds remaining — Rem: Φ ${remainingPhiDisplay4}`);
    }
  };

  const showAttachment = typeof onAttachClick === "function";

  // Child (upload) view: no amount field, but still host toasts / success overlay
  if (isChild) {
    return (
      <>
        <ErrorToast msg={toast} />
        {success && (
          <PhiMoveSuccessPopup
            state={success}
            onClose={() => setSuccess(null)}
          />
        )}
      </>
    );
  }

  return (
    <>
      <div
        className="phi-send-field"
        data-state={focused ? "focus" : "idle"}
      >
        {/* Label up top */}
        <div className="phi-send-label">
          <span className="label-main">Exhale Amount</span>
          <span className="label-sub">
            {amountMode === "USD" ? "Enter in $" : "Enter in Φ"} · 🛕: Φ{" "}
            {remainingPhiDisplay4}
          </span>
        </div>

        {/* SINGLE THIN BAR:
            [ Φ input ] | [ live conversion ] | [ unit toggle + attachment ]
        */}
        <div className="phi-send-bar">
          {/* Left: glass capsule input */}
          <div className="phi-send-inputShell" aria-live="polite">
            <span className="phi-prefix" aria-hidden="true">
              {unitGlyph}
            </span>

            <input
              className="phi-send-input"
              type="text"
              inputMode="decimal"
              pattern={unitPattern}
              aria-label={ariaLabel}
              placeholder={unitGlyph}
              value={amountMode === "USD" ? usdInput : phiInput}
              onChange={(e) => handleChange(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              aria-invalid={toast ? true : undefined}
              autoComplete="off"
              enterKeyHint="send"
            />

            <i aria-hidden="true" className="phi-input-glow" />
          </div>

          {/* Middle: conversion readout */}
          <div
            className="phi-conv-right convert-readout"
            aria-live="polite"
          >
            {convDisplayRight}
          </div>

          {/* Right: unit toggle + optional attachment, aligned as one segment cluster */}
          <div className="phi-send-controls">
            <div
              role="tablist"
              aria-label="Amount unit"
              className="phi-mode-toggle seg"
            >
              <button
                type="button"
                role="tab"
                aria-selected={amountMode === "USD"}
                className={`phi-mode-btn ${
                  amountMode === "USD" ? "is-active" : ""
                }`}
                onClick={() => setAmountMode("USD")}
                title="Enter in dollars"
              >
                $
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={amountMode === "PHI"}
                className={`phi-mode-btn ${
                  amountMode === "PHI" ? "is-active" : ""
                }`}
                onClick={() => setAmountMode("PHI")}
                title="Enter in Φ"
              >
                Φ
              </button>
            </div>

            {showAttachment && (
              <button
                type="button"
                className={`phi-attach-btn ${
                  attachmentActive ? "is-active" : ""
                }`}
                onClick={onAttachClick}
                title={attachmentLabel || "Attach sigil / note"}
              >
                <span className="phi-attach-icon" aria-hidden="true">
                  📎
                </span>
                {attachmentLabel && (
                  <span className="phi-attach-label">
                    {attachmentLabel}
                  </span>
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      <ErrorToast msg={toast} />

      {success && (
        <PhiMoveSuccessPopup
          state={success}
          onClose={() => setSuccess(null)}
        />
      )}
    </>
  );
};

export default SendPhiAmountField;
