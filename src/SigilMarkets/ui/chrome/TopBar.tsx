// SigilMarkets/ui/chrome/TopBar.tsx
"use client";

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { KaiMoment } from "../../types/marketTypes";
import { DAY_TO_CHAKRA, WEEKDAYS, type ChakraDay } from "../../../utils/kai_pulse";
import { fmt2, formatPulse, modPos, readNum } from "../../../utils/kaiTimeDisplay";
import { beatIndexFromPulse, kaiCalendarFromPulse, stepIndexFromPulse } from "../../../SovereignSolar";
import { useSigilMarketsUi } from "../../state/uiStore";
import { useStickyHeader } from "../../hooks/useStickyHeader";
import { useBodyScrollLock } from "../../../hooks/useBodyScrollLock";
import { useVisualViewportSize } from "../../../hooks/useVisualViewportSize";
import { Icon } from "../atoms/Icon";
import { Chip } from "../atoms/Chip";
import { ToastHost } from "../atoms/Toast";
import { useActiveVault } from "../../state/vaultStore";
import { useGlyphBalance } from "../../hooks/useGlyphBalance";
import { formatPhiMicro } from "../../utils/format";
import { usd as formatUsd } from "../../../components/valuation/display";

type ScrollMode = "window" | "container";

export type TopBarProps = Readonly<{
  title: string;
  subtitle?: string;
  rightSubtitle?: string;
  now: KaiMoment;
  scrollMode: ScrollMode;
  scrollRef: React.RefObject<HTMLDivElement | null> | null;
  right?: React.ReactNode;
  back?: boolean;
  onBack?: () => void;
}>;

const cx = (...parts: Array<string | false | null | undefined>): string => parts.filter(Boolean).join(" ");

const PULSES_PER_DAY = 17_491.270421;

const ARK_COLORS: readonly string[] = [
  "var(--chakra-ark-0)",
  "var(--chakra-ark-1)",
  "var(--chakra-ark-2)",
  "var(--chakra-ark-3)",
  "var(--chakra-ark-4)",
  "var(--chakra-ark-5)",
];

const CHAKRA_DAY_COLORS: Record<ChakraDay, string> = {
  Root: "var(--chakra-ink-0)",
  Sacral: "var(--chakra-ink-1)",
  "Solar Plexus": "var(--chakra-ink-2)",
  Heart: "var(--chakra-ink-3)",
  Throat: "var(--chakra-ink-4)",
  "Third Eye": "var(--chakra-ink-5)",
  Crown: "var(--chakra-ink-6)",
};

const MONTH_CHAKRA_COLORS: readonly string[] = [
  "#ff7a7a",
  "#ffbd66",
  "#ffe25c",
  "#86ff86",
  "#79c2ff",
  "#c99aff",
  "#e29aff",
  "#e5e5e5",
];

type BeatStepDMY = {
  beat: number;
  step: number;
  day: number;
  month: number;
  year: number;
  chakraDay: ChakraDay;
};

function computeBeatStepDMY(pulse: number): BeatStepDMY {
  const pulseSafe = Number.isFinite(pulse) ? Math.max(0, Math.floor(pulse)) : 0;
  const beat = beatIndexFromPulse(pulseSafe);
  const step = stepIndexFromPulse(pulseSafe);
  const calendar = kaiCalendarFromPulse(pulseSafe);
  const weekdayIdx = Math.max(0, Math.min(WEEKDAYS.length - 1, calendar.dayOfWeek - 1));
  const weekday = WEEKDAYS[weekdayIdx] ?? WEEKDAYS[0];
  const chakraDay = DAY_TO_CHAKRA[weekday] ?? "Heart";

  return {
    beat,
    step,
    day: calendar.dayInMonth,
    month: calendar.monthIdx + 1,
    year: calendar.yearIdx,
    chakraDay,
  };
}

function formatBeatStepLabel(v: BeatStepDMY): string {
  return `${fmt2(v.beat)}:${fmt2(v.step)}`;
}

function formatDMYLabel(v: BeatStepDMY): string {
  return `D${v.day}/M${v.month}/Y${v.year}`;
}

const EternalKlockLazy = React.lazy(() => import("../../../components/EternalKlock"));

type KlockPopoverStyle = CSSProperties & {
  ["--klock-breath"]?: string;
  ["--klock-border"]?: string;
  ["--klock-border-strong"]?: string;
  ["--klock-ring"]?: string;
  ["--klock-scale"]?: string;
};

function isFixedSafeHost(el: HTMLElement): boolean {
  const cs = window.getComputedStyle(el);
  const backdropFilter = (cs as unknown as { backdropFilter?: string }).backdropFilter;
  const willChange = cs.willChange || "";

  const risky =
    (cs.transform && cs.transform !== "none") ||
    (cs.perspective && cs.perspective !== "none") ||
    (cs.filter && cs.filter !== "none") ||
    (backdropFilter && backdropFilter !== "none") ||
    (cs.contain && cs.contain !== "none") ||
    willChange.includes("transform") ||
    willChange.includes("perspective") ||
    willChange.includes("filter");

  return !risky;
}

function getPortalHost(): HTMLElement {
  const shell = document.querySelector(".sm-shell");
  if (shell instanceof HTMLElement) {
    try {
      if (isFixedSafeHost(shell)) return shell;
    } catch {
      /* ignore */
    }
  }
  return document.body;
}

type KlockPopoverProps = Readonly<{
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}>;

function KlockPopover({ open, onClose, children }: KlockPopoverProps): React.JSX.Element | null {
  const isClient = typeof document !== "undefined";
  const vvSize = useVisualViewportSize();

  const portalHost = useMemo<HTMLElement | null>(() => {
    if (!isClient) return null;
    return getPortalHost();
  }, [isClient]);

  useBodyScrollLock(open && isClient);

  useEffect(() => {
    if (!open || !isClient) return;

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose, isClient]);

  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!open) return;
    window.requestAnimationFrame(() => closeBtnRef.current?.focus());
  }, [open]);

  const overlayStyle = useMemo<KlockPopoverStyle | undefined>(() => {
    if (!open || !isClient) return undefined;

    const h = vvSize.height;
    const w = vvSize.width;

    return {
      position: "fixed",
      inset: 0,
      pointerEvents: "auto",
      height: h > 0 ? `${h}px` : undefined,
      width: w > 0 ? `${w}px` : undefined,

      ["--klock-breath"]: "5.236s",
      ["--klock-border"]: "rgba(255, 216, 120, 0.26)",
      ["--klock-border-strong"]: "rgba(255, 231, 160, 0.55)",
      ["--klock-ring"]:
        "0 0 0 2px rgba(255, 225, 150, 0.22), 0 0 0 6px rgba(255, 210, 120, 0.10)",
      ["--klock-scale"]: "5",
    };
  }, [open, isClient, vvSize]);

  const onBackdropPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): void => {
      if (e.target === e.currentTarget) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    [],
  );

  const onBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>): void => {
      if (e.target === e.currentTarget) {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    },
    [onClose],
  );

  const onClosePointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>): void => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  if (!open || !isClient || !portalHost) return null;

  return createPortal(
    <div
      className="klock-pop"
      style={overlayStyle}
      role="dialog"
      aria-modal="true"
      aria-label="Eternal KaiKlok"
      onPointerDown={onBackdropPointerDown}
      onClick={onBackdropClick}
    >
      <div className="klock-pop__panel" role="document" data-klock-size="xl">
        <button
          ref={closeBtnRef}
          type="button"
          className="klock-pop__close kx-x"
          onPointerDown={onClosePointerDown}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }}
          aria-label="Close Eternal KaiKlok"
          title="Close (Esc)"
        >
          ×
        </button>

        <div className="klock-pop__body">
          <div className="klock-stage" role="presentation" data-klock-stage="1">
            <div className="klock-stage__inner">{children}</div>
          </div>
        </div>

        <div className="sr-only" aria-live="polite">
          Eternal KaiKlok portal open
        </div>
      </div>
    </div>,
    portalHost,
  );
}

type LiveKaiButtonProps = {
  now: KaiMoment;
  onOpenKlock: () => void;
  breathS: number;
  breathMs: number;
  breathsPerDay: number;
};

function LiveKaiButton({
  now,
  onOpenKlock,
  breathS,
  breathMs,
  breathsPerDay,
}: LiveKaiButtonProps): React.JSX.Element {
  const snap = useMemo(() => {
    const pulse = readNum(now, "pulse") ?? 0;
    const pulseStr = Number.isFinite(pulse) ? pulse.toLocaleString("en-US") : formatPulse(pulse);
    const bsd = computeBeatStepDMY(pulse);

    return {
      pulse,
      pulseStr,
      beatStepDMY: bsd,
      beatStepLabel: formatBeatStepLabel(bsd),
      dmyLabel: formatDMYLabel(bsd),
      chakraDay: bsd.chakraDay,
    };
  }, [now.pulse]);

  const neonTextStyle = useMemo<CSSProperties>(
    () => ({
      color: "var(--accent-color)",
      textShadow: "0 0 14px rgba(0, 255, 255, 0.22), 0 0 28px rgba(0, 255, 255, 0.12)",
    }),
    [],
  );

  const arcColor = useMemo(() => {
    const pos = modPos(snap.pulse, PULSES_PER_DAY);
    const arcSize = PULSES_PER_DAY / ARK_COLORS.length;
    const idx = Math.min(ARK_COLORS.length - 1, Math.max(0, Math.floor(pos / arcSize)));
    return ARK_COLORS[idx] ?? ARK_COLORS[0];
  }, [snap.pulse]);

  const chakraColor = useMemo(() => CHAKRA_DAY_COLORS[snap.chakraDay] ?? CHAKRA_DAY_COLORS.Heart, [
    snap.chakraDay,
  ]);

  const monthColor = useMemo(() => {
    const idx = Math.min(
      MONTH_CHAKRA_COLORS.length - 1,
      Math.max(0, snap.beatStepDMY.month - 1),
    );
    return MONTH_CHAKRA_COLORS[idx] ?? CHAKRA_DAY_COLORS.Heart;
  }, [snap.beatStepDMY.month]);

  const timeStyle = useMemo<CSSProperties>(
    () =>
      ({
        ["--kai-ark"]: arcColor,
        ["--kai-chakra"]: chakraColor,
        ["--kai-month"]: monthColor,
        ["--breath-s"]: `${breathS}s`,
      }) as CSSProperties,
    [arcColor, chakraColor, monthColor, breathS],
  );

  const liveTitle = useMemo(() => {
    return `LIVE • NOW PULSE ${snap.pulseStr} • ${snap.beatStepLabel} • ${snap.dmyLabel} • Breath ${breathS.toFixed(
      6,
    )}s (${Math.round(breathMs)}ms) • ${breathsPerDay.toLocaleString("en-US", {
      minimumFractionDigits: 6,
      maximumFractionDigits: 6,
    })}/day • Open Eternal KaiKlok`;
  }, [snap.pulseStr, snap.beatStepLabel, snap.dmyLabel, breathS, breathMs, breathsPerDay]);

  const liveAria = useMemo(() => {
    return `LIVE. Kai Pulse now ${snap.pulse}. Beat ${snap.beatStepDMY.beat} step ${snap.beatStepDMY.step}. D ${snap.beatStepDMY.day}. M ${snap.beatStepDMY.month}. Y ${snap.beatStepDMY.year}. Open Eternal KaiKlok.`;
  }, [snap]);

  return (
    <button
      type="button"
      className="topbar-live"
      onClick={onOpenKlock}
      aria-label={liveAria}
      title={liveTitle}
      style={timeStyle}
    >
      <span className="live-orb" aria-hidden="true" />
      <div className="live-scroll" aria-hidden="true">
        <div className="live-text">
          <div className="live-line live-line--pulse">
            <div className="live-meta">
              <span className="mono" style={neonTextStyle}>
                ☤KAI
              </span>
            </div>

            <div className="live-meta live-meta--pulse">
              <span className="mono" style={neonTextStyle}>
                {snap.pulseStr}
              </span>
            </div>
          </div>

          <div className="live-line live-line--kai">
            <span className="kai-num kai-num--ark mono">{snap.beatStepLabel}</span>
            <span className="kai-sep">•</span>
            <span className="kai-tag mono">D</span>
            <span className="kai-num kai-num--chakra mono">{snap.beatStepDMY.day}</span>
            <span className="kai-sep">/</span>
            <span className="kai-tag mono">M</span>
            <span className="kai-num kai-num--month mono">{snap.beatStepDMY.month}</span>
            <span className="kai-sep">/</span>
            <span className="kai-tag mono">Y</span>
            <span className="kai-num mono">{snap.beatStepDMY.year}</span>
          </div>
        </div>
      </div>
    </button>
  );
}

export const TopBar = (props: TopBarProps) => {
  const { actions, state } = useSigilMarketsUi();
  const BREATH_S = 3 + Math.sqrt(5);
  const BREATH_MS = BREATH_S * 1000;
  const BREATHS_PER_DAY = 17_491.270421;
  const [klockOpen, setKlockOpen] = useState(false);
  const activeVault = useActiveVault();
  const glyphBalance = useGlyphBalance(activeVault, props.now);
  const hasGlyph = Boolean(activeVault?.owner.identitySigil);
  const liveUsdPerPhiLabel = useMemo(() => {
    if (!Number.isFinite(glyphBalance.usdPerPhi) || glyphBalance.usdPerPhi <= 0) return "$ —";
    return formatUsd(glyphBalance.usdPerPhi);
  }, [glyphBalance.usdPerPhi]);
  const glyphPhiLabel = useMemo(() => {
    if (!hasGlyph) return "—";
    if (glyphBalance.availableMicro === null) return "—";
    return formatPhiMicro(glyphBalance.availableMicro, { withUnit: false, maxDecimals: 6, trimZeros: true });
  }, [glyphBalance.availableMicro, hasGlyph]);
  const glyphUsdLabel = useMemo(() => {
    if (!hasGlyph) return "";
    if (!activeVault) return "$ —";
    if (glyphBalance.availableUsdLabel === "—") return "$ —";
    return glyphBalance.availableUsdLabel;
  }, [activeVault, glyphBalance.availableUsdLabel, hasGlyph, liveUsdPerPhiLabel]);

  const sticky = useStickyHeader(
    props.scrollMode === "container"
      ? { mode: "container", containerRef: props.scrollRef ?? undefined }
      : { mode: "window" },
  );

  const cls = useMemo(() => cx("sm-topbar", sticky.t > 0.02 && "is-scrolled"), [sticky.t]);

  const currentMarketId = state.route.view === "market" ? state.route.marketId : null;
  const canSeal = true;

  const handleOpenKlock = useCallback(() => {
    setKlockOpen(true);
  }, []);

  const handleCloseKlock = useCallback(() => {
    setKlockOpen(false);
  }, []);

  const handleSeal = useCallback(() => {
    actions.pushSheet({ id: "seal-prediction", marketId: currentMarketId ?? undefined });
  }, [actions, currentMarketId]);

  useEffect(() => {
    void import("../../../components/EternalKlock");
  }, []);

  return (
    <>
      <ToastHost />
      <KlockPopover open={klockOpen} onClose={handleCloseKlock}>
        <Suspense fallback={null}>
          <EternalKlockLazy />
        </Suspense>
      </KlockPopover>
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
              </div>
              {props.subtitle ? <div className="sm-topbar-sub sm-topbar-sub--title">{props.subtitle}</div> : null}
              <div className="sm-topbar-glyph sm-topbar-glyph--inline" aria-label="Glyph balance">
                <div className="sm-topbar-glyph-values">
                  {hasGlyph ? (
                    <span className="sm-topbar-glyph-phi">
                      <img className="sm-topbar-glyph-phi-icon" src="/phi.svg" alt="" aria-hidden="true" />
                      {glyphPhiLabel}
                    </span>
                  ) : (
                    <span className="sm-topbar-glyph-phi sm-topbar-glyph-phi--price">
                      {liveUsdPerPhiLabel}
                      <span className="sm-topbar-glyph-slash">/</span>
                      <img className="sm-topbar-glyph-phi-icon" src="/phi.svg" alt="" aria-hidden="true" />
                    </span>
                  )}
                  {glyphUsdLabel ? <span className="sm-topbar-glyph-usd">{glyphUsdLabel}</span> : null}
                </div>
              </div>
            </div>
          </div>

          <div className="sm-topbar-right">
            <div className="sm-topbar-seal-wrap">
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
                Seal
              </Chip>
              {props.subtitle ? <span className="sm-topbar-sub sm-topbar-sub--seal">{props.subtitle}</span> : null}
              {props.rightSubtitle ? <span className="sm-topbar-right-sub">{props.rightSubtitle}</span> : null}
            </div>

            <LiveKaiButton
              now={props.now}
              onOpenKlock={handleOpenKlock}
              breathS={BREATH_S}
              breathMs={BREATH_MS}
              breathsPerDay={BREATHS_PER_DAY}
            />

            {props.right}
          </div>
        </div>
        <div style={sticky.dividerStyle} />
      </div>
    </>
  );
};
