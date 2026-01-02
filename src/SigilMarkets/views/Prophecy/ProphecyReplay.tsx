// SigilMarkets/views/Prophecy/ProphecyReplay.tsx
"use client";

import type { ProphecyRecord } from "../../state/feedStore";
import { Card, CardContent } from "../../ui/atoms/Card";
import { Divider } from "../../ui/atoms/Divider";

export const ProphecyReplay = (props: Readonly<{ prophecy: ProphecyRecord }>) => {
  const p = props.prophecy;
  return (
    <Card variant="glass2">
      <CardContent>
        <div className="sm-title" style={{ fontSize: 14 }}>Replay</div>
        <div className="sm-subtitle" style={{ marginTop: 6 }}>
          sealed pulse {p.createdAt.pulse} • side {p.side}
        </div>
        <Divider />
        <div className="sm-small">
          This is where we’ll render the full “moment capsule” (pulse/beat/step + glyph imprint) as a replayable artifact.
        </div>
      </CardContent>
    </Card>
  );
};
