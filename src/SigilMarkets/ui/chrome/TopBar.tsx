// SigilMarkets/ui/chrome/TopBar.tsx
"use client";

import React, { useCallback, useMemo } from "react";
import type { KaiMoment } from "../../types/marketTypes";
import { useSigilMarketsUi } from "../../state/uiStore";
import { useStickyHeader } from "../../hooks/useStickyHeader";
import { Icon } from "../atoms/Icon";
import { Chip } from "../atoms/Chip";
import { ToastHost } from "../atoms/Toast";

type ScrollMode = "window" | "container";

export type TopBarProps = Readonly<{
  title: string;
  subtitle?: string;
  now: KaiMoment;
  scrollMode: ScrollMode;
  scrollRef: React.RefObject<HTMLDivElement | null> | null;
  right?: React.ReactNode;
  back?: boolean;
  onBack?: () => void;
}>;

const cx = (...parts: Array<string | false | null | undefined>): string => parts.filter(Boolean).join(" ");

export const TopBar = (props: TopBarProps) => {
  const { actions, state } = useSigilMarketsUi();

  const sticky = useStickyHeader(
    props.scrollMode === "container"
      ? { mode: "container", containerRef: props.scrollRef ?? undefined }
      : { mode: "window" },
  );

  const cls = useMemo(() => cx("sm-topbar", sticky.t > 0.02 && "is-scrolled"), [sticky.t]);

  const currentMarketId = state.route.view === "market" ? state.route.marketId : null;
  const canSeal = true;

  const handleOpenKlock = useCallback(() => {
    if (typeof window === "undefined") return;
    window.location.assign("/klock");
  }, []);

  const handleSeal = useCallback(() => {
    actions.pushSheet({ id: "seal-prediction", marketId: currentMarketId ?? undefined });
  }, [actions, currentMarketId]);

  return (
    <>
      <ToastHost />
      <div className={cls} style={sticky.headerStyle}>
        <div className="sm-topbar-row">
          <div className="sm-topbar-left">
            {props.back ? (
              <button
                type="button"
                className="sm-topbar-back"
                onClick={props.onBack ?? (() => actions.backToGrid())}
                aria-label="Back"
              >
                <Icon name="back" size={18} tone="dim" />
              </button>
            ) : null}

            <div className="sm-topbar-titles">
              <div className="sm-topbar-title">
                <span className="sm-topbar-title-core">{props.title}</span>
                <span className="sm-topbar-title-mark" aria-hidden="true">
                  Φ
                </span>
              </div>
              {props.subtitle ? <div className="sm-topbar-sub">{props.subtitle}</div> : null}
            </div>
          </div>

          <div className="sm-topbar-right">
            <Chip
              size="sm"
              selected={false}
              disabled={!canSeal}
              onClick={handleSeal}
              title={canSeal ? "Seal a prophecy" : "Open a market to seal a prophecy"}
              tone="gold"
              variant="solid"
              className="sm-topbar-seal"
              left={<Icon name="spark" size={14} tone="gold" />}
            >
              Seal Prophecy
            </Chip>

            <button
              type="button"
              className="sm-topbar-kai"
              title="Open Eternal KaiKlok"
              aria-label="Open Eternal KaiKlok"
              onClick={handleOpenKlock}
            >
              <span className="sm-topbar-kai-dot" aria-hidden="true" />
              <span className="sm-topbar-kai-text">p {props.now.pulse}</span>
              <span className="sm-topbar-kai-tag">KaiKlok</span>
            </button>

            {props.right}
          </div>
        </div>
        <div style={sticky.dividerStyle} />
      </div>
    </>
  );
};
