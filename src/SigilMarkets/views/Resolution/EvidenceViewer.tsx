// SigilMarkets/views/Resolution/EvidenceViewer.tsx
"use client";

import React, { useMemo } from "react";
import type { Market } from "../../types/marketTypes";
import { Card, CardContent } from "../../ui/atoms/Card";
import { Divider } from "../../ui/atoms/Divider";
import { Icon } from "../../ui/atoms/Icon";
import { shortHash } from "../../utils/format";

export type EvidenceViewerProps = Readonly<{
  market: Market;
}>;

export const EvidenceViewer = (props: EvidenceViewerProps) => {
  const ev = props.market.state.resolution?.evidence;

  const urls = ev?.urls ?? [];
  const hashes = ev?.hashes ?? [];

  const has = urls.length > 0 || hashes.length > 0 || (ev?.summary && ev.summary.trim().length > 0);

  if (!has) {
    return (
      <Card variant="glass2">
        <CardContent>
          <div className="sm-subtitle">No evidence attached.</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card variant="glass2">
      <CardContent>
        <div className="sm-ev-head">
          <div className="sm-ev-title">
            <Icon name="spark" size={14} tone="dim" /> Evidence
          </div>
          <div className="sm-small">
            {urls.length} urls • {hashes.length} hashes
          </div>
        </div>

        {ev?.summary ? (
          <>
            <Divider />
            <div className="sm-ev-summary">{ev.summary}</div>
          </>
        ) : null}

        {urls.length > 0 ? (
          <>
            <Divider />
            <div className="sm-ev-block">
              <div className="sm-ev-k">URLs</div>
              <ul className="sm-ev-list">
                {urls.slice(0, 12).map((u) => (
                  <li key={u}>
                    <a className="sm-ev-link" href={u} target="_blank" rel="noreferrer">
                      {u}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </>
        ) : null}

        {hashes.length > 0 ? (
          <>
            <Divider />
            <div className="sm-ev-block">
              <div className="sm-ev-k">Hashes</div>
              <ul className="sm-ev-list mono">
                {hashes.slice(0, 12).map((h) => (
                  <li key={h as unknown as string}>{shortHash(h as unknown as string, 12, 10)}</li>
                ))}
              </ul>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
};
