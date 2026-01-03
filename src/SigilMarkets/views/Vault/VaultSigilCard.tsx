// SigilMarkets/views/Vault/VaultSigilCard.tsx
"use client";

import { useMemo } from "react";
import type { KaiMoment } from "../../types/marketTypes";
import type { VaultRecord } from "../../types/vaultTypes";
import { Card, CardContent } from "../../ui/atoms/Card";
import { Chip } from "../../ui/atoms/Chip";
import { PhiIcon } from "../../ui/atoms/PhiIcon";
import { Button } from "../../ui/atoms/Button";
import { Icon } from "../../ui/atoms/Icon";
import { shortHash, shortKey } from "../../utils/format";
import { useSigilMarketsUi } from "../../state/uiStore";

export type VaultSigilCardProps = Readonly<{
  vault: VaultRecord;
  now: KaiMoment;
}>;

const statusTone = (s: VaultRecord["status"]): "default" | "gold" | "danger" => {
  if (s === "frozen") return "danger";
  return "gold";
};

export const VaultSigilCard = (props: VaultSigilCardProps) => {
  const { actions: ui } = useSigilMarketsUi();
  const v = props.vault;

  const userKey = v.owner.userPhiKey as unknown as string;
  const kaiSig = v.owner.kaiSignature as unknown as string;

  const vaultId = v.vaultId as unknown as string;
  const svgHash = v.owner.identitySigil?.svgHash ? (v.owner.identitySigil.svgHash as unknown as string) : null;

  const title = useMemo(() => `Vault • ${shortKey(userKey)}`, [userKey]);
  const sub = useMemo(() => `pulse ${props.now.pulse}`, [props.now.pulse]);

  const boundLabel = useMemo(() => (svgHash ? "identity bound" : "identity missing"), [svgHash]);

  const copy = async (text: string, label: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      ui.toast("success", "Copied", label);
    } catch {
      ui.toast("error", "Copy failed", "Clipboard not available");
    }
  };

  return (
    <Card variant="glass" className="sm-vault-sigil sm-breathe-soft">
      <CardContent>
        <div className="sm-vault-sigil-top">
          <div className="sm-vault-sigil-left">
            <div className="sm-vault-sigil-title">{title}</div>
            <div className="sm-vault-sigil-sub">{sub}</div>
          </div>

          <div className="sm-vault-sigil-badges">
            <Chip size="sm" selected={false} variant="outline" tone={statusTone(v.status)} left={<PhiIcon size={14} />}>
              {v.status}
            </Chip>
            <Chip size="sm" selected={false} variant="outline" left={<Icon name="spark" size={14} tone="dim" />}>
              {boundLabel}
            </Chip>
          </div>
        </div>

        <div className="sm-vault-sigil-meta">
          <div className="sm-vault-sigil-line">
            <span className="k">vaultId</span>
            <span className="v mono">{shortHash(vaultId, 14, 10)}</span>
          </div>

          <div className="sm-vault-sigil-line">
            <span className="k">userPhiKey</span>
            <span className="v mono">{shortHash(userKey, 14, 10)}</span>
          </div>

          <div className="sm-vault-sigil-line">
            <span className="k">kaiSignature</span>
            <span className="v mono">{shortHash(kaiSig, 14, 10)}</span>
          </div>

          {svgHash ? (
            <div className="sm-vault-sigil-line">
              <span className="k">identity svgHash</span>
              <span className="v mono">{shortHash(svgHash, 14, 10)}</span>
            </div>
          ) : null}
        </div>

        <div className="sm-vault-sigil-actions">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void copy(vaultId, "VaultId copied")}
            leftIcon={<Icon name="share" size={14} tone="dim" />}
          >
            Remember vaultId
          </Button>

          <Button
            size="sm"
            variant="ghost"
            onClick={() => void copy(userKey, "UserPhiKey copied")}
            leftIcon={<Icon name="share" size={14} tone="dim" />}
          >
            Remember userPhiKey
          </Button>

          {svgHash ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void copy(svgHash, "Identity svgHash copied")}
              leftIcon={<Icon name="share" size={14} tone="dim" />}
            >
              Remember svgHash
            </Button>
          ) : (
            <Button
              size="sm"
              variant="primary"
              onClick={() => ui.pushSheet({ id: "inhale-glyph", reason: "vault" })}
              leftIcon={<Icon name="scan" size={14} tone="cyan" />}
            >
              Re-inhale
            </Button>
          )}
        </div>

        <div className="sm-small" style={{ marginTop: 10 }}>
          Your Vault is the value-layer bound to your identity sigil. Positions lock Φ into it; wins grow it; losses consume locks.
        </div>
      </CardContent>
    </Card>
  );
};
