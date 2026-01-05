// SigilMarkets/constants/marketCategories.ts
"use client";

import type { MarketCategory } from "../types/marketTypes";

export const MARKET_CATEGORIES: readonly MarketCategory[] = [
  "pulse",
  "kai",
  "calendar",
  "weather",
  "sports",
  "politics",
  "science",
  "local",
  "finance",
  "crypto",
  "tech",
  "world",
  "culture",
  "other",
];

const CATEGORY_LABELS: Record<MarketCategory, string> = {
  pulse: "Pulse",
  kai: "Kai",
  calendar: "Calendar",
  weather: "Weather",
  sports: "Sports",
  politics: "Politics",
  science: "Science",
  local: "Local",
  finance: "Finance",
  crypto: "Crypto",
  tech: "Tech",
  world: "World",
  culture: "Culture",
  other: "Other",
};

export const normalizeMarketCategory = (category: MarketCategory): MarketCategory =>
  category === "markets" ? "finance" : category;

export const labelForCategory = (category: MarketCategory): string => {
  const normalized = normalizeMarketCategory(category);
  return CATEGORY_LABELS[normalized] ?? normalized;
};
