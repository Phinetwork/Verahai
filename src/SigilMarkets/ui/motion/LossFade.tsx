// SigilMarkets/ui/motion/LossFade.tsx
"use client";

import React from "react";

export const LossFade = (props: Readonly<{ children: React.ReactNode }>) => {
  return <div className="sm-loss-fade">{props.children}</div>;
};
