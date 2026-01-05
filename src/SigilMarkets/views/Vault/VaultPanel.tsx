// SigilMarkets/views/Vault/VaultPanel.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { KaiMoment, VaultId } from "../../types/marketTypes";
import { useSigilMarketsUi } from "../../state/uiStore";
import { useScrollRestoration } from "../../hooks/useScrollRestoration";
import { useVault, useVaultActions } from "../../hooks/useVault";
import { formatPhiMicro } from "../../utils/format";

import { TopBar } from "../../ui/chrome/TopBar";
import { Card, CardContent } from "../../ui/atoms/Card";
import { Button } from "../../ui/atoms/Button";
import { Divider } from "../../ui/atoms/Divider";
import { Icon } from "../../ui/atoms/Icon";

import { VaultSigilCard } from "./VaultSigilCard";
import { VaultBalance } from "./VaultBalance";
import { VaultLocks } from "./VaultLocks";
import { VaultGrowthLine } from "./VaultGrowthLine";
import { VaultStreak } from "./VaultStreak";
import { VaultActions } from "./VaultActions";
import { DepositWithdrawSheet } from "./DepositWithdrawSheet";
import { VaultProphecySigils } from "./VaultProphecySigils";

export type VaultPanelProps = Readonly<{
  vaultId?: VaultId;
  now: KaiMoment;
  scrollMode: "window" | "container";
  scrollRef: React.RefObject<HTMLDivElement | null> | null;
}>;

export const VaultPanel = (props: VaultPanelProps) => {
  const { state: uiState, actions: ui } = useSigilMarketsUi();

  useScrollRestoration(uiState.route, {
    mode: props.scrollMode,
    containerRef: props.scrollRef ?? undefined,
    restoreDelayMs: 0,
  });

  const { vault, status, spendableMicro, lockedMicro, lockedCount, locks } = useVault(props.vaultId ?? null);
  const vaultActions = useVaultActions();

  const [dwOpen, setDwOpen] = useState<boolean>(false);
  const [dwMode, setDwMode] = useState<"deposit" | "withdraw">("deposit");
  const [isCompactAmount, setIsCompactAmount] = useState(false);

  const title = "Vault";

  // ✅ `lockedCount` is the canonical count of active locks.
  // Use `locks` for timeline/meta (last activity), not for status comparisons.
  const lastLockPulse = useMemo(() => {
    let lastPulse = 0;
    for (const l of locks) lastPulse = Math.max(lastPulse, l.updatedPulse ?? 0);
    return lastPulse;
  }, [locks]);

  const subtitle = useMemo(() => {
    if (!vault) {
      return status === "ready" ? "Inhale a glyph to activate" : "Loading vault…";
    }

    const maxDecimals = isCompactAmount ? 2 : 4;
    const spend = formatPhiMicro(spendableMicro, { withUnit: true, maxDecimals, trimZeros: true });
    const locked = formatPhiMicro(lockedMicro, { withUnit: true, maxDecimals, trimZeros: true });
    const tail = lastLockPulse > 0 ? ` • last lock p${lastLockPulse}` : "";

    return `spendable ${spend} • locked ${locked} • locks ${lockedCount}${tail}`;
  }, [vault, status, spendableMicro, lockedMicro, lockedCount, lastLockPulse, isCompactAmount]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(max-width: 520px)");
    const handleChange = () => setIsCompactAmount(media.matches);
    handleChange();
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", handleChange);
      return () => media.removeEventListener("change", handleChange);
    }
    media.addListener(handleChange);
    return () => media.removeListener(handleChange);
  }, []);

  const isActiveVault = useMemo(() => {
    if (!vault) return false;
    const av = vaultActions.activeVault;
    if (!av) return false;
    return (av.vaultId as unknown as string) === (vault.vaultId as unknown as string);
  }, [vault, vaultActions.activeVault]);

  if (!vault) {
    return (
      <div className="sm-page" data-sm="vault">
        <TopBar
          title={title}
          subtitle={subtitle}
          now={props.now}
          scrollMode={props.scrollMode}
          scrollRef={props.scrollRef}
        />

        <Card variant="glass" className="sm-vault-empty">
          <CardContent>
            <div className="sm-title">Inhale your glyph</div>
            <div className="sm-subtitle" style={{ marginTop: 8 }}>
              Your Vault is the value-layer bound to your identity sigil. It holds spendable Φ and locks Φ into positions.
            </div>

            <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Button
                variant="primary"
                onClick={() => ui.pushSheet({ id: "inhale-glyph", reason: "vault" })}
                leftIcon={<Icon name="scan" size={14} tone="cyan" />}
              >
                Inhale glyph
              </Button>

              <Button variant="ghost" onClick={() => ui.navigate({ view: "grid" })}>
                Browse markets
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="sm-page" data-sm="vault">
      <TopBar
        title={title}
        subtitle={subtitle}
        now={props.now}
        scrollMode={props.scrollMode}
        scrollRef={props.scrollRef}
      />

      <div className="sm-vault-stack">
        <VaultSigilCard vault={vault} now={props.now} />

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <div className="sm-small">
            locks active: {lockedCount} • total records: {locks.length}
          </div>

          {isActiveVault ? (
            <div className="sm-small">active vault</div>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => vaultActions.setActiveVault(vault.vaultId)}
              leftIcon={<Icon name="check" size={14} tone="dim" />}
            >
              Set active
            </Button>
          )}

          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              vaultActions.setActiveVault(null);
              ui.toast("info", "Vault cleared", "Active vault disabled");
              ui.navigate({ view: "grid" });
            }}
            leftIcon={<Icon name="warning" size={14} tone="gold" />}
          >
            Deactivate
          </Button>
        </div>

        <div className="sm-vault-row">
          <VaultBalance vault={vault} />
          <VaultStreak vault={vault} now={props.now} />
        </div>

        <VaultGrowthLine vault={vault} now={props.now} />

        <VaultLocks vault={vault} />

        <Divider />

        <div className="sm-title">Prophecy Sigils</div>
        <div className="sm-subtitle" style={{ marginTop: 6 }}>
          Textual, time-locked claims sealed under your ΦKey with signature + ZK proofs.
        </div>

        <VaultProphecySigils vault={vault} now={props.now} />

        <Divider />

        <VaultActions
          vault={vault}
          now={props.now}
          onDeposit={() => {
            setDwMode("deposit");
            setDwOpen(true);
          }}
          onWithdraw={() => {
            setDwMode("withdraw");
            setDwOpen(true);
          }}
        />
      </div>

      <DepositWithdrawSheet open={dwOpen} mode={dwMode} onClose={() => setDwOpen(false)} vault={vault} now={props.now} />
    </div>
  );
};
