// src/components/SigilExplorer/remotePull.ts
"use client";

import { apiFetchJsonWithFailover, API_URLS_PATH } from "./apiClient";
import { addUrl, persistRegistryToStorage, memoryRegistry } from "./registryStore";
import { canonicalizeUrl } from "./url";

const URLS_PAGE_LIMIT = 5000;
const URLS_MAX_PAGES_PER_SYNC = 24; // safety cap (5000*24 = 120k)

type ApiUrlsPageResponse = {
  status: "ok";
  state_seal: string;
  total: number;
  offset: number;
  limit: number;
  urls: string[];
};

export async function pullAndImportRemoteUrls(
  signal: AbortSignal,
): Promise<{ imported: number; remoteSeal?: string; remoteTotal?: number; pulled: boolean }> {
  let imported = 0;
  let remoteSeal: string | undefined;
  let remoteTotal: number | undefined;
  let pulled = false;

  for (let page = 0; page < URLS_MAX_PAGES_PER_SYNC; page++) {
    const offset = page * URLS_PAGE_LIMIT;

    const r = await apiFetchJsonWithFailover<ApiUrlsPageResponse>(
      (base) => {
        const url = new URL(API_URLS_PATH, base);
        url.searchParams.set("offset", String(offset));
        url.searchParams.set("limit", String(URLS_PAGE_LIMIT));
        return url.toString();
      },
      { method: "GET", signal, cache: "no-store" },
    );

    if (!r.ok) break;

    pulled = true;
    remoteSeal = r.value.state_seal;
    remoteTotal = r.value.total;

    const urls = r.value.urls;
    if (!Array.isArray(urls) || urls.length === 0) break;

    for (const u of urls) {
      if (typeof u !== "string") continue;
      const abs = canonicalizeUrl(u);
      if (memoryRegistry.has(abs)) continue;

      const changed = addUrl(abs, {
        includeAncestry: true,
        broadcast: false,
        persist: false,
        source: "remote",
        enqueueToApi: false,
      });

      if (changed) imported += 1;
    }

    if (urls.length < URLS_PAGE_LIMIT) break;
    if (remoteTotal != null && offset + urls.length >= remoteTotal) break;
  }

  if (imported > 0) persistRegistryToStorage();
  return { imported, remoteSeal, remoteTotal, pulled };
}
