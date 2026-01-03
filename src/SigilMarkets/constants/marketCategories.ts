// SigilMarkets/constants/marketCategories.ts
"use client";

import type { MarketCategory } from "../types/marketTypes";

export const MARKET_CATEGORIES: readonly MarketCategory[] = [
  "weather",
  "sports",
  "finance",
  "crypto",
  "tech",
  "world",
  "culture",
  "other",
];

const CATEGORY_LABELS: Record<MarketCategory, string> = {
  weather: "Weather",
  sports: "Sports",
  finance: "Finance",
  crypto: "Crypto",
  tech: "Tech",
  world: "World",
  culture: "Culture",
  other: "Other",
};

export const labelForCategory = (category: MarketCategory): string => CATEGORY_LABELS[category] ?? category;
