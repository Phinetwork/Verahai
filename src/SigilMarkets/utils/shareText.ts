// SigilMarkets/utils/shareText.ts
/* eslint-disable @typescript-eslint/consistent-type-definitions */

import type { Market, MarketOutcome } from "../types/marketTypes";
import type { PositionRecord } from "../types/sigilPositionTypes";
import type { ProphecyRecord } from "../state/feedStore";
import { shortKey } from "./format";

export type ShareContext = Readonly<{
  appName?: string; // "Sigil Markets"
  baseUrl?: string; // "https://phi.network"
}>;

const d = (v: unknown): string => String(v ?? "");

/** Use the imported MarketOutcome type explicitly (prevents drift in copy contracts). */
const fmtOutcome = (o: MarketOutcome): string => {
  // Keep it deterministic and human-readable.
  // (MarketOutcome = "YES" | "NO" | "VOID" in this domain)
  if (o === "VOID") return "VOID";
  return o; // "YES" | "NO"
};

export const shareTextForMarket = (m: Market, ctx?: ShareContext): string => {
  const app = ctx?.appName ?? "Sigil Markets";
  const url = ctx?.baseUrl ? `${ctx.baseUrl}/#market=${encodeURIComponent(m.def.id as unknown as string)}` : "";
  return [
    `${m.def.question}`,
    `• category: ${d(m.def.category)}`,
    `• close: pulse ${m.def.timing.closePulse}`,
    `— ${app}`,
    url,
  ]
    .filter(Boolean)
    .join("\n");
};

export const shareTextForPosition = (p: PositionRecord, marketQuestion?: string, ctx?: ShareContext): string => {
  const app = ctx?.appName ?? "Sigil Markets";
  const url = ctx?.baseUrl ? `${ctx.baseUrl}/#position=${encodeURIComponent(p.id as unknown as string)}` : "";
  const q = marketQuestion ?? "Prophecy";
  return [
    `Position • ${p.entry.side}`,
    q,
    `• opened: pulse ${p.entry.openedAt.pulse}`,
    `• stake μΦ: ${d(p.entry.stakeMicro)}`,
    `• shares μ: ${d(p.entry.sharesMicro)}`,
    p.resolution
      ? `• outcome: ${fmtOutcome(p.resolution.outcome as MarketOutcome)} @ p${p.resolution.resolvedPulse}`
      : `• outcome: pending`,
    `— ${app}`,
    url,
  ]
    .filter(Boolean)
    .join("\n");
};

export const shareTextForProphecy = (p: ProphecyRecord, marketQuestion?: string, ctx?: ShareContext): string => {
  const app = ctx?.appName ?? "Sigil Markets";
  const q = marketQuestion ?? "Prophecy";
  const author = shortKey(p.author.userPhiKey as unknown as string);
  return [
    `Prophecy sealed • ${p.side}`,
    q,
    `• sealed: pulse ${p.createdAt.pulse}`,
    `• by: ${author}`,
    p.resolution
      ? `• result: ${p.resolution.status} (${fmtOutcome(p.resolution.outcome as MarketOutcome)})`
      : `• result: pending`,
    `— ${app}`,
  ]
    .filter(Boolean)
    .join("\n");
};

export const shareTextForResolution = (m: Market, ctx?: ShareContext): string => {
  const app = ctx?.appName ?? "Sigil Markets";
  const r = m.state.resolution;
  const url = ctx?.baseUrl ? `${ctx.baseUrl}/#resolution=${encodeURIComponent(m.def.id as unknown as string)}` : "";
  if (!r) {
    return [`Resolution pending`, `${m.def.question}`, `— ${app}`, url].filter(Boolean).join("\n");
  }
  return [
    `Resolution • ${fmtOutcome(r.outcome as MarketOutcome)}`,
    `${m.def.question}`,
    `• resolved: pulse ${r.resolvedPulse}`,
    `• oracle: ${m.def.rules.oracle.provider}`,
    `— ${app}`,
    url,
  ]
    .filter(Boolean)
    .join("\n");
};
