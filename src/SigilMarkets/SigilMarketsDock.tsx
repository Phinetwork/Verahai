// SigilMarkets/SigilMarketsDock.tsx
"use client";

import { useMemo, type ReactNode } from "react";
import type { KaiMoment } from "./types/marketTypes";
import { useSigilMarketsUi } from "./state/uiStore";
import { useActiveVault } from "./state/vaultStore";
import { usePositions } from "./hooks/usePositions";
import { useProphecyFeed } from "./hooks/useProphecyFeed";
import { useHaptics } from "./hooks/useHaptics";
import { useSfx } from "./hooks/useSfx";

type DockTab = "grid" | "positions" | "vault" | "prophecy";

export type SigilMarketsDockProps = Readonly<{
  now: KaiMoment;
}>;

const iconFor = (tab: DockTab): ReactNode => {
  switch (tab) {
    case "grid":
      return "⬡";
    case "positions":
      return "◎";
    case "vault":
      return <img src="/phi.svg" alt="" aria-hidden="true" />;
    case "prophecy":
      return "✶";
    default: {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const _never: never = tab;
      return "⬡";
    }
  }
};

const labelFor = (tab: DockTab): string => {
  switch (tab) {
    case "grid":
      return "Markets";
    case "positions":
      return "Positions";
    case "vault":
      return "Vault";
    case "prophecy":
      return "Prophecy";
    default: {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const _never: never = tab;
      return "Markets";
    }
  }
};

const activeTabFromRoute = (view: string): DockTab => {
  if (view === "positions" || view === "position") return "positions";
  if (view === "vault") return "vault";
  if (view === "prophecy") return "prophecy";
  return "grid";
};

export const SigilMarketsDock = (props: SigilMarketsDockProps) => {
  const { state, actions } = useSigilMarketsUi();
  const activeVault = useActiveVault();
  const haptics = useHaptics();
  const sfx = useSfx();

  const { counts: positionCounts } = usePositions();
  const { counts: prophecyCounts } = useProphecyFeed({ visibility: "all", includeResolved: false });

  const activeTab = useMemo(() => activeTabFromRoute(state.route.view), [state.route.view]);

  const badgePositions = positionCounts.claimable;
  const badgeProphecy = prophecyCounts.sealed;

  const go = (tab: DockTab): void => {
    haptics.fire("tap");
    sfx.play("tap");

    if (tab === "grid") {
      actions.navigate({ view: "grid" });
      return;
    }
    if (tab === "positions") {
      actions.navigate({ view: "positions" });
      return;
    }
    if (tab === "prophecy") {
      actions.navigate({ view: "prophecy" });
      return;
    }

    // vault
    if (!activeVault) {
      actions.pushSheet({ id: "inhale-glyph", reason: "vault" });
      return;
    }
    actions.openVault(activeVault.vaultId);
  };

  const tabs: readonly DockTab[] = ["grid", "positions", "vault", "prophecy"];

  return (
    <div className="sm-dock" data-sm="dock" role="navigation" aria-label="Sigil Markets navigation">
      <div className="sm-dock-inner">
        {tabs.map((tab) => {
          const isActive = activeTab === tab;
          const badge =
            tab === "positions" ? badgePositions : tab === "prophecy" ? badgeProphecy : tab === "vault" && !activeVault ? 1 : 0;

          return (
            <button
              key={tab}
              type="button"
              className={`sm-dock-btn ${isActive ? "is-active" : ""}`}
              onClick={() => go(tab)}
              aria-current={isActive ? "page" : undefined}
            >
              <span className="sm-dock-icon" aria-hidden="true">
                {iconFor(tab)}
              </span>
              <span className="sm-dock-label">{labelFor(tab)}</span>
              {badge > 0 ? <span className="sm-dock-badge">{badge > 99 ? "99+" : badge}</span> : null}
            </button>
          );
        })}
      </div>

      {/* subtle Kai moment hint */}
      <div className="sm-dock-kai" aria-hidden="true">
        <span className="sm-dock-kai-dot" />
        <span className="sm-dock-kai-text">pulse {props.now.pulse}</span>
      </div>
    </div>
  );
};
