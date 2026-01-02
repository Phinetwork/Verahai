/*
  Internal Sigil API (TSX)
  Offline, in-memory implementation mirroring app/api/routes.py + core/*.py logic.
*/

export type SigilPayloadLoose = {
  pulse?: number | null;
  beat?: number | null;
  stepIndex?: number | null;
  chakraDay?: string | null;
  kaiSignature?: string | null;
  originUrl?: string | null;
  parentUrl?: string | null;
  userPhiKey?: string | null;
  phiKey?: string | null;
  phikey?: string | null;
  [key: string]: unknown;
};

export type KaiMoment = {
  pulse: number;
  beat: number;
  stepIndex: number;
};

export type SigilEntry = {
  url: string;
  payload: SigilPayloadLoose;
  pulse: number;
  beat: number;
  stepIndex: number;
  chakraDay: string | null;
  kaiSignature: string | null;
  originUrl: string | null;
  parentUrl: string | null;
  userPhiKey: string | null;
  phiKey: string | null;
  phikey: string | null;
  id: string | null;
};

export type SigilState = {
  spec: "KKS-1.0";
  total_urls: number;
  latest: KaiMoment;
  state_seal: string;
  registry: SigilEntry[];
  urls: string[];
};

export type InhaleReport = {
  crystals_total: number;
  crystals_imported: number;
  crystals_failed: number;
  registry_urls: number;
  latest_pulse: number | null;
  errors: string[];
};

export type InhaleResponse = {
  status: "ok" | "error";
  files_received: number;
  crystals_total: number;
  crystals_imported: number;
  crystals_failed: number;
  registry_urls: number;
  latest_pulse: number | null;
  urls: string[] | null;
  state: SigilState | null;
  errors: string[];
};

export type ExhaleResponse = {
  status: "ok" | "error";
  mode: "urls" | "state";
  urls: string[] | null;
  state: SigilState | null;
};

export type UrlsPageResponse = {
  status: "ok";
  state_seal: string;
  total: number;
  offset: number;
  limit: number;
  urls: string[];
};

type UrlPayloadHit = {
  url_key: string;
  payload: SigilPayloadLoose;
};

type WitnessCtx = {
  chain: string[];
  originUrl?: string | null;
  parentUrl?: string | null;
};

type FileBlob = { name: string; bytes: Uint8Array };

const B64URL_RE = /^[A-Za-z0-9_-]+$/;
const STREAM_P_RE = /^\/stream\/p\/([^/]+)$/;
const P_TILDE_RE = /^\/p~([^/]+)$/;
const STREAM_P_TILDE_RE = /^\/stream\/p~([^/]+)$/;
const STREAM_C_RE = /^\/stream\/c\/([0-9a-fA-F]{16,})$/;
const WITNESS_ADD_MAX = 512;

const DEFAULT_MAX_BYTES_PER_FILE = 10_000_000;
const DEFAULT_MAX_INLINE_STATE_URLS = 10_000;
const DEFAULT_MAX_INLINE_URLS = 20_000;

const TEXT_ENCODER = new TextEncoder();

function normalizePayload(data: unknown): SigilPayloadLoose {
  if (!data || typeof data !== "object") {
    return {};
  }
  const d = { ...(data as Record<string, unknown>) };

  if (d.pulse === undefined && Number.isInteger(d.u)) {
    d.pulse = d.u as number;
  }
  if (d.beat === undefined && Number.isInteger(d.b)) {
    d.beat = d.b as number;
  }
  if (d.stepIndex === undefined && Number.isInteger(d.s)) {
    d.stepIndex = d.s as number;
  }
  if (d.chakraDay === undefined && typeof d.c === "string") {
    d.chakraDay = d.c;
  }
  if (d.stepIndex === undefined && Number.isInteger(d.step_index)) {
    d.stepIndex = d.step_index as number;
  }
  if (d.chakraDay === undefined && typeof d.chakra_day === "string") {
    d.chakraDay = d.chakra_day;
  }
  if (d.kaiSignature === undefined && typeof d.kai_signature === "string") {
    d.kaiSignature = d.kai_signature;
  }
  if (d.originUrl === undefined && typeof d.origin_url === "string") {
    d.originUrl = d.origin_url;
  }
  if (d.parentUrl === undefined && typeof d.parent_url === "string") {
    d.parentUrl = d.parent_url;
  }
  if (d.stepIndex === undefined && Number.isInteger(d.step)) {
    d.stepIndex = d.step as number;
  }

  return d as SigilPayloadLoose;
}

function safeInt(v: unknown): number {
  if (typeof v === "boolean") {
    return 0;
  }
  if (typeof v === "number") {
    if (Number.isNaN(v)) {
      return 0;
    }
    return Math.trunc(v);
  }
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) {
      return 0;
    }
    const f = Number(s);
    if (Number.isNaN(f)) {
      return 0;
    }
    return Math.trunc(f);
  }
  return 0;
}

function kaiTuple(payload: SigilPayloadLoose): [number, number, number] {
  return [safeInt(payload.pulse), safeInt(payload.beat), safeInt(payload.stepIndex)];
}

function kaiSortKeyDesc(payload: SigilPayloadLoose): [number, number, number] {
  return kaiTuple(payload);
}

function latestKai(payloads: SigilPayloadLoose[]): KaiMoment {
  let latest: [number, number, number] = [0, 0, 0];
  for (const p of payloads) {
    const kt = kaiTuple(p);
    if (compareKai(kt, latest) > 0) {
      latest = kt;
    }
  }
  return { pulse: latest[0], beat: latest[1], stepIndex: latest[2] };
}

function compareKai(a: [number, number, number], b: [number, number, number]): number {
  if (a[0] !== b[0]) return a[0] - b[0];
  if (a[1] !== b[1]) return a[1] - b[1];
  return a[2] - b[2];
}

function isMissing(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value as object).length === 0;
  return false;
}

function richnessScore(payload: SigilPayloadLoose): number {
  const d = payload as Record<string, unknown>;
  let score = 0;
  for (const [k, v] of Object.entries(d)) {
    if (isMissing(v)) continue;
    score += 1;
    if (["originUrl", "parentUrl", "kaiSignature", "userPhiKey", "phiKey", "phikey"].includes(k)) {
      score += 2;
    }
    if (["pulse", "beat", "stepIndex", "chakraDay"].includes(k)) {
      score += 1;
    }
  }
  return score;
}

function ensureBaseOrigin(baseOrigin?: string): string {
  return (baseOrigin || "https://example.invalid").trim() || "https://example.invalid";
}

function looksLikeBareToken(value: string): boolean {
  const t = value.trim();
  if (t.length < 16) return false;
  return B64URL_RE.test(t);
}

function safeDecodeUriComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function canonicalizeUrl(url: string, baseOrigin: string): string {
  let raw = (url || "").trim();
  if (!raw) return "";

  if (looksLikeBareToken(raw)) {
    raw = `/stream/p/${raw}`;
  }

  let resolved: URL;
  try {
    resolved = new URL(raw, baseOrigin);
  } catch {
    return "";
  }

  let path = resolved.pathname || "";
  const pMatch = P_TILDE_RE.exec(path);
  const spMatch = STREAM_P_TILDE_RE.exec(path);
  if (pMatch || spMatch) {
    const token = (pMatch || spMatch)?.[1] || "";
    const encoded = encodeURIComponent(token);
    path = `/stream/p/${encoded}`;
  }

  const normalized = new URL(resolved.toString());
  normalized.protocol = normalized.protocol.toLowerCase();
  normalized.host = normalized.host.toLowerCase();
  normalized.pathname = path;
  return normalized.toString();
}

function extractCandidateTokensFromUrl(u: URL): string[] {
  const candidates: string[] = [];
  const path = u.pathname || "";

  if (STREAM_C_RE.test(path)) {
    return [];
  }

  const m = STREAM_P_RE.exec(path);
  if (m) {
    candidates.push(m[1]);
  }

  const pMatch = P_TILDE_RE.exec(path);
  if (pMatch) {
    candidates.push(pMatch[1]);
  }

  const spMatch = STREAM_P_TILDE_RE.exec(path);
  if (spMatch) {
    candidates.push(spMatch[1]);
  }

  const queryParams = new URLSearchParams(u.search);
  for (const key of ["p", "t", "root", "token"]) {
    const values = queryParams.getAll(key);
    for (const v of values) {
      if (v && v.trim()) {
        candidates.push(v.trim());
      }
    }
  }

  const fragment = u.hash.startsWith("#") ? u.hash.slice(1) : u.hash;
  if (fragment) {
    const fragParams = new URLSearchParams(fragment);
    for (const key of ["p", "t", "root", "token"]) {
      const values = fragParams.getAll(key);
      for (const v of values) {
        if (v && v.trim()) {
          candidates.push(v.trim());
        }
      }
    }
  }

  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    const c2 = safeDecodeUriComponent(c).trim();
    if (!c2 || seen.has(c2)) continue;
    seen.add(c2);
    out.push(c2);
  }
  return out;
}

function addB64Padding(value: string): string {
  const r = value.length % 4;
  if (r === 0) return value;
  return value + "=".repeat(4 - r);
}

function decodeBase64UrlToBytes(token: string, maxDecodedBytes = 2_000_000): Uint8Array {
  const padded = addB64Padding(token.trim());
  let binary: string;
  try {
    binary = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  } catch (err) {
    throw new Error(`token is not valid base64url: ${String(err)}`);
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  if (bytes.length > maxDecodedBytes) {
    throw new Error(`decoded token too large (${bytes.length} bytes)`);
  }
  return bytes;
}

function stripTokenPrefixes(token: string): string {
  const t = token.trim();
  if (t.length >= 3 && t[1] === ":") {
    const prefix = t[0].toLowerCase();
    if (["c", "j", "p", "t"].includes(prefix)) {
      return t.slice(2);
    }
  }
  return t;
}

function parseTokenToObject(token: string): Record<string, unknown> {
  const tok = safeDecodeUriComponent(token).trim();
  if (tok.startsWith("{") && tok.endsWith("}")) {
    let obj: unknown;
    try {
      obj = JSON.parse(tok);
    } catch (err) {
      throw new Error(`raw json token invalid: ${String(err)}`);
    }
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
      throw new Error("raw json token must decode to an object");
    }
    return obj as Record<string, unknown>;
  }

  const b64 = stripTokenPrefixes(tok);
  const decoded = decodeBase64UrlToBytes(b64);
  let text: string;
  try {
    text = new TextDecoder("utf-8").decode(decoded);
  } catch (err) {
    throw new Error(`decoded token is not utf-8 json: ${String(err)}`);
  }
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch (err) {
    throw new Error(`decoded token is not valid json: ${String(err)}`);
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    throw new Error("decoded token must be a JSON object");
  }
  return obj as Record<string, unknown>;
}

function extractPayloadFromUrl(url: string, baseOrigin: string): UrlPayloadHit | null {
  const key = canonicalizeUrl(url, baseOrigin);
  if (!key) return null;
  let parsed: URL;
  try {
    parsed = new URL(key);
  } catch {
    return null;
  }

  const candidates = extractCandidateTokensFromUrl(parsed);
  if (candidates.length === 0) return null;

  for (const tok of candidates) {
    try {
      const obj = parseTokenToObject(tok);
      const payload = normalizePayload(obj);
      return { url_key: key, payload };
    } catch {
      // try next candidate
    }
  }
  return null;
}

function extractManyPayloadsFromAny(obj: unknown, baseOrigin: string): UrlPayloadHit[] {
  const hits: UrlPayloadHit[] = [];

  const visit = (x: unknown) => {
    if (x === null || x === undefined) return;
    if (typeof x === "string") {
      const s = x.trim();
      if (!s) return;
      if (looksLikeBareToken(s) || s.includes("/stream") || s.includes("/s/") || s.includes("/p~") || s.includes("http")) {
        const hit = extractPayloadFromUrl(s, baseOrigin);
        if (hit) hits.push(hit);
      }
      return;
    }
    if (Array.isArray(x)) {
      for (const v of x) visit(v);
      return;
    }
    if (typeof x === "object") {
      for (const v of Object.values(x as Record<string, unknown>)) {
        visit(v);
      }
    }
  };

  visit(obj);
  return hits;
}

function extractAddValuesFromUrl(url: string): string[] {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return [];
  }
  const values = parsed.searchParams.getAll("add");
  const fragment = parsed.hash.startsWith("#") ? parsed.hash.slice(1) : parsed.hash;
  if (fragment) {
    const fragParams = new URLSearchParams(fragment);
    values.push(...fragParams.getAll("add"));
  }
  return values.filter((v) => v && v.trim());
}

function extractWitnessChainFromUrl(url: string, baseOrigin: string): string[] {
  const absUrl = canonicalizeUrl(url, baseOrigin);
  if (!absUrl) return [];
  const rawAdds = extractAddValuesFromUrl(absUrl);
  const out: string[] = [];
  const seen = new Set<string>();

  for (const raw of rawAdds) {
    let decoded = safeDecodeUriComponent(String(raw)).trim();
    if (!decoded) continue;
    if (looksLikeBareToken(decoded)) {
      decoded = `/stream/p/${decoded}`;
    }
    const link = canonicalizeUrl(decoded, baseOrigin);
    if (!link || seen.has(link)) continue;
    seen.add(link);
    out.push(link);
  }

  if (out.length > WITNESS_ADD_MAX) {
    return out.slice(out.length - WITNESS_ADD_MAX);
  }
  return out;
}

function deriveWitnessContext(url: string, baseOrigin: string): WitnessCtx {
  const chain = extractWitnessChainFromUrl(url, baseOrigin);
  if (!chain.length) return { chain: [] };
  return {
    chain,
    originUrl: chain[0],
    parentUrl: chain[chain.length - 1],
  };
}

function mergeDerivedContext(payload: SigilPayloadLoose, ctx: WitnessCtx): SigilPayloadLoose {
  const next = { ...payload };
  if (ctx.originUrl && !next.originUrl) {
    next.originUrl = ctx.originUrl;
  }
  if (ctx.parentUrl && !next.parentUrl) {
    next.parentUrl = ctx.parentUrl;
  }
  return next;
}

function softPatchTopology(
  payload: SigilPayloadLoose,
  originUrl: string | null,
  parentUrl: string | null
): { payload: SigilPayloadLoose; changed: boolean } {
  let changed = false;
  let next = payload;
  if (originUrl && !next.originUrl) {
    next = { ...next, originUrl };
    changed = true;
  }
  if (parentUrl && !next.parentUrl) {
    next = { ...next, parentUrl };
    changed = true;
  }
  return { payload: next, changed };
}

function synthesizeEdgesFromWitnessChain(
  chain: string[],
  leafUrl: string,
  reg: Map<string, SigilPayloadLoose>,
  baseOrigin: string
): number {
  if (!chain.length) return 0;
  const chainAbs = chain
    .map((u) => canonicalizeUrl(u, baseOrigin))
    .filter((u) => u);
  if (!chainAbs.length) return 0;

  const origin = chainAbs[0];
  const leafAbs = canonicalizeUrl(leafUrl, baseOrigin);
  if (!leafAbs) return 0;

  let changed = 0;

  const ensure = (url: string) => {
    if (reg.has(url)) return;
    const hit = extractPayloadFromUrl(url, baseOrigin);
    if (!hit) return;
    reg.set(hit.url_key, hit.payload);
    changed += 1;
  };

  ensure(origin);
  const originPayload = reg.get(origin);
  if (originPayload) {
    const patched = softPatchTopology(originPayload, origin, null);
    if (patched.changed) {
      reg.set(origin, patched.payload);
      changed += 1;
    }
  }

  for (let i = 1; i < chainAbs.length; i += 1) {
    const child = chainAbs[i];
    const parent = chainAbs[i - 1];
    ensure(child);
    const childPayload = reg.get(child);
    if (childPayload) {
      const patched = softPatchTopology(childPayload, origin, parent);
      if (patched.changed) {
        reg.set(child, patched.payload);
        changed += 1;
      }
    }
  }

  ensure(leafAbs);
  const leafPayload = reg.get(leafAbs);
  if (leafPayload) {
    const patched = softPatchTopology(leafPayload, origin, chainAbs[chainAbs.length - 1]);
    if (patched.changed) {
      reg.set(leafAbs, patched.payload);
      changed += 1;
    }
  }

  return changed;
}

function canonicalizeTopology(payload: SigilPayloadLoose, baseOrigin: string): SigilPayloadLoose {
  let next = payload;
  if (typeof payload.originUrl === "string" && payload.originUrl.trim()) {
    const o = canonicalizeUrl(payload.originUrl, baseOrigin);
    if (o && o !== payload.originUrl) {
      next = { ...next, originUrl: o };
    }
  }
  if (typeof payload.parentUrl === "string" && payload.parentUrl.trim()) {
    const p = canonicalizeUrl(payload.parentUrl, baseOrigin);
    if (p && p !== payload.parentUrl) {
      next = { ...next, parentUrl: p };
    }
  }
  return next;
}

function mergePayload(prev: SigilPayloadLoose, incoming: SigilPayloadLoose): SigilPayloadLoose {
  const prevK = kaiTuple(prev);
  const incK = kaiTuple(incoming);
  let base = prev;
  let other = incoming;

  if (compareKai(incK, prevK) > 0) {
    base = incoming;
    other = prev;
  } else if (compareKai(incK, prevK) < 0) {
    base = prev;
    other = incoming;
  } else if (richnessScore(incoming) > richnessScore(prev)) {
    base = incoming;
    other = prev;
  }

  const merged: SigilPayloadLoose = { ...base };
  for (const [k, v] of Object.entries(other)) {
    if (isMissing((merged as Record<string, unknown>)[k]) && !isMissing(v)) {
      (merged as Record<string, unknown>)[k] = v;
    }
  }
  return merged;
}

function upsertPayload(reg: Map<string, SigilPayloadLoose>, urlKey: string, payload: SigilPayloadLoose): boolean {
  const prev = reg.get(urlKey);
  if (!prev) {
    reg.set(urlKey, payload);
    return true;
  }
  const merged = mergePayload(prev, payload);
  const prevJson = dumpsCanonicalJson(prev);
  const mergedJson = dumpsCanonicalJson(merged);
  if (prevJson === mergedJson) {
    return false;
  }
  reg.set(urlKey, merged);
  return true;
}

function ensureUrlInRegistry(reg: Map<string, SigilPayloadLoose>, url: string, baseOrigin: string): boolean {
  const hit = extractPayloadFromUrl(url, baseOrigin);
  if (!hit) return false;
  if (reg.has(hit.url_key)) return false;
  reg.set(hit.url_key, hit.payload);
  return true;
}

function stitchExplicitParentChain(
  reg: Map<string, SigilPayloadLoose>,
  startUrl: string,
  baseOrigin: string,
  maxDepth = 128
): number {
  let changed = 0;
  let current = startUrl;
  let depth = 0;

  while (depth < maxDepth) {
    depth += 1;
    const payload = reg.get(current);
    if (!payload) break;

    if (typeof payload.originUrl === "string" && payload.originUrl.trim()) {
      const origin = canonicalizeUrl(payload.originUrl, baseOrigin);
      if (origin && ensureUrlInRegistry(reg, origin, baseOrigin)) {
        changed += 1;
      }
    }

    if (!payload.parentUrl || !payload.parentUrl.trim()) {
      break;
    }
    const parent = canonicalizeUrl(payload.parentUrl, baseOrigin);
    if (!parent) break;
    if (ensureUrlInRegistry(reg, parent, baseOrigin)) {
      changed += 1;
    }
    current = parent;
  }

  return changed;
}

function inhaleFilesIntoRegistry(
  reg: Map<string, SigilPayloadLoose>,
  files: FileBlob[],
  baseOrigin: string
): InhaleReport {
  const report: InhaleReport = {
    crystals_total: 0,
    crystals_imported: 0,
    crystals_failed: 0,
    registry_urls: 0,
    latest_pulse: null,
    errors: [],
  };

  for (const file of files) {
    let obj: unknown;
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(file.bytes);
      obj = JSON.parse(text);
    } catch (err) {
      report.crystals_failed += 1;
      report.errors.push(`${file.name}: ${String(err)}`);
      continue;
    }

    const hits = extractManyPayloadsFromAny(obj, baseOrigin);
    report.crystals_total += hits.length;

    for (const hit of hits) {
      const urlKey = canonicalizeUrl(hit.url_key, baseOrigin);
      if (!urlKey) continue;

      const ctx = deriveWitnessContext(urlKey, baseOrigin);
      let mergedLeaf = mergeDerivedContext(hit.payload, ctx);
      mergedLeaf = canonicalizeTopology(mergedLeaf, baseOrigin);

      if (upsertPayload(reg, urlKey, mergedLeaf)) {
        report.crystals_imported += 1;
      }

      if (ctx.chain.length) {
        synthesizeEdgesFromWitnessChain(ctx.chain, urlKey, reg, baseOrigin);
      }

      stitchExplicitParentChain(reg, urlKey, baseOrigin, 128);
    }
  }

  report.registry_urls = reg.size;
  let latestPulse: number | null = null;
  for (const payload of reg.values()) {
    if (payload.pulse === null || payload.pulse === undefined) continue;
    const pulse = safeInt(payload.pulse);
    if (latestPulse === null || pulse > latestPulse) {
      latestPulse = pulse;
    }
  }
  report.latest_pulse = latestPulse;

  return report;
}

function buildOrderedUrls(reg: Map<string, SigilPayloadLoose>): string[] {
  const items = Array.from(reg.entries());
  items.sort((a, b) => {
    const aKey = kaiSortKeyDesc(a[1]);
    const bKey = kaiSortKeyDesc(b[1]);
    const cmp = compareKai(aKey, bKey);
    if (cmp !== 0) return -cmp;
    return a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0;
  });
  return items.map(([url]) => url);
}

function buildSigilEntry(url: string, payload: SigilPayloadLoose): SigilEntry {
  return {
    url,
    payload,
    pulse: safeInt(payload.pulse),
    beat: safeInt(payload.beat),
    stepIndex: safeInt(payload.stepIndex),
    chakraDay: payload.chakraDay ?? null,
    kaiSignature: payload.kaiSignature ?? null,
    originUrl: payload.originUrl ?? null,
    parentUrl: payload.parentUrl ?? null,
    userPhiKey: payload.userPhiKey ?? null,
    phiKey: payload.phiKey ?? null,
    phikey: payload.phikey ?? null,
    id: payload.userPhiKey || payload.phikey || payload.phiKey || null,
  };
}

function sortedEntries(reg: Map<string, SigilPayloadLoose>, urls: string[]): SigilEntry[] {
  const entries: SigilEntry[] = [];
  for (const url of urls) {
    const payload = reg.get(url);
    if (!payload) continue;
    entries.push(buildSigilEntry(url, payload));
  }
  return entries;
}

function dumpsCanonicalJson(obj: unknown): string {
  const normalize = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map((v) => normalize(v));
    }
    if (value && typeof value === "object") {
      const sorted: Record<string, unknown> = {};
      for (const key of Object.keys(value as Record<string, unknown>).sort()) {
        sorted[key] = normalize((value as Record<string, unknown>)[key]);
      }
      return sorted;
    }
    return value;
  };
  return JSON.stringify(normalize(obj));
}

function computeSealFromUrls(urls: string[]): string {
  const blob = dumpsCanonicalJson({ urls });
  const bytes = TEXT_ENCODER.encode(blob);
  return blake2bHex(bytes, 16);
}

function blake2bHex(input: Uint8Array, outLen: number): string {
  const digest = blake2b(input, outLen);
  return Array.from(digest)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Minimal blake2b implementation (digest length <= 64)
// Adapted from RFC 7693 reference (public domain).
function blake2b(input: Uint8Array, outLen: number): Uint8Array {
  if (outLen <= 0 || outLen > 64) {
    throw new Error("invalid blake2b output length");
  }
  const IV = new Uint32Array([
    0x6a09e667, 0xf3bcc908, 0xbb67ae85, 0x84caa73b, 0x3c6ef372, 0xfe94f82b, 0xa54ff53a, 0x5f1d36f1,
    0x510e527f, 0xade682d1, 0x9b05688c, 0x2b3e6c1f, 0x1f83d9ab, 0xfb41bd6b, 0x5be0cd19, 0x137e2179,
  ]);
  const SIGMA = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
    [11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4],
    [7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8],
    [9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13],
    [2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9],
    [12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11],
    [13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10],
    [6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5],
    [10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0],
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
  ];

  const h = new Uint32Array(16);
  h.set(IV);
  h[0] ^= 0x01010000 ^ outLen;

  let t0 = 0;
  let t1 = 0;

  const block = new Uint8Array(128);

  const compress = (last: boolean) => {
    const m = new Uint32Array(32);
    for (let i = 0; i < 32; i += 1) {
      m[i] =
        block[i * 4 + 0] |
        (block[i * 4 + 1] << 8) |
        (block[i * 4 + 2] << 16) |
        (block[i * 4 + 3] << 24);
    }

    const v = new Uint32Array(32);
    v.set(h, 0);
    v.set(IV, 16);
    v[24] ^= t0;
    v[25] ^= t1;
    if (last) {
      v[28] = ~v[28];
    }

    const G = (a: number, b: number, c: number, d: number, x: number, y: number) => {
      v[a] = v[a] + v[b] + x;
      v[d] = rotr32(v[d] ^ v[a], 16);
      v[c] = v[c] + v[d];
      v[b] = rotr32(v[b] ^ v[c], 12);
      v[a] = v[a] + v[b] + y;
      v[d] = rotr32(v[d] ^ v[a], 8);
      v[c] = v[c] + v[d];
      v[b] = rotr32(v[b] ^ v[c], 7);
    };

    for (let r = 0; r < 12; r += 1) {
      const s = SIGMA[r];
      G(0, 4, 8, 12, m[s[0]], m[s[1]]);
      G(1, 5, 9, 13, m[s[2]], m[s[3]]);
      G(2, 6, 10, 14, m[s[4]], m[s[5]]);
      G(3, 7, 11, 15, m[s[6]], m[s[7]]);
      G(0, 5, 10, 15, m[s[8]], m[s[9]]);
      G(1, 6, 11, 12, m[s[10]], m[s[11]]);
      G(2, 7, 8, 13, m[s[12]], m[s[13]]);
      G(3, 4, 9, 14, m[s[14]], m[s[15]]);
    }

    for (let i = 0; i < 16; i += 1) {
      h[i] ^= v[i] ^ v[i + 16];
    }
  };

  let offset = 0;
  while (offset + 128 <= input.length) {
    block.set(input.subarray(offset, offset + 128));
    offset += 128;
    t0 += 128;
    if (t0 >= 0x100000000) {
      t0 -= 0x100000000;
      t1 += 1;
    }
    compress(false);
  }

  const remaining = input.length - offset;
  block.fill(0);
  block.set(input.subarray(offset));
  t0 += remaining;
  if (t0 >= 0x100000000) {
    t0 -= 0x100000000;
    t1 += 1;
  }
  compress(true);

  const out = new Uint8Array(outLen);
  for (let i = 0; i < outLen; i += 1) {
    const word = h[i >> 2];
    out[i] = (word >> (8 * (i & 3))) & 0xff;
  }
  return out;
}

function rotr32(value: number, shift: number): number {
  return (value >>> shift) | (value << (32 - shift));
}

async function readFileAsBytes(file: File): Promise<Uint8Array> {
  const buf = await file.arrayBuffer();
  return new Uint8Array(buf);
}

async function readUploadCapped(file: File, maxBytes: number): Promise<{ bytes: Uint8Array | null; notes: string[] }> {
  const notes: string[] = [];
  if (file.type && !["application/json", "application/octet-stream"].includes(file.type)) {
    notes.push(`${file.name}: unexpected content-type '${file.type}' (still attempting JSON parse).`);
  }
  if (file.size > maxBytes) {
    return {
      bytes: null,
      notes: [
        `${file.name}: file too large (${file.size} bytes) exceeds max_bytes_per_file=${maxBytes}.`,
        `${file.name}: skipped`,
      ],
    };
  }
  const bytes = await readFileAsBytes(file);
  if (!bytes.length) {
    return { bytes: null, notes: [`${file.name}: empty file`, `${file.name}: skipped`] };
  }
  return { bytes, notes };
}

class Semaphore {
  private max: number;
  private count = 0;
  private queue: Array<() => void> = [];

  constructor(max: number) {
    this.max = Math.max(1, max);
  }

  async acquire(): Promise<() => void> {
    if (this.count < this.max) {
      this.count += 1;
      return () => this.release();
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.count += 1;
        resolve(() => this.release());
      });
    });
  }

  private release() {
    this.count -= 1;
    const next = this.queue.shift();
    if (next) next();
  }
}

export class SigilStateStore {
  private baseOrigin: string;
  private registry: Map<string, SigilPayloadLoose> = new Map();
  private cacheUrls: string[] | null = null;
  private cacheSeal = "";
  private cacheState: SigilState | null = null;
  private pruneKeep: number;

  constructor(options?: { baseOrigin?: string; pruneKeep?: number }) {
    this.baseOrigin = ensureBaseOrigin(options?.baseOrigin);
    this.pruneKeep = options?.pruneKeep ?? 0;
  }

  private invalidateCache() {
    this.cacheUrls = null;
    this.cacheSeal = "";
    this.cacheState = null;
  }

  private ensureUrlsCache() {
    if (this.cacheUrls) return;
    const ordered = buildOrderedUrls(this.registry);
    this.cacheUrls = ordered;
    this.cacheSeal = computeSealFromUrls(ordered);
  }

  private ensureStateCache() {
    if (this.cacheState) return;
    this.ensureUrlsCache();
    const urls = this.cacheUrls ?? [];
    const entries = sortedEntries(this.registry, urls);
    const payloads = entries.map((entry) => entry.payload);
    const latest = payloads.length ? latestKai(payloads) : { pulse: 0, beat: 0, stepIndex: 0 };
    this.cacheState = {
      spec: "KKS-1.0",
      total_urls: entries.length,
      latest,
      state_seal: this.cacheSeal,
      registry: entries,
      urls: urls,
    };
  }

  private maybePrune() {
    if (this.pruneKeep <= 0) return;
    if (this.registry.size <= this.pruneKeep) return;
    const ordered = buildOrderedUrls(this.registry);
    const next = new Map<string, SigilPayloadLoose>();
    for (const url of ordered.slice(0, this.pruneKeep)) {
      const payload = this.registry.get(url);
      if (payload) next.set(url, payload);
    }
    this.registry = next;
  }

  inhaleFiles(files: FileBlob[]): InhaleReport {
    const report = inhaleFilesIntoRegistry(this.registry, files, this.baseOrigin);
    this.maybePrune();
    this.invalidateCache();
    return report;
  }

  exhaleUrls(): string[] {
    this.ensureUrlsCache();
    return this.cacheUrls ? [...this.cacheUrls] : [];
  }

  exhaleUrlsPage(offset: number, limit: number): { urls: string[]; total: number } {
    const o = Math.max(0, Math.trunc(offset));
    const l = Math.max(1, Math.trunc(limit));
    this.ensureUrlsCache();
    const urls = this.cacheUrls ?? [];
    return { urls: urls.slice(o, o + l), total: urls.length };
  }

  getSeal(): string {
    this.ensureUrlsCache();
    return this.cacheSeal;
  }

  getState(): SigilState {
    this.ensureStateCache();
    return this.cacheState ? { ...this.cacheState } : {
      spec: "KKS-1.0",
      total_urls: 0,
      latest: { pulse: 0, beat: 0, stepIndex: 0 },
      state_seal: "",
      registry: [],
      urls: [],
    };
  }

  getBaseOrigin(): string {
    return this.baseOrigin;
  }
}

export class InternalSigilApi {
  private store: SigilStateStore;
  private inhaleSemaphore: Semaphore;
  private maxInlineStateUrls: number;
  private maxInlineUrls: number;

  constructor(options?: {
    baseOrigin?: string;
    pruneKeep?: number;
    maxConcurrentInhales?: number;
    maxInlineStateUrls?: number;
    maxInlineUrls?: number;
  }) {
    this.store = new SigilStateStore({
      baseOrigin: options?.baseOrigin,
      pruneKeep: options?.pruneKeep,
    });
    this.inhaleSemaphore = new Semaphore(options?.maxConcurrentInhales ?? 32);
    this.maxInlineStateUrls = options?.maxInlineStateUrls ?? DEFAULT_MAX_INLINE_STATE_URLS;
    this.maxInlineUrls = options?.maxInlineUrls ?? DEFAULT_MAX_INLINE_URLS;
  }

  getStore(): SigilStateStore {
    return this.store;
  }

  seal(): { seal: string } {
    return { seal: this.store.getSeal() };
  }

  state(): SigilState {
    return this.store.getState();
  }

  urls(offset = 0, limit = 10_000): UrlsPageResponse {
    const page = this.store.exhaleUrlsPage(offset, limit);
    return {
      status: "ok",
      state_seal: this.store.getSeal(),
      total: page.total,
      offset: Math.trunc(offset),
      limit: Math.trunc(limit),
      urls: page.urls,
    };
  }

  exhale(mode: "urls" | "state" = "urls"): ExhaleResponse {
    if (mode === "urls") {
      return { status: "ok", mode: "urls", urls: this.store.exhaleUrls(), state: null };
    }
    return { status: "ok", mode: "state", urls: null, state: this.store.getState() };
  }

  async inhale(options: {
    files: File[];
    includeState?: boolean;
    includeUrls?: boolean;
    maxBytesPerFile?: number;
  }): Promise<InhaleResponse> {
    const release = await this.inhaleSemaphore.acquire();
    try {
      const includeState = options.includeState ?? true;
      const includeUrls = options.includeUrls ?? true;
      const maxBytes = options.maxBytesPerFile ?? DEFAULT_MAX_BYTES_PER_FILE;

      if (!options.files.length) {
        return {
          status: "error",
          files_received: 0,
          crystals_total: 0,
          crystals_imported: 0,
          crystals_failed: 0,
          registry_urls: 0,
          latest_pulse: null,
          urls: null,
          state: null,
          errors: ["No files received for inhale."],
        };
      }

      const fileBlobs: FileBlob[] = [];
      const softNotes: string[] = [];
      for (const file of options.files) {
        const { bytes, notes } = await readUploadCapped(file, maxBytes);
        if (notes.length) {
          softNotes.push(...notes);
        }
        if (bytes) {
          fileBlobs.push({ name: file.name || "krystal.json", bytes });
        }
      }

      if (!fileBlobs.length) {
        return {
          status: "error",
          files_received: options.files.length,
          crystals_total: 0,
          crystals_imported: 0,
          crystals_failed: 0,
          registry_urls: 0,
          latest_pulse: null,
          urls: null,
          state: null,
          errors: softNotes.length ? softNotes : ["All uploaded files were rejected or empty."],
        };
      }

      const report = this.store.inhaleFiles(fileBlobs);

      const errors = [...report.errors, ...softNotes];
      let state: SigilState | null = null;
      let urls: string[] | null = null;

      if (includeState) {
        if (report.registry_urls > this.maxInlineStateUrls) {
          errors.push(
            `state suppressed: registry_urls=${report.registry_urls} exceeds maxInlineStateUrls=${this.maxInlineStateUrls}. Use state() instead.`
          );
        } else {
          state = this.store.getState();
        }
      }

      if (includeUrls) {
        if (report.registry_urls > this.maxInlineUrls) {
          errors.push(
            `urls suppressed: registry_urls=${report.registry_urls} exceeds maxInlineUrls=${this.maxInlineUrls}. Use urls() paging.`
          );
        } else {
          urls = this.store.exhaleUrls();
        }
      }

      return {
        status: "ok",
        files_received: options.files.length,
        crystals_total: report.crystals_total,
        crystals_imported: report.crystals_imported,
        crystals_failed: report.crystals_failed,
        registry_urls: report.registry_urls,
        latest_pulse: report.latest_pulse,
        urls,
        state,
        errors,
      };
    } finally {
      release();
    }
  }

  async merge(options: {
    files: File[];
    mode?: "urls" | "state";
    maxBytesPerFile?: number;
  }): Promise<ExhaleResponse> {
    const mode = options.mode ?? "urls";
    const maxBytes = options.maxBytesPerFile ?? DEFAULT_MAX_BYTES_PER_FILE;
    if (!options.files.length) {
      return { status: "ok", mode, urls: [], state: null };
    }

    const fileBlobs: FileBlob[] = [];
    for (const file of options.files) {
      const { bytes } = await readUploadCapped(file, maxBytes);
      if (bytes) {
        fileBlobs.push({ name: file.name || "krystal.json", bytes });
      }
    }

    const tempStore = new SigilStateStore({ baseOrigin: this.store.getBaseOrigin() });
    tempStore.inhaleFiles(fileBlobs);
    if (mode === "urls") {
      return { status: "ok", mode: "urls", urls: tempStore.exhaleUrls(), state: null };
    }
    return { status: "ok", mode: "state", urls: null, state: tempStore.getState() };
  }
}

export async function fileListToArray(fileList: FileList | File[]): Promise<File[]> {
  return Array.from(fileList as File[]);
}