// src/components/SigilExplorer/index.ts
/* ──────────────────────────────────────────────────────────────────────────────
   Sigil Explorer — Safe barrel exports
   - Explicit exports only (no `export *`)
────────────────────────────────────────────────────────────────────────────── */

/* Types */
export type {
  JsonPrimitive,
  JsonValue,
  JsonObject,
  ChakraDay,
  ContentKind,
  SigilSharePayloadLoose,
  FeedPostPayload,
  Registry,
  UsernameClaimEntry,
  UsernameClaimRegistry,
  SigilTransferDirection,
  SigilTransferRecord,
  TransferMove,
  DetailEntry,
  ApiSealResponse,
  SyncReason,
  UrlHealthScore,
  InhaleSource,
  AddUrlOptions,
} from "./types";

/* Chakra */
export { chakraTintStyle, normalizeChakraKey, CHAKRA_COLORS } from "./chakra";

/* Formatting */
export { short, formatPhi, formatUsd, byKaiTime, getPhiFromPayload } from "./format";

/* Kai cadence */
export { hasWindow, nowMs, msUntilNextKaiBreath } from "./kaiCadence";

/* URL */
export {
  canonicalizeUrl,
  browserViewUrl,
  explorerOpenUrl,
  extractPayloadFromUrl,
  parseHashFromUrl,
  isPTildeUrl,
  contentKindForUrl,
  scoreUrlForView,
  pickPrimaryUrl,
  getOriginUrl,
  cssEscape,
  momentKeyFor,
  contentIdFor,
  parseStreamToken,
  streamHashViewerUrlFromToken,
  streamUrlFromToken,
  viewBaseOrigin,
  VIEW_BASE_FALLBACK,
} from "./url";

/* URL health */
export { urlHealth, loadUrlHealthFromStorage, setUrlHealth, probeUrl } from "./urlHealth";

/* API client */
export {
  apiFetchWithFailover,
  apiFetchJsonWithFailover,
  API_SEAL_PATH,
  API_URLS_PATH,
  API_INHALE_PATH,
  LIVE_BASE_URL,
  LIVE_BACKUP_URL,
  loadApiBackupDeadUntil,
  loadApiBaseHint,
} from "./apiClient";

/* Registry store */
export {
  memoryRegistry,
  REGISTRY_LS_KEY,
  MODAL_FALLBACK_LS_KEY,
  hydrateRegistryFromStorage,
  persistRegistryToStorage,
  parseImportedJson,
  addUrl,
  isOnline,
} from "./registryStore";

/* Inhale queue */
export {
  enqueueInhaleRawKrystal,
  enqueueInhaleKrystal,
  enqueueInhaleUrl,
  flushInhaleQueue,
  forceInhaleUrls,
  seedInhaleFromRegistry,
  loadInhaleQueueFromStorage,
  saveInhaleQueueToStorage,
} from "./inhaleQueue";

/* Remote pull */
export { pullAndImportRemoteUrls } from "./remotePull";

/* Witness */
export { getUsernameClaimRegistry, normalizeUsername, subscribeUsernameClaimRegistry } from "./witness";

/* Transfers */
export {
  SIGIL_TRANSFER_CHANNEL_NAME,
  SIGIL_TRANSFER_EVENT,
  SIGIL_TRANSFER_LS_KEY,
  readSigilTransferRegistry,
  getTransferMoveFromPayload,
  getTransferMoveFromRegistry,
  getTransferMoveFromTransferUrl,
} from "./transfers";

/* Tree */
export { buildForest, resolveCanonicalHashFromNode } from "./tree/buildForest";
export type { SigilNode } from "./tree/types";
