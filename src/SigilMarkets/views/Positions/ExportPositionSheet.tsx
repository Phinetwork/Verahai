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
import { useActiveVault } from "../../state/vaultStore";
import { useSigilMarketsPositionStore } from "../../state/positionStore";
import { SigilExportButton } from "../../sigils/SigilExport";
import { buildPositionSigilSvgFromPayload, mintClaimSigil, mintPositionSigil } from "../../sigils/PositionSigilMint";
import { payoutForShares } from "../../utils/math";
import { momentFromPulse } from "../../../utils/kai_pulse";

export type ExportPositionSheetProps = Readonly<{
  open: boolean;
  onClose: () => void;
  position: PositionRecord;
}>;

const statusLabel = (st: string): string => {
  if (st === "claimable") return "won";
  if (st === "refundable") return "refundable";
  if (st === "lost") return "lost";
  if (st === "claimed") return "Won sealed";
  if (st === "refunded") return "refunded";
  return "open";
};

export const ExportPositionSheet = (props: ExportPositionSheetProps) => {
  const { actions: ui } = useSigilMarketsUi();
  const { actions: positionStore } = useSigilMarketsPositionStore();
  const activeVault = useActiveVault();
  const p = props.position;

  const hasSigil = !!p.sigil?.payload;
  const canCopyLink = !!p.sigil?.url;
  const [svgText, setSvgText] = useState<string | null>(null);
  const [claimSvgText, setClaimSvgText] = useState<string | null>(null);
  const [finalizing, setFinalizing] = useState(false);

  const subtitle = useMemo(() => {
    if (!hasSigil) return "Mint your Position Sigil first. Export downloads a ZIP with SVG, PNG, and manifest.";
    return "Export your Position Sigil as a ZIP (SVG + PNG + manifest for offline verification).";
  }, [hasSigil]);

  const hasResolution = !!p.resolution;
  const shouldLabelClaimProof = hasResolution && (p.status === "claimable" || p.status === "lost");
  const exportLabel = shouldLabelClaimProof ? "Download victory proof" : undefined;

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

  useEffect(() => {
    let mounted = true;
    setClaimSvgText(null);

    if (!shouldLabelClaimProof || !activeVault || !p.resolution) {
      return () => {
        mounted = false;
      };
    }

    const payoutMicro = p.status === "lost" ? 0n : payoutForShares(p.entry.sharesMicro);
    const claimMoment = momentFromPulse(p.resolution.resolvedPulse);

    void mintClaimSigil(p, activeVault, claimMoment, payoutMicro)
      .then((res) => {
        if (!mounted) return;
        setClaimSvgText(res.ok ? res.svgText : null);
      })
      .catch(() => {
        if (mounted) setClaimSvgText(null);
      });

    return () => {
      mounted = false;
    };
  }, [activeVault, p, shouldLabelClaimProof]);

  const finalizeProof = async (): Promise<void> => {
    if (!hasResolution) {
      ui.toast("info", "Not resolved", "Finalize proof is available after resolution.");
      return;
    }
    if (!activeVault || activeVault.vaultId !== p.lock.vaultId) {
      ui.pushSheet({ id: "inhale-glyph", reason: "vault" });
      return;
    }
    if (finalizing) return;

    setFinalizing(true);

    const res = await mintPositionSigil(p, activeVault);
    if (!res.ok) {
      ui.toast("error", "Finalize failed", res.error);
      setFinalizing(false);
      return;
    }

    const updatedPulse = p.resolution?.resolvedPulse ?? p.updatedPulse;
    positionStore.attachSigil(p.id, res.sigil, updatedPulse);
    setSvgText(res.svgText);
    ui.toast("success", "Proof finalized", "Position sigil updated with resolution.");
    setFinalizing(false);
  };

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

          {hasResolution ? (
            <Button
              variant="ghost"
              onClick={finalizeProof}
              disabled={finalizing}
              loading={finalizing}
              leftIcon={<Icon name="spark" size={14} tone="gold" />}
            >
              Finalize proof
            </Button>
          ) : null}

          {hasSigil ? (
            <SigilExportButton
              filenameBase={filenameBase}
              svgUrl={shouldLabelClaimProof ? undefined : p.sigil?.url}
              svgText={(shouldLabelClaimProof ? claimSvgText : svgText) ?? undefined}
              pngSizePx={2048}
              mode="zip"
              label={exportLabel}
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
          {p.sigil?.payload?.lineageRootSigilId ? (
            <Chip size="sm" selected={false} variant="outline" tone="default">
              lineage • {shortHash(p.sigil.payload.lineageRootSigilId as unknown as string, 10, 6)}
            </Chip>
          ) : null}
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
