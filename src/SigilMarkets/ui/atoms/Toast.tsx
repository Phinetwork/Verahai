// SigilMarkets/ui/atoms/Toast.tsx
"use client";

import React, { useMemo } from "react";
import { useSigilMarketsToasts, useSigilMarketsUi } from "../../state/uiStore";
import type { ToastKind, ToastModel } from "../../types/uiTypes";

const cx = (...parts: Array<string | false | null | undefined>): string => parts.filter(Boolean).join(" ");

const toneClass = (k: ToastKind): string => {
  switch (k) {
    case "success":
      return "is-success";
    case "warning":
      return "is-warning";
    case "error":
      return "is-error";
    case "info":
    default:
      return "is-info";
  }
};

export type ToastHostProps = Readonly<{
  className?: string;
}>;

export const ToastHost = (props: ToastHostProps) => {
  const toasts = useSigilMarketsToasts();
  const { actions } = useSigilMarketsUi();

  const cls = useMemo(() => cx("sm-toast-host", props.className), [props.className]);

  if (!toasts || toasts.length === 0) return null;

  return (
    <div className={cls} aria-live="polite" aria-relevant="additions">
      {toasts.slice(-3).map((t: ToastModel) => (
        <div
          key={t.id}
          className={cx("sm-toast", toneClass(t.kind))}
          role="status"
          style={{ ["--sm-toast-ttl" as string]: `${t.ttlMs ?? 2600}ms` }}
        >
          <div className="sm-toast-head">
            <div className="sm-toast-title">{t.title}</div>
            <button type="button" className="sm-toast-x" onClick={() => actions.dismissToast(t.id)} aria-label="Dismiss">
              ×
            </button>
          </div>
          {t.message ? <div className="sm-toast-msg">{t.message}</div> : null}
        </div>
      ))}
    </div>
  );
};
