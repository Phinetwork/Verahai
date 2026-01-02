// SigilMarkets/ui/motion/BreathGlow.tsx
"use client";

import React from "react";

export const BreathGlow = (props: Readonly<{ children: React.ReactNode; className?: string }>) => {
  return <div className={props.className ? `sm-breathe ${props.className}` : "sm-breathe"}>{props.children}</div>;
};
