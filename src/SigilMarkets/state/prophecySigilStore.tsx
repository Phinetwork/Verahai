// SigilMarkets/state/prophecySigilStore.tsx
"use client";

/* eslint-disable @typescript-eslint/consistent-type-definitions */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  SM_PROPHECY_SIGILS_KEY,
  decodeEnvelope,
  getDefaultStorage,
  loadFromStorage,
  removeFromStorage,
  saveToStorage,
  wrapEnvelope,
  type Decoder,
  type PersistResult,
  type StorageLike,
} from "./persistence";

import type { EvidenceBundle } from "../types/oracleTypes";
import type { KaiPulse, PhiMicro } from "../types/marketTypes";
import type {
  ProphecyId,
  ProphecyRecord,
  ProphecySigilArtifact,
  ProphecySigilPayloadV1,
} from "../types/prophecySigilTypes";
import { asProphecyId } from "../types/prophecySigilTypes";
import type { SvgHash } from "../types/vaultTypes";
import { asSvgHash } from "../types/vaultTypes";

/* ----------------------------- helpers ----------------------------- */

type UnknownRecord = Record<string, unknown>;
const isRecord = (v: unknown): v is UnknownRecord => typeof v === "object" && v !== null;
const isString = (v: unknown): v is string => typeof v === "string";
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isArray = (v: unknown): v is readonly unknown[] => Array.isArray(v);

const clampInt = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Math.floor(n)));

const nowMs = (): number => {
  const t = Date.now();
  return Number.isFinite(t) ? t : 0;
};

const genId = (prefix: string): string => `${prefix}_${nowMs()}_${Math.random().toString(16).slice(2)}`;

const parseBigIntDec = (v: unknown): bigint | null => {
  if (typeof v === "string" && /^[0-9]+$/.test(v)) {
    try {
      return BigInt(v);
    } catch {
      return null;
    }
  }
  if (typeof v === "bigint") return v;
  return null;
};

const normalizePhi = (v: bigint | null): PhiMicro | undefined => {
  if (v === null) return undefined;
  return (v < 0n ? 0n : v) as unknown as PhiMicro;
};

const decodeEvidence = (v: unknown): EvidenceBundle | undefined => {
  if (!isRecord(v)) return undefined;
  const itemsRaw = v["items"];
  const items = isArray(itemsRaw) ? (itemsRaw as EvidenceBundle["items"]) : [];
  const summary = isString(v["summary"]) ? v["summary"] : undefined;
  const bundleHash = isString(v["bundleHash"]) ? v["bundleHash"] : undefined;
  return { items, summary, bundleHash } as EvidenceBundle;
};

const serializeEvidence = (v?: EvidenceBundle): EvidenceBundle | undefined => {
  if (!v) return undefined;
  return {
    items: v.items,
    summary: v.summary,
    bundleHash: v.bundleHash,
  };
};

/* ----------------------------- persistence ----------------------------- */

type SerializedSigil = Readonly<{
  sigilId: string;
  svgHash: string;
  svg: string;
  url?: string;
  canonicalHash: string;
  payload: ProphecySigilPayloadV1;
  zk?: ProphecySigilPayloadV1["zk"];
}>;

type SerializedProphecy = Readonly<{
  id: string;
  kind: "prophecy";

  text: string;
  category?: string;
  expirationPulse?: number;
  escrowPhiMicro?: string;
  evidence?: EvidenceBundle;

  sigil?: SerializedSigil;

  createdAtPulse: number;
  updatedPulse: number;
}>;

type ProphecyStoreState = Readonly<{
  byId: Readonly<Record<string, ProphecyRecord>>;
  ids: readonly ProphecyId[];
  lastUpdatedPulse: KaiPulse;
}>;

type SerializedStore = Readonly<{
  propheciesById: Readonly<Record<string, SerializedProphecy>>;
  prophecyIds: readonly string[];
  lastUpdatedPulse: number;
}>;

const decodeProphecy: Decoder<ProphecyRecord> = (v: unknown) => {
  if (!isRecord(v)) return { ok: false, error: "prophecy: not object" };

  const idRaw = v["id"];
  if (!isString(idRaw) || idRaw.length === 0) return { ok: false, error: "prophecy.id" };

  const kind = v["kind"];
  if (kind !== "prophecy") return { ok: false, error: "prophecy.kind" };

  const text = v["text"];
  if (!isString(text) || text.length === 0) return { ok: false, error: "prophecy.text" };

  const category = isString(v["category"]) ? v["category"] : undefined;

  const expirationPulseRaw = v["expirationPulse"];
  const expirationPulse = isNumber(expirationPulseRaw)
    ? (Math.max(0, Math.floor(expirationPulseRaw)) as KaiPulse)
    : undefined;

  const escrowRaw = v["escrowPhiMicro"];
  const escrowBig = parseBigIntDec(escrowRaw);
  const escrowPhiMicro = normalizePhi(escrowBig);

  const evidence = decodeEvidence(v["evidence"]);

  const createdAtPulseRaw = v["createdAtPulse"];
  if (!isNumber(createdAtPulseRaw)) return { ok: false, error: "prophecy.createdAtPulse" };
  const createdAtPulse = clampInt(createdAtPulseRaw, 0, 1_000_000_000) as KaiPulse;

  const updatedPulseRaw = v["updatedPulse"];
  if (!isNumber(updatedPulseRaw)) return { ok: false, error: "prophecy.updatedPulse" };
  const updatedPulse = clampInt(updatedPulseRaw, 0, 1_000_000_000) as KaiPulse;

  let sigil: ProphecySigilArtifact | undefined;
  const sigilRaw = v["sigil"];
  if (isRecord(sigilRaw)) {
    const sigilId = sigilRaw["sigilId"];
    const svgHash = sigilRaw["svgHash"];
    const svg = sigilRaw["svg"];
    const canonicalHash = sigilRaw["canonicalHash"];
    const payload = sigilRaw["payload"];
    if (
      isString(sigilId) &&
      isString(svgHash) &&
      isString(svg) &&
      isString(canonicalHash) &&
      isRecord(payload)
    ) {
      sigil = {
        sigilId: asProphecyId(sigilId),
        svgHash: asSvgHash(svgHash),
        svg,
        canonicalHash,
        payload: payload as ProphecySigilPayloadV1,
        url: isString(sigilRaw["url"]) ? sigilRaw["url"] : undefined,
        zk: sigilRaw["zk"] as ProphecySigilPayloadV1["zk"],
      };
    }
  }

  return {
    ok: true,
    value: {
      id: asProphecyId(idRaw),
      kind: "prophecy",
      text,
      category,
      expirationPulse,
      escrowPhiMicro,
      evidence,
      sigil,
      createdAtPulse,
      updatedPulse,
    },
  };
};

const decodeStore: Decoder<ProphecyStoreState> = (v: unknown) => {
  if (!isRecord(v)) return { ok: false, error: "store: not object" };

  const byIdRaw = v["propheciesById"];
  const idsRaw = v["prophecyIds"];
  const lastUpdatedPulseRaw = v["lastUpdatedPulse"];

  const byId: Record<string, ProphecyRecord> = {};
  if (isRecord(byIdRaw)) {
    for (const [k, vv] of Object.entries(byIdRaw)) {
      const dp = decodeProphecy(vv);
      if (dp.ok) byId[k] = dp.value;
    }
  }

  const ids: ProphecyId[] = isArray(idsRaw)
    ? idsRaw.filter((x): x is string => isString(x) && x.length > 0).map((id) => asProphecyId(id))
    : [];

  const lastUpdatedPulse = isNumber(lastUpdatedPulseRaw)
    ? (clampInt(lastUpdatedPulseRaw, 0, 1_000_000_000) as KaiPulse)
    : (0 as KaiPulse);

  return { ok: true, value: { byId, ids, lastUpdatedPulse } };
};

const serializeProphecy = (p: ProphecyRecord): SerializedProphecy => ({
  id: p.id,
  kind: "prophecy",
  text: p.text,
  category: p.category,
  expirationPulse: p.expirationPulse,
  escrowPhiMicro: p.escrowPhiMicro ? (p.escrowPhiMicro as unknown as bigint).toString(10) : undefined,
  evidence: serializeEvidence(p.evidence),
  sigil: p.sigil
    ? {
        sigilId: p.sigil.sigilId,
        svgHash: p.sigil.svgHash as unknown as string,
        svg: p.sigil.svg,
        url: p.sigil.url,
        canonicalHash: p.sigil.canonicalHash,
        payload: p.sigil.payload,
        zk: p.sigil.zk,
      }
    : undefined,
  createdAtPulse: p.createdAtPulse,
  updatedPulse: p.updatedPulse,
});

const serializeStore = (state: ProphecyStoreState): SerializedStore => {
  const propheciesById: Record<string, SerializedProphecy> = {};
  for (const [k, p] of Object.entries(state.byId)) propheciesById[k] = serializeProphecy(p);

  return {
    propheciesById,
    prophecyIds: state.ids.map((id) => id as unknown as string),
    lastUpdatedPulse: state.lastUpdatedPulse,
  };
};

/* ----------------------------- store ----------------------------- */

export type CreateProphecySigilInput = Readonly<{
  text: string;
  category?: string;
  expirationPulse?: KaiPulse;
  escrowPhiMicro?: PhiMicro;
  evidence?: EvidenceBundle;
  sigil?: ProphecySigilArtifact;
  createdAtPulse: KaiPulse;
}>;

export type SigilMarketsProphecySigilState = Readonly<{
  byId: Readonly<Record<string, ProphecyRecord>>;
  ids: readonly ProphecyId[];
  lastUpdatedPulse: KaiPulse;
}>;

export type SigilMarketsProphecySigilActions = Readonly<{
  addProphecy: (input: CreateProphecySigilInput) => ProphecyRecord;
  attachSigil: (id: ProphecyId, sigil: ProphecySigilArtifact, updatedPulse: KaiPulse) => PersistResult<ProphecyRecord>;
  removeProphecy: (id: ProphecyId) => void;
  clear: () => void;
}>;

export type SigilMarketsProphecySigilStore = Readonly<{
  state: SigilMarketsProphecySigilState;
  actions: SigilMarketsProphecySigilActions;
}>;

const SigilMarketsProphecySigilContext = createContext<SigilMarketsProphecySigilStore | null>(null);

export const SigilMarketsProphecySigilProvider = (props: Readonly<{ children: ReactNode }>) => {
  const storageRef = useRef<StorageLike | null>(null);
  const lastPersistedPulseRef = useRef<KaiPulse>(0 as KaiPulse);

  const [state, setState] = useState<SigilMarketsProphecySigilState>({
    byId: {},
    ids: [],
    lastUpdatedPulse: 0 as KaiPulse,
  });

  useEffect(() => {
    storageRef.current = getDefaultStorage();
    const stored = loadFromStorage(SM_PROPHECY_SIGILS_KEY, (raw) => decodeEnvelope(raw, 1, decodeStore), storageRef.current);
    if (!stored.ok) return;
    if (!stored.value) return;

    const next = stored.value.data;
    setState({
      byId: next.byId,
      ids: next.ids,
      lastUpdatedPulse: next.lastUpdatedPulse,
    });
    lastPersistedPulseRef.current = next.lastUpdatedPulse;
  }, []);

  useEffect(() => {
    if (state.lastUpdatedPulse === lastPersistedPulseRef.current) return;
    const envelope = wrapEnvelope(serializeStore(state), 1);
    const res = saveToStorage(SM_PROPHECY_SIGILS_KEY, envelope, storageRef.current);
    if (res.ok) lastPersistedPulseRef.current = state.lastUpdatedPulse;
  }, [state]);

  const addProphecy = (input: CreateProphecySigilInput): ProphecyRecord => {
    const id = asProphecyId(genId("prophecy"));
    const escrowPhiMicro = input.escrowPhiMicro ?? undefined;
    const rec: ProphecyRecord = {
      id,
      kind: "prophecy",
      text: input.text,
      category: input.category,
      expirationPulse: input.expirationPulse,
      escrowPhiMicro,
      evidence: input.evidence,
      sigil: input.sigil,
      createdAtPulse: input.createdAtPulse,
      updatedPulse: input.createdAtPulse,
    };

    setState((prev) => {
      const byId = { ...prev.byId, [id as unknown as string]: rec };
      const ids = [id, ...prev.ids];
      return {
        byId,
        ids,
        lastUpdatedPulse: Math.max(prev.lastUpdatedPulse, input.createdAtPulse),
      };
    });

    return rec;
  };

  const attachSigil = (id: ProphecyId, sigil: ProphecySigilArtifact, updatedPulse: KaiPulse): PersistResult<ProphecyRecord> => {
    let out: ProphecyRecord | null = null;
    setState((prev) => {
      const key = id as unknown as string;
      const existing = prev.byId[key];
      if (!existing) return prev;
      const next: ProphecyRecord = {
        ...existing,
        sigil,
        updatedPulse: Math.max(existing.updatedPulse, updatedPulse),
      };
      out = next;
      return {
        byId: { ...prev.byId, [key]: next },
        ids: prev.ids,
        lastUpdatedPulse: Math.max(prev.lastUpdatedPulse, updatedPulse),
      };
    });
    return out ? { ok: true, value: out } : { ok: false, error: "prophecy not found" };
  };

  const removeProphecy = (id: ProphecyId): void => {
    setState((prev) => {
      const key = id as unknown as string;
      if (!prev.byId[key]) return prev;
      const byId = { ...prev.byId };
      delete byId[key];
      const ids = prev.ids.filter((pid) => (pid as unknown as string) !== key);
      return { ...prev, byId, ids };
    });
  };

  const clear = (): void => {
    removeFromStorage(SM_PROPHECY_SIGILS_KEY, storageRef.current);
    setState({ byId: {}, ids: [], lastUpdatedPulse: 0 as KaiPulse });
  };

  const value = useMemo<SigilMarketsProphecySigilStore>(
    () => ({
      state,
      actions: {
        addProphecy,
        attachSigil,
        removeProphecy,
        clear,
      },
    }),
    [state],
  );

  return <SigilMarketsProphecySigilContext.Provider value={value}>{props.children}</SigilMarketsProphecySigilContext.Provider>;
};

export const useSigilMarketsProphecySigilStore = (): SigilMarketsProphecySigilStore => {
  const ctx = useContext(SigilMarketsProphecySigilContext);
  if (!ctx) throw new Error("useSigilMarketsProphecySigilStore must be used within <SigilMarketsProphecySigilProvider>");
  return ctx;
};

export const useProphecySigils = (): readonly ProphecyRecord[] => {
  const { state } = useSigilMarketsProphecySigilStore();
  return state.ids
    .map((id) => state.byId[id as unknown as string])
    .filter((p): p is ProphecyRecord => p !== undefined);
};
