// SigilMarkets/views/Prophecy/CreatorBadges.tsx
"use client";


import { Chip } from "../../ui/atoms/Chip";

export const CreatorBadges = (props: Readonly<{ badges: readonly string[] }>) => {
  if (!props.badges.length) return null;
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {props.badges.slice(0, 6).map((b) => (
        <Chip key={b} size="sm" selected={false} variant="outline">
          {b}
        </Chip>
      ))}
    </div>
  );
};
