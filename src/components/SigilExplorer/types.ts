// src/components/SigilExplorer/types.ts
/* ─────────────────────────────────────────────────────────────────────
   Sigil Explorer — Shared Types
────────────────────────────────────────────────────────────────────── */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [k: string]: JsonValue };

export type ChakraDay = string;

/** What kind of content a URL represents (used for primary URL selection + grouping). */
export type ContentKind = "post" | "stream" | "other";

/** Minimal payload shape we rely on across the explorer (loose but typed). */
export type SigilSharePayloadLoose = {
  // Kairos stamp
  pulse?: number;
  beat?: number;
  stepIndex?: number;

  // Identity / display
  chakraDay?: ChakraDay;
  kaiSignature?: string;
  userPhiKey?: string;

  // Optional canonical hash for transfer linking
  canonicalHash?: string;

  // Optional feed embedding
  feed?: FeedPostPayload;

  // Optional parent/origin hints
  parentUrl?: string;
  originUrl?: string;

  // Allow extra fields without `any`
  [k: string]: unknown;
};

export type FeedPostPayload = {
  author?: string;
  usernameClaim?: unknown;
  [k: string]: unknown;
};

export type Registry = Map<string, SigilSharePayloadLoose>;

/** Explorer tree node presented in UI. */
export type SigilNode = {
  id: string;
  /** Primary URL used to open content in the browser */
  url: string;
  /** All URL variants we’ve seen for this content id */
  urls: string[];
  payload: SigilSharePayloadLoose;
  children: SigilNode[];
};

/** Summary used to sort forest branches deterministically. */
export type BranchSummary = {
  root: SigilNode;
  nodeCount: number;
  latest: SigilSharePayloadLoose;
};

/** Username claim registry entry (resolved / subscribed). */
export type UsernameClaimEntry = {
  normalized: string;
  claimHash: string;
  claimUrl: string;
  originHash?: string | null;
  ownerHint?: string | null;
};

export type UsernameClaimRegistry = Record<string, UsernameClaimEntry>;

/** Transfer registry record (persisted local memory). */
export type SigilTransferDirection = "send" | "receive";

export type SigilTransferRecord = {
  hash: string;
  direction: SigilTransferDirection;
  amountPhi: string;
  amountUsd?: string;
  sentPulse?: number;
  updatedAt: number;
};

/** Normalized move object derived from registry/payload/url. */
export type TransferMove = {
  direction: SigilTransferDirection;
  amount: number;
  amountUsd?: number;
  sentPulse?: number;
  source: "registry" | "payload";
};

/** Detail entry rendered in the expanded node panel. */
export type DetailEntry = {
  label: string;
  value: string;
};

/** Remote seal response (EXHALE seal check). */
export type ApiSealResponse = {
  seal: string;
};

/** Breath-loop / sync triggers. */
export type SyncReason = "open" | "pulse" | "visible" | "focus" | "online" | "import";

/** Small shared helpers (types only). */
export type UrlHealthScore = 1 | -1;

export type InhaleSource = "local" | "remote" | "hydrate" | "import";

export type AddUrlOptions = {
  includeAncestry?: boolean;
  broadcast?: boolean;
  persist?: boolean;
  source?: InhaleSource;
  enqueueToApi?: boolean;
};
