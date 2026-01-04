// src/utils/sigilLedgerRegistry.ts
// Local registry for SigilMarkets ledger events (Explorer display aid).

import type { KaiMoment } from "../SigilMarkets/types/marketTypes";
import type { SvgHash } from "../SigilMarkets/types/vaultTypes";
import { sha256Hex } from "../SigilMarkets/utils/ids";

export type SigilLedgerEventKind = "DEPOSIT" | "WITHDRAW" | "LOCK" | "UNLOCK" | "CLAIM";

export type SigilLedgerEvent = Readonly<{
  eventId: string;
  kind: SigilLedgerEventKind;
  rootSigilId: string;
  rootSvgHash: SvgHash;
  kaiMoment: KaiMoment;
  deltaPhiMicro: string;
  resultingBalanceMicro: string;
  refs?: Readonly<{
    vaultId?: string;
    lockId?: string;
    marketId?: string;
    positionId?: string;
    claimId?: string;
  }>;
  hashes?: Readonly<{
    lineageId?: string;
    canonicalPayloadHash?: string;
  }>;
}>;

export type SigilRootRecord = Readonly<{
  rootSigilId: string;
  rootSvgHash: SvgHash;
  userPhiKey?: string;
  kaiSignature?: string;
  lastSeenPulse?: number;
}>;

export type SigilLedgerRegistry = Readonly<{
  roots: ReadonlyMap<string, SigilRootRecord>;
  events: ReadonlyMap<string, SigilLedgerEvent>;
}>;

export const SIGIL_LEDGER_LS_KEY = "kai:sigil-ledger:v1";
export const SIGIL_LEDGER_CHANNEL_NAME = "kai-sigil-ledger";
export const SIGIL_LEDGER_EVENT = "sigil:ledger:recorded";

const hasWindow = typeof window !== "undefined";
const canStorage = hasWindow && typeof window.localStorage !== "undefined";

const normalizeKey = (value: string): string => value.trim().toLowerCase();

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

const toString = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

const toNumber = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : undefined;

const toMoment = (v: unknown): KaiMoment | undefined => {
  if (!isRecord(v)) return undefined;
  const pulse = toNumber(v.pulse);
  const beat = toNumber(v.beat);
  const stepIndex = toNumber(v.stepIndex);
  if (pulse == null || beat == null || stepIndex == null) return undefined;
  return { pulse, beat, stepIndex };
};

const serializeRegistry = (roots: Record<string, SigilRootRecord>, events: Record<string, SigilLedgerEvent>): string =>
  JSON.stringify({ roots, events });

const deserializeRegistry = (raw: string): { roots: Record<string, SigilRootRecord>; events: Record<string, SigilLedgerEvent> } => {
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed)) return { roots: {}, events: {} };
  const rootsRaw = isRecord(parsed.roots) ? parsed.roots : {};
  const eventsRaw = isRecord(parsed.events) ? parsed.events : {};

  const roots: Record<string, SigilRootRecord> = {};
  for (const [key, value] of Object.entries(rootsRaw)) {
    if (!isRecord(value)) continue;
    const rootSigilId = toString(value.rootSigilId) ?? key;
    const rootSvgHash = toString(value.rootSvgHash);
    if (!rootSigilId || !rootSvgHash) continue;
    roots[normalizeKey(rootSigilId)] = {
      rootSigilId,
      rootSvgHash: rootSvgHash as SvgHash,
      userPhiKey: toString(value.userPhiKey) ?? undefined,
      kaiSignature: toString(value.kaiSignature) ?? undefined,
      lastSeenPulse: toNumber(value.lastSeenPulse),
    };
  }

  const events: Record<string, SigilLedgerEvent> = {};
  for (const [key, value] of Object.entries(eventsRaw)) {
    if (!isRecord(value)) continue;
    const eventId = toString(value.eventId) ?? key;
    const kind = toString(value.kind) as SigilLedgerEventKind | undefined;
    const rootSigilId = toString(value.rootSigilId);
    const rootSvgHash = toString(value.rootSvgHash);
    const kaiMoment = toMoment(value.kaiMoment);
    const deltaPhiMicro = toString(value.deltaPhiMicro);
    const resultingBalanceMicro = toString(value.resultingBalanceMicro);
    if (!eventId || !kind || !rootSigilId || !rootSvgHash || !kaiMoment || !deltaPhiMicro || !resultingBalanceMicro) {
      continue;
    }
    events[normalizeKey(eventId)] = {
      eventId,
      kind,
      rootSigilId,
      rootSvgHash: rootSvgHash as SvgHash,
      kaiMoment,
      deltaPhiMicro,
      resultingBalanceMicro,
      refs: isRecord(value.refs) ? (value.refs as SigilLedgerEvent["refs"]) : undefined,
      hashes: isRecord(value.hashes) ? (value.hashes as SigilLedgerEvent["hashes"]) : undefined,
    };
  }

  return { roots, events };
};

function readRawRegistry(): { roots: Record<string, SigilRootRecord>; events: Record<string, SigilLedgerEvent> } {
  if (!canStorage) return { roots: {}, events: {} };
  try {
    const raw = window.localStorage.getItem(SIGIL_LEDGER_LS_KEY);
    if (!raw) return { roots: {}, events: {} };
    return deserializeRegistry(raw);
  } catch {
    return { roots: {}, events: {} };
  }
}

export function readSigilLedgerRegistry(): SigilLedgerRegistry {
  const raw = readRawRegistry();
  return {
    roots: new Map(Object.entries(raw.roots)),
    events: new Map(Object.entries(raw.events)),
  };
}

export function mergeLedgerEvents(
  existing: readonly SigilLedgerEvent[],
  incoming: readonly SigilLedgerEvent[],
): SigilLedgerEvent[] {
  const map = new Map<string, SigilLedgerEvent>();
  for (const e of existing) map.set(normalizeKey(e.eventId), e);
  for (const e of incoming) {
    const key = normalizeKey(e.eventId);
    if (!map.has(key)) map.set(key, e);
  }
  return Array.from(map.values()).sort((a, b) => {
    if (a.kaiMoment.pulse !== b.kaiMoment.pulse) return a.kaiMoment.pulse - b.kaiMoment.pulse;
    if (a.kaiMoment.beat !== b.kaiMoment.beat) return a.kaiMoment.beat - b.kaiMoment.beat;
    return a.kaiMoment.stepIndex - b.kaiMoment.stepIndex;
  });
}

export const deriveLedgerEventId = async (args: Readonly<{
  rootSigilId: string;
  kind: SigilLedgerEventKind;
  refId: string;
  pulse: number;
}>): Promise<string> => {
  const msg = `SM-EVT-1|${args.rootSigilId}|${args.kind}|${args.refId}|${args.pulse}`;
  return sha256Hex(msg);
};

export async function recordSigilLedgerEvent(
  args: Omit<SigilLedgerEvent, "eventId"> & Readonly<{ refId: string }>,
): Promise<SigilLedgerEvent | null> {
  if (!hasWindow) return null;
  const eventId = await deriveLedgerEventId({
    rootSigilId: args.rootSigilId,
    kind: args.kind,
    refId: args.refId,
    pulse: args.kaiMoment.pulse,
  });

  const registry = readRawRegistry();
  const key = normalizeKey(eventId);
  if (registry.events[key]) return registry.events[key];

  const next: SigilLedgerEvent = {
    eventId,
    kind: args.kind,
    rootSigilId: args.rootSigilId,
    rootSvgHash: args.rootSvgHash,
    kaiMoment: args.kaiMoment,
    deltaPhiMicro: args.deltaPhiMicro,
    resultingBalanceMicro: args.resultingBalanceMicro,
    refs: args.refs,
    hashes: args.hashes,
  };

  registry.events[key] = next;

  if (canStorage) {
    try {
      window.localStorage.setItem(SIGIL_LEDGER_LS_KEY, serializeRegistry(registry.roots, registry.events));
    } catch {
      // ignore quota failures
    }
  }

  try {
    if ("BroadcastChannel" in window) {
      const bc = new BroadcastChannel(SIGIL_LEDGER_CHANNEL_NAME);
      bc.postMessage({ type: "ledger:update", eventId });
      bc.close();
    }
  } catch {
    // ignore broadcast failures
  }

  try {
    window.dispatchEvent(new CustomEvent(SIGIL_LEDGER_EVENT, { detail: next }));
  } catch {
    // ignore event failures
  }

  return next;
}

export function recordSigilRootEntry(entry: SigilRootRecord): SigilRootRecord | null {
  if (!hasWindow) return null;
  const key = normalizeKey(entry.rootSigilId);
  if (!key) return null;

  const registry = readRawRegistry();
  const existing = registry.roots[key];
  const next: SigilRootRecord = {
    rootSigilId: entry.rootSigilId,
    rootSvgHash: entry.rootSvgHash,
    userPhiKey: entry.userPhiKey ?? existing?.userPhiKey,
    kaiSignature: entry.kaiSignature ?? existing?.kaiSignature,
    lastSeenPulse: entry.lastSeenPulse ?? existing?.lastSeenPulse,
  };

  registry.roots[key] = next;

  if (canStorage) {
    try {
      window.localStorage.setItem(SIGIL_LEDGER_LS_KEY, serializeRegistry(registry.roots, registry.events));
    } catch {
      // ignore quota failures
    }
  }

  return next;
}

export function latestLedgerEventForRoot(
  rootSigilId: string | null | undefined,
  events: ReadonlyMap<string, SigilLedgerEvent>,
): SigilLedgerEvent | undefined {
  if (!rootSigilId) return undefined;
  const key = normalizeKey(rootSigilId);
  let latest: SigilLedgerEvent | undefined;
  for (const [, event] of events) {
    if (normalizeKey(event.rootSigilId) !== key) continue;
    if (!latest) {
      latest = event;
      continue;
    }
    if (event.kaiMoment.pulse > latest.kaiMoment.pulse) latest = event;
    else if (event.kaiMoment.pulse === latest.kaiMoment.pulse && event.kaiMoment.beat > latest.kaiMoment.beat) latest = event;
    else if (
      event.kaiMoment.pulse === latest.kaiMoment.pulse &&
      event.kaiMoment.beat === latest.kaiMoment.beat &&
      event.kaiMoment.stepIndex > latest.kaiMoment.stepIndex
    ) {
      latest = event;
    }
  }
  return latest;
}
