// SigilMarkets/views/Resolution/EvidenceViewer.tsx
"use client";

import { useMemo } from "react";
import type { Market } from "../../types/marketTypes";
import { Card, CardContent } from "../../ui/atoms/Card";
import { Divider } from "../../ui/atoms/Divider";
import { Icon } from "../../ui/atoms/Icon";
import { shortHash } from "../../utils/format";

export type EvidenceViewerProps = Readonly<{
  market: Market;
}>;

export const EvidenceViewer = (props: EvidenceViewerProps) => {
  // ✅ useMemo used correctly: derive stable view-model from market snapshot,
  // avoid recomputing/allocating arrays and booleans on every render.
  const vm = useMemo(() => {
    const ev = props.market.state.resolution?.evidence;

    const urls = ev?.urls ?? [];
    const hashes = ev?.hashes ?? [];

    const summary = (ev?.summary ?? "").trim();

    const has = urls.length > 0 || hashes.length > 0 || summary.length > 0;

    return {
      ev,
      urls,
      hashes,
      summary,
      has,
      urlCount: urls.length,
      hashCount: hashes.length,
    };
  }, [props.market.state.resolution?.evidence]);

  if (!vm.has) {
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
            {vm.urlCount} urls • {vm.hashCount} hashes
          </div>
        </div>

        {vm.summary ? (
          <>
            <Divider />
            <div className="sm-ev-summary">{vm.summary}</div>
          </>
        ) : null}

        {vm.urls.length > 0 ? (
          <>
            <Divider />
            <div className="sm-ev-block">
              <div className="sm-ev-k">URLs</div>
              <ul className="sm-ev-list">
                {vm.urls.slice(0, 12).map((u) => (
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

        {vm.hashes.length > 0 ? (
          <>
            <Divider />
            <div className="sm-ev-block">
              <div className="sm-ev-k">Hashes</div>
              <ul className="sm-ev-list mono">
                {vm.hashes.slice(0, 12).map((h) => {
                  const hs = h as unknown as string;
                  return <li key={hs}>{shortHash(hs, 12, 10)}</li>;
                })}
              </ul>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
};
