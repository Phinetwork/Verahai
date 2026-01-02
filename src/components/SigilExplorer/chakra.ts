// src/components/SigilExplorer/chakra.ts
/* ─────────────────────────────────────────────────────────────────────
   Chakra tint system (per node)
────────────────────────────────────────────────────────────────────── */

import type { CSSProperties } from "react";

export type ChakraKey = "root" | "sacral" | "solar" | "heart" | "throat" | "thirdEye" | "crown";

export const CHAKRA_COLORS: Record<ChakraKey, string> = {
  root: "#ff3b3b",
  sacral: "#ff8a3d",
  solar: "#ffd54a",
  heart: "#3dff9a",
  throat: "#46d3ff",
  thirdEye: "#6b6cff",
  crown: "#c18bff",
};

export function normalizeChakraKey(v: unknown): ChakraKey | null {
  if (typeof v !== "string") return null;
  const raw = v.trim().toLowerCase();
  if (!raw) return null;

  if (raw.includes("root")) return "root";
  if (raw.includes("sacral")) return "sacral";
  if (raw.includes("solar") || raw.includes("plexus") || raw.includes("sun")) return "solar";
  if (raw.includes("heart")) return "heart";
  if (raw.includes("throat")) return "throat";
  if (raw.includes("third") || raw.includes("eye") || raw.includes("indigo")) return "thirdEye";
  if (raw.includes("crown") || raw.includes("krown") || raw.includes("violet")) return "crown";

  if (raw === "1") return "root";
  if (raw === "2") return "sacral";
  if (raw === "3") return "solar";
  if (raw === "4") return "heart";
  if (raw === "5") return "throat";
  if (raw === "6") return "thirdEye";
  if (raw === "7") return "crown";

  return null;
}

export function chakraTintStyle(chakraDay: unknown): CSSProperties {
  const key = normalizeChakraKey(chakraDay);
  const tint = key ? CHAKRA_COLORS[key] : "var(--sx-accent)";
  return { ["--sx-chakra" as unknown as string]: tint } as CSSProperties;
}
