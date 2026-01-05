// SigilMarkets/views/Prophecy/ProphecySigilCard.tsx
"use client";

import { useMemo } from "react";
import type { KaiMoment } from "../../types/marketTypes";
import type { ProphecyRecord } from "../../types/prophecySigilTypes";
import { Card, CardContent } from "../../ui/atoms/Card";
import { Chip } from "../../ui/atoms/Chip";
import { Icon } from "../../ui/atoms/Icon";
import { formatPhiMicro, shortHash } from "../../utils/format";
import { useProphecySigilVerification } from "../../hooks/useProphecySigilVerification";

export type ProphecySigilCardProps = Readonly<{
  prophecy: ProphecyRecord;
  now: KaiMoment;
  onRemove: () => void;
}>;

const sigilTone = (ok: boolean | null): "default" | "success" | "danger" => {
  if (ok === true) return "success";
  if (ok === false) return "danger";
  return "default";
};

export const ProphecySigilCard = (props: ProphecySigilCardProps) => {
  const p = props.prophecy;
  const sigil = p.sigil;
  const verification = useProphecySigilVerification(sigil?.svg, props.now);

  const text = useMemo(() => (verification.text ? verification.text : p.text), [p.text, verification.text]);
  const escrow = useMemo(
    () => (p.escrowPhiMicro ? formatPhiMicro(p.escrowPhiMicro, { withUnit: true, maxDecimals: 6, trimZeros: true }) : null),
    [p.escrowPhiMicro],
  );

  return (
    <div className="sm-proph-sigil-item">
      <Card variant="glass2" className="sm-proph-sigil-card">
        <CardContent compact>
          <div className="sm-proph-sigil-top">
            <div className="sm-proph-sigil-text">{text || "(empty)"}</div>
            <div className="sm-proph-sigil-badges">
              <Chip size="sm" selected={false} variant="outline" tone={sigilTone(verification.signatureOk)}>
                Sig {verification.signatureOk === true ? "✓" : verification.signatureOk === false ? "×" : "…"}
              </Chip>
              <Chip size="sm" selected={false} variant="outline" tone={sigilTone(verification.zkOk)}>
                ZK {verification.zkOk === true ? "✓" : verification.zkOk === false ? "×" : "…"}
              </Chip>
            </div>
          </div>

          <div className="sm-proph-sigil-meta">
            <span className="sm-small">sealed p{p.createdAtPulse}</span>
            {p.expirationPulse != null ? (
              <span className={`sm-small ${verification.windowStatus === "closed" ? "sm-warn" : ""}`}>
                expires p{p.expirationPulse} • window {verification.windowStatus}
              </span>
            ) : (
              <span className="sm-small">no expiration</span>
            )}
            {escrow ? <span className="sm-small">escrow {escrow}</span> : null}
          </div>

          {sigil?.canonicalHash ? (
            <div className="sm-proph-sigil-meta">
              <span className="sm-small mono">hash {shortHash(sigil.canonicalHash, 12, 6)}</span>
              {verification.zkScheme ? <span className="sm-small">scheme {verification.zkScheme}</span> : null}
            </div>
          ) : null}

          <div className="sm-proph-sigil-actions">
            {sigil?.url ? (
              <a className="sm-pill" href={sigil.url} target="_blank" rel="noreferrer">
                <Icon name="share" size={14} tone="dim" /> view sigil
              </a>
            ) : null}

            <button type="button" className="sm-pill sm-pill--danger" onClick={props.onRemove}>
              <Icon name="x" size={14} tone="danger" /> remove
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};