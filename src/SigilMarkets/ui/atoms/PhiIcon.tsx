// SigilMarkets/ui/atoms/PhiIcon.tsx
"use client";

import React from "react";

export type PhiIconProps = Readonly<{
  size?: number;
  className?: string;
  title?: string;
}>;

export const PhiIcon = (props: PhiIconProps): JSX.Element => {
  const { size = 14, className, title } = props;

  return (
    <img
      src="/phi.svg"
      alt={title ?? ""}
      aria-hidden={title ? undefined : true}
      title={title}
      className={["sm-phi-icon", className].filter(Boolean).join(" ")}
      style={{ width: size, height: size }}
      loading="lazy"
      decoding="async"
    />
  );
};
