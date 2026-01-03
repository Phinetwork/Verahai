// SigilMarkets/views/Positions/ExportPositionSheet.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { PositionRecord } from "../../types/sigilPositionTypes";
import { Sheet } from "../../ui/atoms/Sheet";
import { Button } from "../../ui/atoms/Button";
import { Divider } from "../../ui/atoms/Divider";
import { Icon } from "../../ui/atoms/Icon";
import { Chip } from "../../ui/atoms/Chip";
import { shortHash } from "../../utils/format";
import { useSigilMarketsUi } from "../../state/uiStore";
import { SigilExportButton } from "../../sigils/SigilExport";
import { buildPositionSigilSvgFromPayload } from "../../sigils/PositionSigilMint";

export type ExportPositionSheetProps = Readonly<{
  open: boolean;
  onClose: () => void;
  position: PositionRecord;
}>;

const statusLabel = (st: string): string => {
  if (st === "claimable") return "claimable";
  if (st === "refundable") return "refundable";
  if (st === "lost") return "lost";
  if (st === "claimed") return "claimed";
  if (st === "refunded") return "refunded";
  return "open";
};

export const ExportPositionSheet = (props: ExportPositionSheetProps) => {
  const { actions: ui } = useSigilMarketsUi();
  const p = props.position;

  const hasSigil = !!p.sigil?.payload;
  const canCopyLink = !!p.sigil?.url;
  const [svgText, setSvgText] = useState<string | null>(null);

  const subtitle = useMemo(() => {
    if (!hasSigil) return "Mint your Position Sigil first. Export downloads a ZIP with SVG, PNG, and manifest.";
    return "Export your Position Sigil as a ZIP (SVG + PNG + manifest for offline verification).";
  }, [hasSigil]);

  const filenameBase = useMemo(() => {
    const pid = p.id as unknown as string;
    const side = p.entry.side;
    const pulse = p.entry.openedAt.pulse;
    return `position_${side}_p${pulse}_${pid.slice(0, 10)}`;
  }, [p.entry.openedAt.pulse, p.entry.side, p.id]);

  const onCopyLink = async (): Promise<void> => {
    if (!p.sigil?.url) return;
    try {
      await navigator.clipboard.writeText(p.sigil.url);
      ui.toast("success", "Copied", "Sigil URL copied to clipboard");
    } catch {
      ui.toast("error", "Copy failed", "Clipboard not available");
    }
  };

  useEffect(() => {
    let mounted = true;
    if (!p.sigil?.payload) {
      setSvgText(null);
      return () => {
        mounted = false;
      };
    }

    buildPositionSigilSvgFromPayload(p.sigil.payload)
      .then((text) => {
        if (mounted) setSvgText(text);
      })
      .catch(() => {
        if (mounted) setSvgText(null);
      });

    return () => {
      mounted = false;
    };
  }, [p.sigil?.payload]);

  return (
    <Sheet
      open={props.open}
      onClose={props.onClose}
      title="Export Position"
      subtitle={subtitle}
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" }}>
          <Button variant="ghost" onClick={props.onClose}>
            Close
          </Button>

          <Button
            variant="ghost"
            onClick={onCopyLink}
            disabled={!canCopyLink}
            leftIcon={<Icon name="share" size={14} tone="dim" />}
          >
            Copy link
          </Button>

          {hasSigil ? (
            <SigilExportButton
              filenameBase={filenameBase}
              svgUrl={p.sigil?.url}
              svgText={svgText ?? undefined}
              pngSizePx={2048}
              mode="zip"
            />
          ) : (
            <Button
              variant="primary"
              onClick={() => {
                ui.toast("info", "Mint first", "Open the mint flow to create the sigil.");
                props.onClose();
              }}
              leftIcon={<Icon name="spark" size={14} tone="gold" />}
            >
              Go mint
            </Button>
          )}
        </div>
      }
    >
      <div className="sm-export-pos">
        <div className="sm-export-pos-row">
          <span className="k">position</span>
          <span className="v mono">{shortHash(p.id as unknown as string, 14, 10)}</span>
        </div>

        <div className="sm-export-pos-row">
          <span className="k">market</span>
          <span className="v mono">{shortHash(p.marketId as unknown as string, 14, 10)}</span>
        </div>

        <Divider />

        <div className="sm-export-pos-tags">
          <Chip size="sm" selected={false} variant="outline" tone="default">
            side • {p.entry.side}
          </Chip>
          <Chip size="sm" selected={false} variant="outline" tone="default">
            status • {statusLabel(p.status)}
          </Chip>
          <Chip size="sm" selected={false} variant="outline" tone="default">
            opened • p{p.entry.openedAt.pulse}
          </Chip>
        </div>

        <Divider />

        {hasSigil ? (
          <div className="sm-small">
            This export includes the embedded <b>SM-POS-1</b> payload inside <code>&lt;metadata&gt;</code> plus
            mirrored <code>data-*</code> attributes for fast verification.
          </div>
        ) : (
          <div className="sm-small">
            No sigil is attached yet. Minting creates an SVG artifact that can be exported and scanned offline.
          </div>
        )}
      </div>
    </Sheet>
  );
};
