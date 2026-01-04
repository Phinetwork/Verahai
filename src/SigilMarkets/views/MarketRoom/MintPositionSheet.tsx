// SigilMarkets/views/MarketRoom/MintPositionSheet.tsx
"use client";

import { useCallback, useMemo, useState } from "react";
import type { KaiMoment } from "../../types/marketTypes";
import type { PositionRecord } from "../../types/sigilPositionTypes";

import { Sheet } from "../../ui/atoms/Sheet";
import { Button } from "../../ui/atoms/Button";
import { Divider } from "../../ui/atoms/Divider";
import { Icon } from "../../ui/atoms/Icon";

import { formatPhiMicro, formatSharesMicro } from "../../utils/format";
import { useSigilMarketsUi } from "../../state/uiStore";
import { useActiveVault } from "../../state/vaultStore";
import { useSigilMarketsPositionStore } from "../../state/positionStore";

import { mintPositionSigil } from "../../sigils/PositionSigilMint";
import { exportSigilZip, SigilExportButton } from "../../sigils/SigilExport";

export type MintPositionSheetProps = Readonly<{
  open: boolean;
  onClose: () => void;

  now: KaiMoment;

  position: PositionRecord | null;
}>;

export const MintPositionSheet = (props: MintPositionSheetProps) => {
  const { actions: ui } = useSigilMarketsUi();
  const activeVault = useActiveVault();
  const { actions: posStore } = useSigilMarketsPositionStore();

  const p = props.position;

  const [busy, setBusy] = useState(false);

  const hasSigil = !!p?.sigil?.url;

  const title = p ? `Position • ${p.entry.side}` : "Position";

  const filenameBase = useMemo(() => {
    if (!p) return "position_sigil";
    const pid = p.id as unknown as string;
    const pulse = p.entry.openedAt.pulse;
    return `position_${p.entry.side}_p${pulse}_${pid.slice(0, 10)}`;
  }, [p]);

  const stake = useMemo(
    () => (p ? formatPhiMicro(p.entry.stakeMicro, { withUnit: true, maxDecimals: 6, trimZeros: true }) : "—"),
    [p],
  );
  const shares = useMemo(
    () => (p ? formatSharesMicro(p.entry.sharesMicro, { maxDecimals: 2 }) : "—"),
    [p],
  );

  const mint = useCallback(async () => {
    if (!p) return;

    if (!activeVault) {
      ui.pushSheet({ id: "inhale-glyph", reason: "trade", marketId: p.marketId });
      return;
    }
    if (!activeVault.owner.identitySigil) {
      ui.pushSheet({ id: "inhale-glyph", reason: "trade", marketId: p.marketId });
      return;
    }

    if (p.sigil) {
      ui.toast("info", "Already minted", "This position already has a sigil.");
      return;
    }

    setBusy(true);

    const res = await mintPositionSigil(p, activeVault);
    if (!res.ok) {
      ui.toast("error", "Mint failed", res.error, { atPulse: props.now.pulse });
      setBusy(false);
      return;
    }

    posStore.attachSigil(p.id, res.sigil, props.now.pulse);
    ui.toast("success", "Minted", "Position sigil ready", { atPulse: props.now.pulse });

    const zipRes = await exportSigilZip({
      filenameBase,
      svgText: res.svgText,
      pngSizePx: 1400,
    });
    if (!zipRes.ok) {
      ui.toast("error", "Export failed", zipRes.error, { atPulse: props.now.pulse });
    }

    setBusy(false);
  }, [activeVault, filenameBase, p, posStore, props.now.pulse, ui]);

  const exportUrl = p?.sigil?.url;

  return (
    <Sheet
      open={props.open}
      onClose={props.onClose}
      title={title}
      subtitle="Mint your Position Sigil (portable receipt) for sharing, printing, and proof."
      footer={
        <div className="sm-mint-footer">
          <Button variant="ghost" onClick={props.onClose} disabled={busy}>
            Close
          </Button>

          <Button
            variant="primary"
            onClick={mint}
            disabled={!p || !!p.sigil || busy}
            loading={busy}
            leftIcon={<Icon name="spark" size={14} tone="gold" />}
          >
            {hasSigil ? "Minted" : "Mint sigil"}
          </Button>
        </div>
      }
    >
      <div className="sm-mint">
        <div className="sm-mint-hero sm-breathe">
          <div className="sm-mint-badge">
            <Icon name="hex" size={18} tone="cyan" />
          </div>
          <div>
            <div className="sm-mint-title">Your stance is now an artifact.</div>
            <div className="sm-mint-sub">pulse {props.now.pulse}</div>
          </div>
        </div>

        <Divider />

        <div className="sm-mint-grid">
          <div className="sm-mint-row">
            <span className="sm-mint-k">Stake</span>
            <span className="sm-mint-v">{stake}</span>
          </div>
          <div className="sm-mint-row">
            <span className="sm-mint-k">Shares</span>
            <span className="sm-mint-v">{shares}</span>
          </div>
          <div className="sm-mint-row">
            <span className="sm-mint-k">Side</span>
            <span className="sm-mint-v">{p ? p.entry.side : "—"}</span>
          </div>
        </div>

        {exportUrl ? (
          <>
            <Divider />
            <div style={{ display: "grid", gap: 10 }}>
              <SigilExportButton filenameBase={`position_${p?.id ?? "sigil"}`} svgUrl={exportUrl} />
              <div className="sm-small">Export downloads SVG + PNG (with embedded metadata).</div>
            </div>
          </>
        ) : (
          <div className="sm-small" style={{ marginTop: 12 }}>
            Minting creates an SVG with embedded SM-POS-1 metadata bound to your identity.
          </div>
        )}
      </div>
    </Sheet>
  );
};
