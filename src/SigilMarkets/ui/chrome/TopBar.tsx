// SigilMarkets/ui/chrome/TopBar.tsx
"use client";

import React, { useCallback, useMemo, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import type { KaiMoment } from "../../types/marketTypes";
import { DAYS_PER_MONTH, DAYS_PER_YEAR, MONTHS_PER_YEAR, momentFromPulse, type ChakraDay } from "../../../utils/kai_pulse";
import { fmt2, formatPulse, modPos, readNum } from "../../../utils/kaiTimeDisplay";
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

const BEATS_PER_DAY = 36;
const STEPS_PER_BEAT = 44;
const STEPS_PER_DAY = BEATS_PER_DAY * STEPS_PER_BEAT;
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
};

function computeBeatStepDMY(m: { pulse?: number }): BeatStepDMY {
  const pulse = readNum(m, "pulse") ?? 0;

  const pulseInDay = modPos(pulse, PULSES_PER_DAY);
  const dayFrac = PULSES_PER_DAY > 0 ? pulseInDay / PULSES_PER_DAY : 0;

  const rawStepOfDay = Math.floor(dayFrac * STEPS_PER_DAY);
  const stepOfDay = Math.min(STEPS_PER_DAY - 1, Math.max(0, rawStepOfDay));

  const beat = Math.min(BEATS_PER_DAY - 1, Math.max(0, Math.floor(stepOfDay / STEPS_PER_BEAT)));
  const step = Math.min(
    STEPS_PER_BEAT - 1,
    Math.max(0, stepOfDay - beat * STEPS_PER_BEAT),
  );

  const eps = 1e-9;
  const dayIndex = Math.floor((pulse + eps) / PULSES_PER_DAY);

  const daysPerYear = Number.isFinite(DAYS_PER_YEAR) ? DAYS_PER_YEAR : 336;
  const daysPerMonth = Number.isFinite(DAYS_PER_MONTH) ? DAYS_PER_MONTH : 42;
  const monthsPerYear = Number.isFinite(MONTHS_PER_YEAR) ? MONTHS_PER_YEAR : 8;

  const year = Math.floor(dayIndex / daysPerYear);
  const dayInYear = modPos(dayIndex, daysPerYear);

  let monthIndex = Math.floor(dayInYear / daysPerMonth);
  if (monthIndex < 0) monthIndex = 0;
  if (monthIndex > monthsPerYear - 1) monthIndex = monthsPerYear - 1;

  const dayInMonth = dayInYear - monthIndex * daysPerMonth;

  const month = monthIndex + 1;
  const day = Math.floor(dayInMonth) + 1;

  return { beat, step, day, month, year };
}

function formatBeatStepLabel(v: BeatStepDMY): string {
  return `${fmt2(v.beat)}:${fmt2(v.step)}`;
}

function formatDMYLabel(v: BeatStepDMY): string {
  return `D${v.day}/M${v.month}/Y${v.year}`;
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
    const m = momentFromPulse(now.pulse);
    const pulse = readNum(m, "pulse") ?? 0;
    const pulseStr = formatPulse(pulse);
    const bsd = computeBeatStepDMY({ pulse });

    return {
      pulse,
      pulseStr,
      beatStepDMY: bsd,
      beatStepLabel: formatBeatStepLabel(bsd),
      dmyLabel: formatDMYLabel(bsd),
      chakraDay: m.chakraDay,
    };
  }, [now.pulse]);

  const neonTextStyle = useMemo<CSSProperties>(
    () => ({
      color: "var(--accent-color)",
      textShadow: "0 0 14px rgba(0, 255, 255, 0.22), 0 0 28px rgba(0, 255, 255, 0.12)",
    }),
    [],
  );

  const neonTextStyleHalf = useMemo<CSSProperties>(
    () => ({
      color: "var(--accent-color)",
      textShadow: "0 0 14px rgba(0, 255, 255, 0.22), 0 0 28px rgba(0, 255, 255, 0.12)",
      fontSize: "0.5em",
      lineHeight: 1.05,
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
          <div className="live-meta">
            <span className="mono" style={neonTextStyle}>
              ☤KAI
            </span>
          </div>

          <div className="live-meta">
            <span className="mono" style={neonTextStyle}>
              {snap.pulseStr}
            </span>
          </div>

          <div className="live-sub">
            <span className="mono" style={neonTextStyleHalf}>
              <span className="kai-num kai-num--ark">{snap.beatStepLabel}</span>{" "}
              <span aria-hidden="true" style={{ opacity: 0.7 }}>
                •
              </span>{" "}
              <span className="kai-tag">D</span>
              <span className="kai-num kai-num--chakra">{snap.beatStepDMY.day}</span>
              <span className="kai-sep">/</span>
              <span className="kai-tag">M</span>
              <span className="kai-num kai-num--month">{snap.beatStepDMY.month}</span>
              <span className="kai-sep">/</span>
              <span className="kai-tag">Y</span>
              <span className="kai-num">{snap.beatStepDMY.year}</span>
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}

export const TopBar = (props: TopBarProps) => {
  const { actions, state } = useSigilMarketsUi();
  const navigate = useNavigate();
  const BREATH_S = 3 + Math.sqrt(5);
  const BREATH_MS = BREATH_S * 1000;
  const BREATHS_PER_DAY = 17_491.270421;

  const sticky = useStickyHeader(
    props.scrollMode === "container"
      ? { mode: "container", containerRef: props.scrollRef ?? undefined }
      : { mode: "window" },
  );

  const cls = useMemo(() => cx("sm-topbar", sticky.t > 0.02 && "is-scrolled"), [sticky.t]);

  const currentMarketId = state.route.view === "market" ? state.route.marketId : null;
  const canSeal = true;

  const handleOpenKlock = useCallback(() => {
    navigate("/klock", { state: { openDetails: true } });
  }, [navigate]);

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
