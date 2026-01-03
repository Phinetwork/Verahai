import React, { useRef, useEffect, useMemo } from "react";
import { CENTER, PHI, SPACE, lissajousPath } from "./constants";
import { PULSE_MS } from "../../utils/kai_pulse";

type Props = {
  uid: string;
  size: number;
  phaseColor: string;
  outerRingText: string;
  innerRingText: string;
  verified: boolean;
  zkScheme?: string;
  zkPoseidonHash?: string;
  proofPresent: boolean;
  animate: boolean;
  prefersReduce: boolean;
};

const ZKGlyph: React.FC<Props> = ({
  uid,
  size,
  phaseColor,
  outerRingText,
  innerRingText,
  verified,
  zkScheme,
  zkPoseidonHash,
  proofPresent,
  animate,
  prefersReduce,
}) => {
  const rOuter = SPACE * 0.34;
  const rInner = rOuter / PHI;
  const rPetal = rInner * 0.96;
  const petalScale = rPetal / (SPACE / 2);

  const phiRingId = `${uid}-zk-phi-ring`;
  const binRingId = `${uid}-zk-bin-ring`;
  const gradId = `${uid}-zk-grad`;
  const petalUseId = `${uid}-zk-petal-def`;

  const wPetal = Math.max(1.0, (size ?? 240) * 0.008);
  const wRing = Math.max(0.9, (size ?? 240) * 0.007);
  const wGlow = Math.max(1.2, (size ?? 240) * 0.009);
  const doAnim = animate && !prefersReduce;

  const petalDefRef = useRef<SVGPathElement | null>(null);

  useEffect(() => {
    if (!doAnim) return;
    const el = petalDefRef.current;
    if (!el) return;

    let raf = 0;
    const t0 = performance.now();

    const secPerPulse = PULSE_MS / 1000;
    const fA = (1 / secPerPulse) * (PHI * 0.21);
    const fB = (1 / secPerPulse) * ((PHI - 1) * 0.17);
    const fD = (1 / secPerPulse) * (Math.SQRT2 * 0.15);

    const a0 = 5,
      b0 = 8,
      aAmp = 1.6,
      bAmp = 1.2;
    const d0 = Math.PI / 2,
      dAmp = Math.PI / 3;

    const render = () => {
      const t = (performance.now() - t0) / 1000;
      const aDyn = a0 + aAmp * (0.5 + 0.5 * Math.sin(2 * Math.PI * fA * t));
      const bDyn = b0 + bAmp * (0.5 + 0.5 * Math.sin(2 * Math.PI * fB * t + 1.234));
      const deltaDyn = d0 + dAmp * Math.sin(2 * Math.PI * fD * t + 0.777);
      el.setAttribute("d", lissajousPath(aDyn, bDyn, deltaDyn));
      raf = requestAnimationFrame(render);
    };

    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [doAnim]);

  // ─────────────────────────────────────────────────────────────
  // Φ RING TEXT — export-safe (no textPath fallback ever)
  // ─────────────────────────────────────────────────────────────

  const mono = `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  const uiSans = `ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial`;

  const outerFont = Math.max(8, (size ?? 240) * 0.026);
  const innerFont = Math.max(7, (size ?? 240) * 0.022);
  const statusFont = Math.max(10, (size ?? 240) * 0.042);
  const metaFont = Math.max(8, (size ?? 240) * 0.024);

  const approxCharW = (fs: number) => fs * 0.62; // good mono approximation
  const maxCharsForRadius = (radius: number, fs: number) => {
    const circ = 2 * Math.PI * radius;
    return Math.max(48, Math.floor(circ / approxCharW(fs)));
  };

  const condenseSeal = (raw: string, maxLen: number) => {
    const s = (raw ?? "").trim();
    if (!s) return "";

    // Prefer showing the *seal fields*, not the whole URL/payload.
    // Deterministic pick order:
    const wanted = ["sig=", "b58=", "len=", "crc32=", "creator=", "zk=", "alg=", "day=", "beat=", "hz=", "poseidon="];

    const parts = s.split(" · ").map((p) => p.trim()).filter(Boolean);
    const kept = parts.filter((p) => wanted.some((w) => p.startsWith(w)));

    const out = (kept.length ? kept : parts).join(" · ");
    if (out.length <= maxLen) return out;
    return out.slice(0, Math.max(0, maxLen - 1)).trimEnd() + "…";
  };

  const outerDisplay = useMemo(() => {
    const maxLen = maxCharsForRadius(rOuter, outerFont);
    return condenseSeal(outerRingText, maxLen);
  }, [outerRingText, rOuter, outerFont]);

  const innerDisplay = useMemo(() => {
    const maxLen = maxCharsForRadius(rInner, innerFont);
    return condenseSeal(innerRingText, maxLen);
  }, [innerRingText, rInner, innerFont]);

  const renderRingText = (
    text: string,
    radius: number,
    fontFamily: string,
    fontSize: number,
    fill: string,
    opacity: number
  ) => {
    const chars = Array.from(text);
    if (!chars.length) return null;

    // Start at 12 o’clock, tangent direction
    const start = -Math.PI / 2;
    const n = chars.length;

    const stroke = "#001014";
    const strokeW = Math.max(0.45, fontSize * 0.085);

    return (
      <g aria-hidden="true" pointerEvents="none">
        {chars.map((ch, i) => {
          const t = i / n;
          const ang = start + t * Math.PI * 2;
          const x = CENTER + radius * Math.cos(ang);
          const y = CENTER + radius * Math.sin(ang);
          const deg = (ang * 180) / Math.PI + 90; // tangent

          return (
            <text
              key={`${i}-${ch}`}
              transform={`translate(${x} ${y}) rotate(${deg})`}
              fontFamily={fontFamily}
              fontSize={fontSize}
              fill={fill}
              opacity={opacity}
              textAnchor="middle"
              dominantBaseline="middle"
              letterSpacing="0"
              stroke={stroke}
              strokeOpacity="0.6"
              strokeWidth={strokeW}
              paintOrder="stroke"
            >
              {ch}
            </text>
          );
        })}
      </g>
    );
  };

  const statusLabel = verified ? "VERIFIED" : proofPresent ? "PROOF PRESENT" : "UNVERIFIED";
  const schemeLabel = (zkScheme || "groth16-poseidon").toUpperCase();
  const poseidonLabel = zkPoseidonHash
    ? `POSEIDON ${String(zkPoseidonHash).slice(0, 16)}…`
    : "POSEIDON";
  const statusY = CENTER - statusFont / PHI;
  const schemeY = CENTER + statusFont / PHI;
  const poseidonY = schemeY + metaFont / PHI;

  return (
    <g
      id={`${uid}-zk-glyph`}
      aria-label="Atlantean zero-knowledge verification glyph"
      pointerEvents="none"
    >
      <defs>
        <radialGradient id={gradId} cx="50%" cy="50%" r="60%">
          <stop offset="0%" stopColor={phaseColor} stopOpacity="0.85">
            {doAnim && (
              <>
                <animate attributeName="stop-opacity" values=".55;.85;.55" dur={`${PULSE_MS}ms`} repeatCount="indefinite" />
                <animate attributeName="stop-color" values={`${phaseColor};#00FFD0;${phaseColor}`} dur={`${PULSE_MS * 3}ms`} repeatCount="indefinite" />
              </>
            )}
          </stop>
          <stop offset="55%" stopColor={phaseColor} stopOpacity="0.55">
            {doAnim && (
              <animate attributeName="stop-color" values={`${phaseColor};#00FFD0;${phaseColor}`} dur={`${PULSE_MS * 3}ms`} repeatCount="indefinite" />
            )}
          </stop>
          <stop offset="100%" stopColor="#00FFD0" stopOpacity="0.25">
            {doAnim && (
              <animate attributeName="stop-opacity" values=".15;.35;.15" dur={`${PULSE_MS}ms`} repeatCount="indefinite" />
            )}
          </stop>
        </radialGradient>

        {/* keep these paths (harmless) in case anything else wants them */}
        <path
          id={phiRingId}
          d={`M ${CENTER} ${CENTER - rOuter} a ${rOuter} ${rOuter} 0 1 1 0 ${2 * rOuter} a ${rOuter} ${rOuter} 0 1 1 0 -${2 * rOuter}`}
          fill="none"
        />
        <path
          id={binRingId}
          d={`M ${CENTER} ${CENTER - rInner} a ${rInner} ${rInner} 0 1 1 0 ${2 * rInner} a ${rInner} ${rInner} 0 1 1 0 -${2 * rInner}`}
          fill="none"
        />

        <path id={petalUseId} ref={petalDefRef} d={lissajousPath(5, 8, Math.PI / 2)} />
      </defs>

      <circle
        cx={CENTER}
        cy={CENTER}
        r={rOuter}
        fill="none"
        stroke={`url(#${gradId})`}
        strokeWidth={wGlow}
        opacity="0.5"
        vectorEffect="non-scaling-stroke"
      />

      {Array.from({ length: 12 }, (_, i) => (
        <use
          key={i}
          href={`#${petalUseId}`}
          transform={`translate(${CENTER},${CENTER}) scale(${petalScale}) rotate(${i * 30}) translate(${-CENTER},${-CENTER})`}
          stroke={`url(#${gradId})`}
          strokeWidth={wPetal}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.42"
          fill="none"
          vectorEffect="non-scaling-stroke"
        />
      ))}

      <g opacity="0.25">
        <circle cx={CENTER - rInner / 2.2} cy={CENTER} r={rInner * 0.86} fill="none" stroke={phaseColor} strokeWidth={wRing} />
        <circle cx={CENTER + rInner / 2.2} cy={CENTER} r={rInner * 0.86} fill="none" stroke="#00FFD0" strokeWidth={wRing} />
      </g>

      <circle
        cx={CENTER}
        cy={CENTER}
        r={rInner}
        fill="none"
        stroke={`url(#${gradId})`}
        strokeWidth={wRing}
        opacity="0.55"
        vectorEffect="non-scaling-stroke"
      />

      {/* Φ ring (mono, engraved) */}
      {outerDisplay &&
        renderRingText(
          outerDisplay,
          rOuter,
          mono,
          outerFont,
          phaseColor,
          0.33
        )}

      {/* binary / seal ring (sans, lighter) */}
      {innerDisplay &&
        renderRingText(
          innerDisplay,
          rInner,
          uiSans,
          innerFont,
          "#00FFD0",
          0.28
        )}

      <g
        aria-label={`ZK status ${statusLabel.toLowerCase()}`}
        fontFamily={uiSans}
        textAnchor="middle"
        dominantBaseline="middle"
      >
        <text
          x={CENTER}
          y={statusY}
          fontSize={statusFont}
          fill={verified ? "#00FFD0" : "#99a9b4"}
          letterSpacing="0.12em"
          opacity={0.92}
        >
          {statusLabel}
        </text>
        <text
          x={CENTER}
          y={schemeY}
          fontSize={metaFont}
          fill={phaseColor}
          letterSpacing="0.18em"
          opacity={0.75}
        >
          {schemeLabel}
        </text>
        <text
          x={CENTER}
          y={poseidonY}
          fontSize={metaFont * 0.92}
          fill="#00FFD0"
          letterSpacing="0.1em"
          opacity={0.65}
        >
          {poseidonLabel}
        </text>
      </g>
    </g>
  );
};

export default ZKGlyph;
