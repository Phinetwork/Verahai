// src/pages/sigilExplorer/tree/buildForest.ts
"use client";

import type { Registry, SigilSharePayloadLoose, ContentKind } from "../types";
import type { SigilNode, BranchSummary } from "./types";

import {
  canonicalizeUrl,
  browserViewUrl,
  extractPayloadFromUrl,
  parseHashFromUrl,
  isPTildeUrl,
  contentKindForUrl,
  contentIdFor,
  momentKeyFor,
  pickPrimaryUrl,
  scoreUrlForView,
  getOriginUrl,
} from "../url";

import { byKaiTime } from "../format";
import { getTransferMoveFromPayload } from "../transfers";

type ContentEntry = {
  id: string;
  payload: SigilSharePayloadLoose;
  urls: Set<string>;
  primaryUrl: string;
  kind: ContentKind;
  momentKey: string;
  parentId?: string;
  originId: string;
  momentParentId: string;
};

type ContentAgg = {
  payload: SigilSharePayloadLoose;
  urls: Set<string>;
  kind: ContentKind;
  momentKey: string;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function readStringField(obj: unknown, key: string): string | undefined {
  if (!isRecord(obj)) return undefined;
  const v = obj[key];
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

function readTransferDirection(value: unknown): "send" | "receive" | null {
  if (typeof value !== "string") return null;
  const t = value.trim().toLowerCase();
  if (!t) return null;
  if (t.includes("receive") || t.includes("received") || t.includes("inhale")) return "receive";
  if (t.includes("send") || t.includes("sent") || t.includes("exhale")) return "send";
  return null;
}

function hasTransferHints(payload: SigilSharePayloadLoose): boolean {
  const record = payload as Record<string, unknown>;
  const feed = isRecord(record.feed) ? (record.feed as Record<string, unknown>) : null;
  const readDir = (src: Record<string, unknown> | null) =>
    src
      ? readTransferDirection(src.transferDirection) ||
        readTransferDirection(src.transferMode) ||
        readTransferDirection(src.transferKind) ||
        readTransferDirection(src.phiDirection)
      : null;
  const hasDir = !!(readDir(record) ?? readDir(feed));
  const hasNonce = Boolean(
    typeof record.transferNonce === "string" ||
      typeof record.nonce === "string" ||
      typeof record.transferToken === "string" ||
      typeof record.token === "string" ||
      (feed &&
        (typeof feed.transferNonce === "string" ||
          typeof feed.nonce === "string" ||
          typeof feed.transferToken === "string" ||
          typeof feed.token === "string")),
  );
  const hasParent = Boolean(
    typeof record.parentUrl === "string" ||
      typeof record.parentHash === "string" ||
      typeof record.parentCanonical === "string" ||
      (feed &&
        (typeof feed.parentUrl === "string" ||
          typeof feed.parentHash === "string" ||
          typeof feed.parentCanonical === "string")),
  );

  return hasDir || hasNonce || hasParent;
}

function isRootCandidate(entry: { kind: ContentKind; payload: SigilSharePayloadLoose; primaryUrl: string }): boolean {
  if (entry.kind !== "post") return false;
  if (!parseHashFromUrl(entry.primaryUrl)) return false;
  if (getTransferMoveFromPayload(entry.payload)) return false;
  return !hasTransferHints(entry.payload);
}

function buildContentIndex(reg: Registry): Map<string, ContentEntry> {
  const urlToContentId = new Map<string, string>();
  const idToAgg = new Map<string, ContentAgg>();

  for (const [rawUrl, payload] of reg) {
    const url = canonicalizeUrl(rawUrl);
    const kind = contentKindForUrl(url);

    const cid = contentIdFor(url, payload);
    const mkey = momentKeyFor(url, payload);

    urlToContentId.set(url, cid);

    const prev = idToAgg.get(cid);
    if (!prev) {
      idToAgg.set(cid, { payload, urls: new Set([url]), kind, momentKey: mkey });
      continue;
    }

    if (byKaiTime(payload, prev.payload) > 0) prev.payload = payload;
    prev.urls.add(url);

    const pm = prev.momentKey;
    const nm = mkey;
    if (pm.startsWith("u:") && !nm.startsWith("u:")) prev.momentKey = nm;
    if (pm.startsWith("h:") && (nm.startsWith("k:") || nm.startsWith("sig:") || nm.startsWith("tok:"))) {
      prev.momentKey = nm;
    }
  }

  type EntryPre = {
    id: string;
    payload: SigilSharePayloadLoose;
    urls: Set<string>;
    primaryUrl: string;
    kind: ContentKind;
    momentKey: string;
  };

  const entries = new Map<string, EntryPre>();

  for (const [id, agg] of idToAgg) {
    const urls = Array.from(agg.urls);
    const primaryUrl = pickPrimaryUrl(urls, agg.kind);

    entries.set(id, {
      id,
      payload: agg.payload,
      urls: agg.urls,
      primaryUrl,
      kind: agg.kind,
      momentKey: agg.momentKey,
    });
  }

  const momentGroups = new Map<string, string[]>();
  for (const e of entries.values()) {
    const k = e.momentKey;
    if (!momentGroups.has(k)) momentGroups.set(k, []);
    momentGroups.get(k)!.push(e.id);
  }

  const momentParentByMoment = new Map<string, string>();
  const momentParentById = new Map<string, string>();
  const momentParentByUrl = new Map<string, string>();
  const entryByHash = new Map<string, string>();

  for (const e of entries.values()) {
    const hash = parseHashFromUrl(e.primaryUrl);
    if (hash && !entryByHash.has(hash)) entryByHash.set(hash, e.id);
  }

  for (const [mk, ids] of momentGroups) {
    const candidates = ids.map((id) => entries.get(id)).filter(Boolean) as EntryPre[];

    const postParents = candidates.filter((c) => c.kind === "post");
    let parent: EntryPre | undefined;

    if (postParents.length > 0) {
      parent = postParents
        .slice()
        .sort((a, b) => scoreUrlForView(b.primaryUrl, "post") - scoreUrlForView(a.primaryUrl, "post"))[0];
    } else {
      parent = candidates
        .slice()
        .sort((a, b) => scoreUrlForView(b.primaryUrl, b.kind) - scoreUrlForView(a.primaryUrl, a.kind))[0];
    }

    const parentId = parent?.id ?? ids[0]!;
    momentParentByMoment.set(mk, parentId);

    for (const id of ids) momentParentById.set(id, parentId);
    for (const id of ids) {
      const e = entries.get(id);
      if (!e) continue;
      for (const u of e.urls) momentParentByUrl.set(u, parentId);
    }
  }

  const momentOriginByParent = new Map<string, string>();
  const rootByHash = new Map<string, string>();

  for (const e of entries.values()) {
    if (!isRootCandidate(e)) continue;
    const hash = parseHashFromUrl(e.primaryUrl);
    if (!hash) continue;
    if (!rootByHash.has(hash)) rootByHash.set(hash, e.id);
  }

  for (const e of entries.values()) {
    const mp = momentParentById.get(e.id) ?? e.id;
    if (e.id !== mp) continue;

    const originUrlRaw = readStringField(e.payload as unknown, "originUrl");
    const originUrl = originUrlRaw ? canonicalizeUrl(originUrlRaw) : getOriginUrl(e.primaryUrl) ?? e.primaryUrl;

    const originHash = parseHashFromUrl(originUrl);
    const originAnyId = urlToContentId.get(originUrl) ?? (originHash ? entryByHash.get(originHash) : undefined);
    const rootOverride = originHash ? rootByHash.get(originHash) : undefined;
    const originMomentParent = rootOverride ?? originAnyId ?? momentParentByUrl.get(originUrl);

    momentOriginByParent.set(mp, originMomentParent ?? mp);
  }

  const out = new Map<string, ContentEntry>();

  for (const e of entries.values()) {
    const momentParentId = momentParentById.get(e.id) ?? e.id;
    const originId = momentOriginByParent.get(momentParentId) ?? momentParentId;

    let parentId: string | undefined;

    const parentUrlRaw = readStringField(e.payload as unknown, "parentUrl");
    if (parentUrlRaw) {
      const parentUrl = canonicalizeUrl(parentUrlRaw);
      const parentHash = parseHashFromUrl(parentUrl);
      const parentAnyId = urlToContentId.get(parentUrl) ?? (parentHash ? entryByHash.get(parentHash) : undefined);
      const parentMomentParent = parentAnyId ?? momentParentByUrl.get(parentUrl);

      if (parentMomentParent && parentMomentParent !== e.id) {
        parentId = parentMomentParent;
      }
    }

    if (!parentId && e.id !== momentParentId) {
      parentId = momentParentId;
    }

    out.set(e.id, {
      id: e.id,
      payload: e.payload,
      urls: e.urls,
      primaryUrl: e.primaryUrl,
      kind: e.kind,
      momentKey: e.momentKey,
      parentId,
      originId,
      momentParentId,
    });
  }

  void momentParentByMoment; // intentional: kept for conceptual clarity
  return out;
}

function contentChildrenOf(parentId: string, idx: Map<string, ContentEntry>): string[] {
  const out: string[] = [];
  for (const [id, e] of idx) {
    if (e.parentId === parentId) out.push(id);
  }
  out.sort((a, b) => byKaiTime(idx.get(b)!.payload, idx.get(a)!.payload)); // DESC
  return out;
}

function buildContentTree(rootId: string, idx: Map<string, ContentEntry>, seen = new Set<string>()): SigilNode | null {
  const e = idx.get(rootId);
  if (!e) return null;

  if (seen.has(rootId)) {
    return { id: e.id, url: e.primaryUrl, urls: Array.from(e.urls), payload: e.payload, children: [] };
  }
  seen.add(rootId);

  const kids = contentChildrenOf(rootId, idx)
    .map((cid) => buildContentTree(cid, idx, seen))
    .filter(Boolean) as SigilNode[];

  return { id: e.id, url: e.primaryUrl, urls: Array.from(e.urls), payload: e.payload, children: kids };
}

function summarizeBranch(root: SigilNode): { nodeCount: number; latest: SigilSharePayloadLoose } {
  let nodeCount = 0;
  let latest = root.payload;

  const walk = (node: SigilNode) => {
    nodeCount += 1;
    if (byKaiTime(node.payload, latest) > 0) latest = node.payload;
    node.children.forEach(walk);
  };

  walk(root);
  return { nodeCount, latest };
}

export function buildForest(reg: Registry): SigilNode[] {
  const idx = buildContentIndex(reg);

  const groups = new Map<string, string[]>();
  for (const [id, e] of idx) {
    const o = e.originId;
    if (!groups.has(o)) groups.set(o, []);
    groups.get(o)!.push(id);
  }

  const decorated: BranchSummary[] = [];

  for (const originId of groups.keys()) {
    const tree = buildContentTree(originId, idx);
    if (!tree) continue;
    const summary = summarizeBranch(tree);
    decorated.push({ root: tree, nodeCount: summary.nodeCount, latest: summary.latest });
  }

  decorated.sort((a, b) => {
    const timeCmp = byKaiTime(b.latest, a.latest);
    if (timeCmp !== 0) return timeCmp;
    if (b.nodeCount !== a.nodeCount) return b.nodeCount - a.nodeCount;
    return byKaiTime(b.root.payload, a.root.payload);
  });

  return decorated.map((d) => d.root);
}

// Used elsewhere in your UI: “canonical hash from node” fallbacks
export function resolveCanonicalHashFromNode(node: SigilNode): string | undefined {
  const payload = node.payload as unknown;
  if (isRecord(payload) && typeof payload.canonicalHash === "string") return payload.canonicalHash;

  const primaryHash = parseHashFromUrl(node.url);
  if (primaryHash) return primaryHash;

  for (const url of node.urls) {
    const hash = parseHashFromUrl(url);
    if (hash) return hash;

    const embedded = extractPayloadFromUrl(url);
    if (!embedded) continue;
    const ep = embedded as unknown;
    if (isRecord(ep) && typeof ep.canonicalHash === "string") return ep.canonicalHash;
  }

  return undefined;
}

export function visibleUrlVariants(node: SigilNode): string[] {
  return node.urls.filter((u) => !isPTildeUrl(u)).map((u) => browserViewUrl(u));
}