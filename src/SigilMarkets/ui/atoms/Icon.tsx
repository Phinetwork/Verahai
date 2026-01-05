// SigilMarkets/ui/atoms/Icon.tsx
"use client";

import React, { useMemo } from "react";

export type IconName =
  | "hex"
  | "spark"
  | "vault"
  | "user"
  | "positions"
  | "prophecy"
  | "yes"
  | "no"
  | "clock"
  | "share"
  | "export"
  | "download"
  | "scan"
  | "back"
  | "close"
  | "warning"
  | "check"
  | "x"
  | "plus"
  | "minus";

export type IconProps = Readonly<{
  name: IconName;
  size?: number; // px
  tone?: "default" | "cyan" | "violet" | "gold" | "danger" | "success" | "dim";
  className?: string;
  style?: React.CSSProperties;
  title?: string;
}>;

const cx = (...parts: Array<string | false | null | undefined>): string =>
  parts.filter(Boolean).join(" ");

const glyph = (name: IconName): string => {
  switch (name) {
    case "hex":
      return "⬡";
    case "spark":
      return "✶";
    case "vault":
      return "Φ";
    case "user":
      return "👤";
    case "positions":
      return "◎";
    case "prophecy":
      return "✦";
    case "yes":
      return "Y";
    case "no":
      return "N";
    case "clock":
      return "⟡";
    case "share":
      return "↗";
    case "export":
      return "⤓";
    case "download":
      return "↓";
    case "scan":
      return "⌁";
    case "back":
      return "←";
    case "close":
      return "×";
    case "warning":
      return "!";
    case "check":
      return "✓";
    case "x":
      return "✕";
    case "plus":
      return "+";
    case "minus":
      return "−";
    default: {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const _never: never = name;
      return "⬡";
    }
  }
};

const toneClass = (tone: NonNullable<IconProps["tone"]>): string => {
  switch (tone) {
    case "cyan":
      return "sm-ico-cyan";
    case "violet":
      return "sm-ico-violet";
    case "gold":
      return "sm-ico-gold";
    case "danger":
      return "sm-ico-danger";
    case "success":
      return "sm-ico-success";
    case "dim":
      return "sm-ico-dim";
    case "default":
    default:
      return "sm-ico";
  }
};

// ✅ Explicit return type breaks the self-referential inference path that triggers TS7022
export const Icon = (props: IconProps): JSX.Element => {
  const { name, size = 16, tone = "default", className, style, title } = props;

  const cls = useMemo(() => cx("sm-ico-core", toneClass(tone), className), [tone, className]);

  return (
    <span
      className={cls}
      style={{ fontSize: `${size}px`, lineHeight: 1, ...style }}
      role={title ? "img" : "presentation"}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {glyph(name)}
    </span>
  );
};
