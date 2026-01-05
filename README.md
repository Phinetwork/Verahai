# SigilMarkets — Prediction Markets as Portable Sigil Artifacts

SigilMarkets is a **prediction experience** built on a different primitive:

> **Positions are not “rows in a database.”  
> They are minted as Sigil Glyph artifacts (SVG) that carry their own proof and can live offline.**

You browse markets, choose **YES/NO**, lock **Φ** from your Vault, and mint a **Position Sigil**.  
On resolution, positions become **claimable**, **refundable**, or **inert** (lost). Winning claims **grow your Vault**.

This module is designed to be:
- **Drop-in** for `phi.network` and also deployable as a standalone TSX app (e.g. `verahai.com`)
- **Offline-first**
- **Kai-Klok native** (pulse-based timing and pulse-synced UX)
- **Artifact-first** (portable receipts, verifiable outcomes)

---

## What this is (in one sentence)

**SigilMarkets is a prediction market UI + state engine where wagers mint self-verifying Sigil artifacts and settlement updates a Vault bound to a user’s identity glyph.**

---

## Core concepts

### 1) Market
A Market is a binary question:
- **YES**
- **NO**

Markets have:
- A question, category, tags
- Kai timing (openPulse / closePulse)
- Venue (AMM / parimutuel / optional CLOB)
- Oracle policy (how it resolves)
- Settlement policy (fees + redemption value)

### 2) Identity Sigil
Your identity glyph is **authentication**.  
It must contain (or you can manually provide):
- `userPhiKey`
- `kaiSignature`

The identity sigil is **never consumed**.

### 3) Vault (value-layer)
A Vault is the value layer derived from your identity artifact:

- Holds **spendable Φ**
- Holds **locked Φ** (escrow for open positions)
- Tracks locks and simple streak stats (win/loss)

> Vaults are deterministic identifiers derived from `userPhiKey + identitySvgHash`.

### 4) Lock (escrow)
When you wager, Φ is **locked**:
- Vault spendable decreases
- Lock is recorded with `lockId`, amount, and reason

A lock is later transitioned:
- `paid` (claim)
- `refunded` (void/cancel refund)
- `burned` or `paid` (loss settlement path)
- `released` (failed trade/cancel flow)

### 5) Position (wager receipt)
A Position is created per trade:
- marketId
- side (YES/NO)
- stake
- shares
- pricing snapshot
- lock reference (vaultId + lockId)

A Position moves through:
- `open` → `claimable` / `lost` / `refundable` → `claimed` / `refunded`

### 6) Position Sigil (portable artifact)
A Position Sigil is an **SVG artifact** that embeds:
- `SM-POS-1` payload JSON inside `<metadata>`
- identity binding (`userPhiKey`, `kaiSignature`)
- market binding (`marketId`, `positionId`)
- economics (`stakeMicro`, `sharesMicro`, prices, lock refs)
- Kai moment metadata (`openedAt`)

It also has a computed `svgHash` (sha256 hex) and an object URL for immediate use.

### 7) Resolution + Resolution Sigil
Markets resolve to:
- `YES`
- `NO`
- `VOID`

Resolution is recorded as:
- a market resolution object (oracle + evidence optional)
- (optionally) a Resolution Sigil artifact (`SM-RES-1`) for portable proof

### 8) Prophecy Feed (social engine)
A Prophecy is a **sealed forecast**:
- not a wager
- does not lock Φ
- designed for social sharing and reputation/accuracy leaderboards

Prophecies become:
- `fulfilled` / `missed` / `void` after market resolution

---

## Why this exists

People love prediction markets because they are:
- simple (YES/NO)
- fast feedback
- addictive price movement
- clean settlement

SigilMarkets adds what typical prediction markets cannot do natively:

### Portable prediction objects
Your position is a **thing** you can:
- store offline
- export and print
- share as proof
- later verify and redeem via its embedded payload

### Kai-Klok timing
Markets close in **Kai pulses**, not wall-clock seconds.  
The UX breathes and ticks with pulse alignment. It feels like “time is alive.”

### Identity without friction
Identity is bound to your sigil artifact (with optional ZK later) without forcing a conventional account model.

---

## Repository / Folder structure

This module lives at:


src/components/SigilMarkets/



High level layout:

- `types/` — all canonical types and object contracts
- `state/` — local stores (ui, markets, vaults, positions, feed) + persistence
- `hooks/` — derived selectors + pulse engine + UX tools (haptics/sfx)
- `api/` — local-first execution + optional remote fetch wiring
- `views/` — UI screens (MarketGrid, MarketRoom, Vault, Positions, Prophecy, Resolution)
- `ui/` — atoms/motion/chrome primitives used by views
- `sigils/` — inhale gate + sigil mint/export/scan/share
- `styles/` — module CSS
- `sounds/` — optional sound assets or synth helpers

Full spec’d structure:

```

SigilMarkets/
index.ts
SigilMarketsDock.tsx
SigilMarketsRoutes.tsx
SigilMarketsShell.tsx

styles/
sigilMarkets.css
breathe.css
motion.css

types/
marketTypes.ts
sigilPositionTypes.ts
vaultTypes.ts
oracleTypes.ts
uiTypes.ts

state/
marketStore.ts
vaultStore.ts
positionStore.ts
feedStore.ts
uiStore.ts
persistence.ts

hooks/
useKaiNow.ts
usePulseTicker.ts
useMarketGrid.ts
useMarket.ts
useVault.ts
usePositions.ts
useProphecyFeed.ts
useHaptics.ts
useSfx.ts
useStickyHeader.ts
useScrollRestoration.ts

api/
marketApi.ts
vaultApi.ts
positionApi.ts
oracleApi.ts
cacheApi.ts

utils/
format.ts
math.ts
ids.ts
risk.ts
shareText.ts
confetti.ts
localQueue.ts
guards.ts

ui/
atoms/
Button.tsx
Card.tsx
Chip.tsx
Divider.tsx
Icon.tsx
ProgressRing.tsx
Segmented.tsx
Sheet.tsx
Tooltip.tsx
Toast.tsx

motion/
  BreathGlow.tsx
  PulseSpark.tsx
  WinBurst.tsx
  LossFade.tsx
  KaiReveal.tsx

chrome/
  TopBar.tsx
  BottomNav.tsx
  FloatingAction.tsx
  SearchBar.tsx
  FilterRow.tsx
  Tabs.tsx


views/
MarketGrid/
MarketGrid.tsx
MarketCell.tsx
MarketHeat.tsx
MarketFilters.tsx
MarketSearch.tsx
MarketGridEmpty.tsx
MarketGridSkeleton.tsx


MarketRoom/
  MarketRoom.tsx
  MarketHeader.tsx
  MarketCountdown.tsx
  MarketChart.tsx
  MarketOrderPanel.tsx
  YesNoToggle.tsx
  StakeSlider.tsx
  QuotePreview.tsx
  LockConfirmSheet.tsx
  MintPositionSheet.tsx
  MarketActivity.tsx
  MarketRules.tsx
  MarketOracleBadge.tsx

Vault/
  VaultPanel.tsx
  VaultSigilCard.tsx
  VaultBalance.tsx
  VaultLocks.tsx
  VaultGrowthLine.tsx
  VaultStreak.tsx
  VaultActions.tsx
  DepositWithdrawSheet.tsx

Positions/
  PositionsHome.tsx
  PositionCard.tsx
  PositionDetail.tsx
  PositionTimeline.tsx
  ClaimSheet.tsx
  ExportPositionSheet.tsx
  TransferPositionSheet.tsx

Prophecy/
  ProphecyFeed.tsx
  ProphecyComposer.tsx
  SealPredictionSheet.tsx
  ProphecyCard.tsx
  ProphecyReplay.tsx
  ProphecyLeaderboard.tsx
  CreatorBadges.tsx

Resolution/
  ResolutionCenter.tsx
  ResolutionSigilCard.tsx
  OutcomeReveal.tsx
  DisputeSheet.tsx
  EvidenceViewer.tsx


sigils/
InhaleGlyphGate.tsx
PositionSigilMint.tsx
ResolutionSigilMint.tsx
SigilExport.tsx
SigilScanner.tsx
SigilShareSheet.tsx

sounds/
sfx.ts
```
---

## How the app flows

### A) Browse markets
`MarketGrid` shows a honeycomb/list of markets:
- YES/NO prices (cents-style)
- heat + closing-soon glow
- pulse countdown

**Route:** `grid`

### B) Open a market
`MarketRoom`:
- MarketHeader (question + status + countdown)
- MarketChart (live feeling sparkline)
- MarketOrderPanel (YES/NO, stake, quote, lock)
- Activity + Rules

**Route:** `market/:marketId`

### C) Inhale identity glyph (authentication)
If you’re not authed, trade/prophecy/vault actions prompt the **Inhale Gate**:
- upload SVG
- parse embedded metadata if present
- compute `svgHash`
- derive `vaultId`
- create/activate vault in local store

### D) Lock Φ and open position
In `MarketOrderPanel`:
1. select side
2. choose stake
3. preview quote
4. confirm lock

Execution (MVP local):
- `executeLocalTrade` computes quote + lockId + positionId
- `vaultStore.openLock` locks stake in vault
- `positionStore.openPosition` writes position record
- `feedStore.appendMarketActivity` records timeline event
- optional mint: `PositionSigilMint.mintPositionSigil`

### E) Market resolves
`SigilMarketsShell` watches the market list. When a market’s state becomes resolved:
- applies resolution to positions (`positionStore.applyMarketResolution`)
- applies resolution to prophecies (`feedStore.applyMarketResolutionToProphecies`)

### F) Claim or refund
On `PositionDetail`, if status is:
- `claimable` → claim
- `refundable` → refund

`ClaimSheet` applies MVP settlement:
- transition lock
- deposit payout/refund back to vault
- mark position `claimed` or `refunded`

---

## Determinism and units

### Φ units
All balances are stored as **integer microΦ**:
- `1 Φ = 1_000_000 microΦ`

All shares are stored as **microShares**:
- `1 share = 1_000_000 microShares`

Prices are stored as **microΦ per 1 share**:
- typical range `0..1_000_000` (0..1Φ/share)

### Kai time
SigilMarkets uses **Kai pulses** for all time constructs:
- Markets open/close at pulse boundaries
- UI tickers update on pulse boundaries
- “closing soon” is pulse-based

The module includes a bridge clock (`useKaiNow`) that can:
1. use `globalThis.__KAI_NOW_MICRO__()` if present
2. use `__KAI_ANCHOR_MICRO__ + performance.now()` as bridge
3. fall back to Date.now bridge (standalone)

---

## Offline-first behavior

All stores persist to localStorage (best effort):
- UI state (route, filters, sheets)
- markets cache
- vaults
- positions
- prophecy feed + activity

Persistence is versioned and salvageable:
- bad entries are skipped rather than crashing load
- envelopes include `v` and `savedAtMs`

---

## Remote integration points

This module is local-first but remote-ready.

### marketApi
- `fetchMarkets(cfg, nowPulse)`
- Remote contract supported:
  - `SerializedBinaryMarket[]`
  - `{ markets: SerializedBinaryMarket[], lastSyncedPulse?: number }`
- Caches via `cacheApi` (SWR)

Set a base URL with:
- `window.__SIGIL_MARKETS_API_BASE__ = "https://..."`

### vaultApi
Optional:
- `fetchVaultSnapshot(cfg, vaultId)`

Set:
- `window.__SIGIL_MARKETS_VAULT_API_BASE__`

### oracleApi
Provides canonical objects for:
- proposals
- finalization
- resolution sigil payload

Remote POSTs are stubs for now and should be wired to your Phi endpoints.

---

## Files you should start with (mental model)

If you are new to this module:

1. `SigilMarketsShell.tsx` — orchestrator, providers, resolution application
2. `types/marketTypes.ts` — the canonical market contract
3. `state/*Store.ts` — persisted state model
4. `api/positionApi.ts` — how trades become locks + positions
5. `sigils/PositionSigilMint.tsx` — how positions become portable artifacts
6. `views/MarketRoom/*` — the main “addictive loop” UI

---

## Using SigilMarkets in your app

### Minimal usage
```tsx
import { SigilMarketsShell } from "@/components/SigilMarkets";

export default function App(){
  return <SigilMarketsShell />;
}
````

### Window scrolling mode

```tsx
<SigilMarketsShell windowScroll />
```

### Custom market API configuration

```tsx
<SigilMarketsShell
  marketApiConfig={{
    baseUrl: "https://your-api",
    marketsPath: "/markets",
    cache: { maxAgeMs: 12000, staleWhileRevalidateMs: 60000 },
  }}
/>
```

---

## How Position Sigils are structured

### Payload version

Position sigils embed:

* `v: "SM-POS-1"`
* `kind: "position"`

### Location

Payload JSON is embedded into:

* `<metadata>{JSON}</metadata>`

And also mirrored via selected `data-*` attributes for convenience:

* `data-market-id`
* `data-position-id`
* `data-vault-id`
* `data-user-phikey`
* `data-kai-signature`

### Hashing

The minted SVG string is hashed (sha256) to produce:

* `svgHash`

This is used as a tamper-evident identity for the artifact.

---

## Security / trust model (MVP vs production)

### MVP (current state)

* Trades execute locally for UX + rapid iteration.
* Vault moves are local.
* Resolution application is store-based.

### Production direction

* Trades should be mirrored/validated by your ledger (Phi Network keys)
* Vault balances should reconcile against chain state
* Resolution should be signed and optionally dispute-gated
* Sigil verification should:

  * canonicalize JSON (JCS / deterministic stringify)
  * validate hashes
  * validate signatures (kaiSignature)
  * validate optional ZK proofs (uniqueness / anti-sybil)

This README documents the module as it exists now and the intended wiring.

---

## UX principles (why it feels “addictive”)

SigilMarkets is designed to be used like a ritual:

* Market grid is a living lattice (heat + breath)
* Every action is 2 taps (choose side, lock)
* A wager produces a physical-feeling artifact (Position Sigil)
* Vault feels like a living object that grows when you win
* Prophecy feed lets users “seal calls” even without betting

---

## Dev notes and conventions

* **No `any`** in TypeScript.
* **Bigint** for all monetary / share units.
* Persistence uses **decimal strings** for bigint fields.
* All view state is in `uiStore`.
* Avoid interval polling. Prefer:

  * app lifecycle events
  * pulse tick boundaries
  * focus/visibility/online triggers

---

## Current implementation status (what is done vs next)

### Done / working

* MarketGrid + MarketRoom + Vault + Positions UX
* Offline stores + persistence
* Kai pulse ticker and UI pulse binding
* Local trade execution (AMM-ish / parimutuel quote)
* Position Sigil minting (SVG + metadata + svgHash)
* Inhale glyph gate (upload SVG, parse metadata, derive vault)

### Next files to complete (already planned)

* `SigilExport.tsx` (SVG+PNG export)
* `ResolutionSigilMint.tsx` (resolution artifacts)
* Prophecy UI: composer, leaderboard, replay
* Resolution center UI: outcome reveal, dispute sheet, evidence viewer
* CLOB execution (optional)
* Real market series (replace fallback chart series)
* Remote trade submission hooks (Phi Network endpoints)

---

## FAQ

### “Does losing destroy my identity glyph?”

No.
**Identity Sigil is never consumed.**
Only the **Position Sigil** becomes inert and the **lock** is consumed.

### “What does it mean to lock Φ into a glyph?”

It means:

* The Vault value layer bound to your identity creates an escrow lock record
* That lock backs a Position
* On win, you claim and your Vault is credited
* On loss, the lock is consumed

### “Can I use this offline?”

Yes.
Markets can be seeded locally. All state persists locally.

### “Can I print a Position Sigil?”

Yes.
It is an SVG artifact. Printing preserves the embedded metadata (as long as you preserve the file itself).
For physical workflows, we add QR bundles (SigilScanner + SigilShare) next.

### “How do I integrate with my backend?”

Start by wiring:

* `marketApi.fetchMarkets` to your `/markets`
* later, wire `oracleApi` and `positionApi` to your chain endpoints

---

## License / ownership

This README describes the technical system behavior and its code structure.
Project-level licensing, authorship, and protocol law are defined by the parent repo’s canonical legal framework (Phi Network / Kai-Klok system).

---

## Quick start for contributors

1. Read `types/marketTypes.ts`
2. Read `SigilMarketsShell.tsx`
3. Read `state/*Store.ts`
4. Read `api/positionApi.ts`
5. Read `sigils/PositionSigilMint.tsx`
6. Run the module inside a host app and open MarketGrid.

---

## Summary

SigilMarkets turns prediction markets into **portable, verifiable artifacts**:

* markets live in Kai time
* positions mint as sigils
* vault grows on wins
* prophecy feed adds social proof

If you’ve ever thought:

> “I wish I could *prove* I called it — and hold it in my hand,”
> this is that.
