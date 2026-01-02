// SigilMarkets/views/Prophecy/ProphecyLeaderboard.tsx
"use client";

import React from "react";
import type { ProphecyLeaderRow } from "../../hooks/useProphecyFeed";
import { Card, CardContent } from "../../ui/atoms/Card";
import { Divider } from "../../ui/atoms/Divider";
import { Icon } from "../../ui/atoms/Icon";

export type ProphecyLeaderboardProps = Readonly<{
  rows: readonly ProphecyLeaderRow[];
}>;

export const ProphecyLeaderboard = (props: ProphecyLeaderboardProps) => {
  return (
    <Card variant="glass">
      <CardContent>
        <div className="sm-lead-head">
          <div className="sm-lead-title">
            <Icon name="positions" size={14} tone="dim" /> Leaders
          </div>
          <div className="sm-small">accuracy × volume</div>
        </div>

        <Divider />

        {props.rows.length === 0 ? (
          <div className="sm-subtitle" style={{ marginTop: 10 }}>
            No data yet.
          </div>
        ) : (
          <div className="sm-lead-list">
            {props.rows.slice(0, 50).map((r, i) => (
              <div key={r.userPhiKey} className="sm-lead-row">
                <div className="rank">{i + 1}</div>
                <div className="id mono">{r.label}</div>
                <div className="stat">{Math.round(r.accuracy * 100)}%</div>
                <div className="stat dim">{r.total}</div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
