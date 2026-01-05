"use client";

import React, { forwardRef, useMemo } from "react";

export type ButtonVariant = "default" | "primary" | "danger" | "ghost";
export type ButtonSize = "xs" | "sm" | "md" | "lg";

export type ButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "color"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
};

const cx = (...parts: Array<string | false | null | undefined>): string => parts.filter(Boolean).join(" ");

const sizeClass = (size: ButtonSize): string => {
  switch (size) {
    case "xs":
      return "sm-btn-xs";
    case "sm":
      return "sm-btn-sm";
    case "lg":
      return "sm-btn-lg";
    case "md":
    default:
      return "sm-btn-md";
  }
};

const variantClass = (variant: ButtonVariant): string => {
  switch (variant) {
    case "primary":
      return "sm-btn-primary";
    case "danger":
      return "sm-btn-danger";
    case "ghost":
      return "sm-btn-ghost";
    case "default":
    default:
      return "sm-btn-default";
  }
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "default", size = "md", loading = false, leftIcon, rightIcon, className, disabled, children, ...rest },
  ref,
) {
  const isDisabled = !!disabled || loading;

  const cls = useMemo(
    () =>
      cx(
        "sm-btn",
        "sm-btn-core",
        sizeClass(size),
        variantClass(variant),
        isDisabled && "is-disabled",
        loading && "is-loading",
        className,
      ),
    [className, isDisabled, loading, size, variant],
  );

  return (
    <button ref={ref} className={cls} disabled={isDisabled} aria-busy={loading || undefined} {...rest}>
      <span className="sm-btn-inner">
        {leftIcon ? <span className="sm-btn-ico sm-btn-ico-left">{leftIcon}</span> : null}
        <span className="sm-btn-label">{children}</span>
        {rightIcon ? <span className="sm-btn-ico sm-btn-ico-right">{rightIcon}</span> : null}
      </span>

      {loading ? (
        <span className="sm-btn-spinner" aria-hidden="true">
          <span className="sm-btn-spinner-dot" />
          <span className="sm-btn-spinner-dot" />
          <span className="sm-btn-spinner-dot" />
        </span>
      ) : null}
    </button>
  );
});
