import React from "react";
import useAutoShrink from "./hooks/useAutoShrink";
import { S } from "./styles";

export const KV: React.FC<{ k: React.ReactNode; v: React.ReactNode; wide?: boolean; mono?: boolean }> = ({
  k,
  v,
  wide,
  mono,
}) => (
  <div className={`kv${wide ? " wide" : ""}`}>
    <span className="k">{k}</span>
    <span className={`v${mono ? " mono" : ""}`} style={mono ? S.mono : undefined}>
      {v}
    </span>
  </div>
);

export const ValueChip: React.FC<{
  kind: "phi" | "usd";
  trend: "up" | "down" | "flat";
  flash: boolean;
  title: string;
  children: React.ReactNode;
  onClick?: () => void;
  ariaLabel?: string;
}> = ({ kind, trend, flash, title, children, onClick, ariaLabel }) => {
  const { boxRef, textRef, scale } = useAutoShrink<HTMLSpanElement>([children, trend, flash], 16, 0.65);

  const clickable = typeof onClick === "function";
  const clickableStyle: React.CSSProperties | undefined = clickable
    ? { cursor: "pointer", userSelect: "none" }
    : undefined;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!clickable) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onClick?.();
    }
  };

  return (
    <div
      ref={boxRef}
      className={`value-chip ${kind} ${trend}${flash ? " is-flashing" : ""}${clickable ? " is-clickable" : ""}`}
      data-trend={trend}
      title={title}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-label={clickable ? ariaLabel || title : undefined}
      onClick={onClick}
      onKeyDown={onKeyDown}
      style={clickableStyle}
    >
      <span
        ref={textRef}
        className="amount"
        style={{
          display: "inline-block",
          whiteSpace: "nowrap",
          lineHeight: 1,
          transform: `scale(${scale})`,
          transformOrigin: "left center",
          willChange: "transform",
        }}
      >
        {children}
      </span>
    </div>
  );
};

export const IconBtn: React.FC<
  React.ButtonHTMLAttributes<HTMLButtonElement> & { small?: boolean; aria?: string; titleText?: string; path: string }
> = ({ small, aria, titleText, path, ...rest }) => (
  <button
    {...rest}
    className={rest.className || "secondary"}
    aria-label={aria}
    title={titleText}
    style={small ? S.iconBtnSm : S.iconBtn}
  >
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false" className="ico">
      <path d={path} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  </button>
);
