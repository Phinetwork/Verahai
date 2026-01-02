// InhaleUploadIcon.tsx
import React from "react";

export const InhaleUploadIcon: React.FC<{
  size?: number;
  color?: string;
  label?: string;
}> = ({ size = 22, color = "currentColor", label = "Inhale & Upload" }) => (
  <div
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: "8px",
      cursor: "pointer",
      userSelect: "none",
      transition: "transform 0.35s ease",
    }}
    className="inhale-upload"
    title={label}
  >
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      aria-hidden="true"
      style={{
        display: "inline-block",
        verticalAlign: "middle",
        filter: "drop-shadow(0 0 6px rgba(55,255,228,0.25))",
      }}
    >
      {/* Halo breathing ring */}
      <circle
        cx="32"
        cy="32"
        r="28"
        stroke={color}
        strokeWidth="2"
        fill="none"
        strokeDasharray="4 6"
        opacity="0.6"
      >
        <animateTransform
          attributeName="transform"
          type="rotate"
          values="0 32 32;360 32 32"
          dur="6s"
          repeatCount="indefinite"
        />
      </circle>

      {/* Upward inhale flow */}
      <path
        d="M32 44V18"
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <animate
          attributeName="stroke-dasharray"
          values="0,50;50,0;0,50"
          dur="3.236s"
          repeatCount="indefinite"
        />
      </path>

      {/* Breath arrow */}
      <polyline
        points="22,26 32,16 42,26"
        fill="none"
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <animateTransform
          attributeName="transform"
          type="translate"
          values="0 2;0 -2;0 2"
          dur="2.618s"
          repeatCount="indefinite"
        />
      </polyline>

      {/* Upload bar */}
      <rect
        x="22"
        y="46"
        width="20"
        height="4"
        rx="2"
        fill={color}
        opacity="0.7"
      >
        <animate
          attributeName="opacity"
          values="0.5;1;0.5"
          dur="4s"
          repeatCount="indefinite"
        />
      </rect>
    </svg>

    <span
      style={{
        fontFamily: "var(--font-sans, 'Inter', sans-serif)",
        fontWeight: 600,
        letterSpacing: "0.03em",
        color,
        fontSize: "0.9rem",
      }}
    >
    </span>
  </div>
);

export default InhaleUploadIcon;
