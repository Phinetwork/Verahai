// SigilMarkets/views/Positions/PositionTimeline.tsx
"use client";

import React, { useMemo } from "react";
import type { PositionRecord } from "../../types/sigilPositionTypes";
import { Divider } from "../../ui/atoms/Divider";
import { Icon } from "../../ui/atoms/Icon";
import { formatPhiMicro, formatSharesMicro } from "../../utils/format";

export type PositionTimelineProps = Readonly<{
  position: PositionRecord;
}>;

type TimelineItem = Readonly<{
  key: string;
  title: string;
  detail: string;
  pulse: number;
  tone?: "default" | "success" | "danger" | "violet" | "gold";
}>;

const toneFor = (k: TimelineItem["key"]): TimelineItem["tone"] => {
  if (k === "opened") return "default";
  if (k === "resolved") return "gold";
  if (k === "claimed") return "success";
  if (k === "refunded") return "violet";
  if (k === "lost") return "danger";
  return "default";
};

export const PositionTimeline = (props: PositionTimelineProps) => {
  const p = props.position;

  const stake = useMemo(() => formatPhiMicro(p.entry.stakeMicro, { withUnit: true, maxDecimals: 6, trimZeros: true }), [p.entry.stakeMicro]);
  const shares = useMemo(() => formatSharesMicro(p.entry.sharesMicro, { maxDecimals: 2 }), [p.entry.sharesMicro]);

  const items = useMemo<readonly TimelineItem[]>(() => {
    const out: TimelineItem[] = [];

    out.push({
      key: "opened",
      title: "Opened",
      detail: `${p.entry.side} • ${stake} • ${shares}`,
      pulse: p.entry.openedAt.pulse,
      tone: toneFor("opened"),
    });

    if (p.resolution) {
      out.push({
        key: "resolved",
        title: "Resolved",
        detail: `${p.resolution.outcome} • winner: ${p.resolution.isWinner === true ? "yes" : p.resolution.isWinner === false ? "no" : "—"}`,
        pulse: p.resolution.resolvedPulse,
        tone: toneFor("resolved"),
      });
    }

    if (p.status === "lost") {
      out.push({
        key: "lost",
        title: "Lost",
        detail: "Lock consumed • no victory available",
        pulse: p.updatedPulse,
        tone: toneFor("lost"),
      });
    }

    if (p.settlement && p.status === "claimed") {
      out.push({
        key: "claimed",
        title: "Victory sealed",
        detail: `+${formatPhiMicro(p.settlement.creditedMicro, { withUnit: true, maxDecimals: 6, trimZeros: true })}`,
        pulse: p.settlement.settledPulse,
        tone: toneFor("claimed"),
      });
    }

    if (p.settlement && p.status === "refunded") {
      out.push({
        key: "refunded",
        title: "Refunded",
        detail: `+${formatPhiMicro(p.settlement.creditedMicro, { withUnit: true, maxDecimals: 6, trimZeros: true })}`,
        pulse: p.settlement.settledPulse,
        tone: toneFor("refunded"),
      });
    }

    // sort ascending by pulse
    out.sort((a, b) => a.pulse - b.pulse);

    return out;
  }, [p, shares, stake]);

  return (
    <div className="sm-pos-timeline" data-sm="pos-timeline">
      <div className="sm-pos-tl-title">
        <Icon name="clock" size={14} tone="dim" /> Timeline
      </div>

      <Divider />

      <div className="sm-pos-tl-list">
        {items.map((it) => (
          <div key={it.key} className={`sm-pos-tl-item ${it.tone ? `tone-${it.tone}` : ""}`}>
            <div className="left">
              <div className="t">{it.title}</div>
              <div className="d">{it.detail}</div>
            </div>
            <div className="right mono">p {it.pulse}</div>
          </div>
        ))}
      </div>
    </div>
  );
};
