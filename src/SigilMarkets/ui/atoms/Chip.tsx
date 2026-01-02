// SigilMarkets/ui/atoms/Chip.tsx
"use client";

import React, { forwardRef, useMemo } from "react";

export type ChipTone = "default" | "cyan" | "violet" | "gold" | "danger" | "success";
export type ChipVariant = "soft" | "solid" | "outline";
export type ChipSize = "sm" | "md";

type ChipOwnProps = {
  tone?: ChipTone;
  variant?: ChipVariant;
  size?: ChipSize;
  selected?: boolean;
  left?: React.ReactNode;
  right?: React.ReactNode;
};

export type ChipProps =
  | (React.ButtonHTMLAttributes<HTMLButtonElement> & ChipOwnProps & { as?: "button" })
  | (React.HTMLAttributes<HTMLSpanElement> & ChipOwnProps & { as: "span" });

const cx = (...parts: Array<string | false | null | undefined>): string => parts.filter(Boolean).join(" ");

const toneClass = (tone: ChipTone): string => {
  switch (tone) {
    case "cyan":
      return "sm-chip-cyan";
    case "violet":
      return "sm-chip-violet";
    case "gold":
      return "sm-chip-gold";
    case "danger":
      return "sm-chip-danger";
    case "success":
      return "sm-chip-success";
    case "default":
    default:
      return "sm-chip-default";
  }
};

const variantClass = (variant: ChipVariant): string => {
  switch (variant) {
    case "solid":
      return "sm-chip-solid";
    case "outline":
      return "sm-chip-outline";
    case "soft":
    default:
      return "sm-chip-soft";
  }
};

const sizeClass = (size: ChipSize): string => (size === "sm" ? "sm-chip-sm" : "sm-chip-md");

export const Chip = forwardRef<HTMLButtonElement | HTMLSpanElement, ChipProps>(function Chip(
  {
    as = "button",
    tone = "default",
    variant = "soft",
    size = "md",
    selected = false,
    left,
    right,
    className,
    children,
    ...rest
  },
  ref,
) {
  const cls = useMemo(
    () =>
      cx(
        "sm-chip",
        toneClass(tone),
        variantClass(variant),
        sizeClass(size),
        selected && "is-selected",
        className,
      ),
    [tone, variant, size, selected, className],
  );

  if (as === "span") {
    return (
      <span ref={ref as React.Ref<HTMLSpanElement>} className={cls} {...rest}>
        {left ? <span className="sm-chip-ico">{left}</span> : null}
        <span className="sm-chip-label">{children}</span>
        {right ? <span className="sm-chip-ico">{right}</span> : null}
      </span>
    );
  }

  return (
    <button ref={ref as React.Ref<HTMLButtonElement>} type="button" className={cls} {...rest}>
      {left ? <span className="sm-chip-ico">{left}</span> : null}
      <span className="sm-chip-label">{children}</span>
      {right ? <span className="sm-chip-ico">{right}</span> : null}
    </button>
  );
});
