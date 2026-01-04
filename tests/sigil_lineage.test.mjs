import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import JSZip from "jszip";

async function loadTsModule(tsPath) {
  const source = readFileSync(tsPath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
    },
  }).outputText;
  const dataUrl = `data:text/javascript,${encodeURIComponent(transpiled)}`;
  return import(dataUrl);
}

const lineagePath = new URL("../src/SigilMarkets/utils/lineage.ts", import.meta.url);
const verifyPath = new URL("../src/SigilMarkets/utils/verifySigilLineage.ts", import.meta.url);
const mintPath = new URL("../src/SigilMarkets/sigils/PositionSigilMint.tsx", import.meta.url);
const ledgerPath = new URL("../src/utils/sigilLedgerRegistry.ts", import.meta.url);
const bundlePath = new URL("../src/SigilMarkets/sigils/victoryBundle.ts", import.meta.url);
const sigilUtilsPath = new URL("../src/components/VerifierStamper/sigilUtils.ts", import.meta.url);

const lineage = await loadTsModule(lineagePath);
const verify = await loadTsModule(verifyPath);
const mint = await loadTsModule(mintPath);
const ledger = await loadTsModule(ledgerPath);
const bundle = await loadTsModule(bundlePath);
const sigilUtils = await loadTsModule(sigilUtilsPath);

test("deriveLineageId is deterministic", async () => {
  const moment = { pulse: 123, beat: 4, stepIndex: 7 };
  const a = await lineage.deriveLineageId({
    lineageRootSvgHash: "root-hash",
    marketId: "market-1",
    positionId: "pos-1",
    sideOrOutcome: "YES",
    kaiMoment: moment,
  });
  const b = await lineage.deriveLineageId({
    lineageRootSvgHash: "root-hash",
    marketId: "market-1",
    positionId: "pos-1",
    sideOrOutcome: "YES",
    kaiMoment: moment,
  });
  assert.equal(a, b);
});

test("verifySigilLineage succeeds and fails deterministically", async () => {
  const rootSvg = `<svg xmlns="http://www.w3.org/2000/svg"><metadata>{"root":"sigil"}</metadata></svg>`;
  const rootHash = await lineage.canonicalSvgHash(rootSvg);
  const moment = { pulse: 12, beat: 3, stepIndex: 9 };
  const kaiSignature = "sig-test-1";
  const userPhiKey = await sigilUtils.derivePhiKeyFromSig(kaiSignature);

  const lineageId = await lineage.deriveLineageId({
    lineageRootSvgHash: rootHash,
    marketId: "market-2",
    positionId: "pos-2",
    sideOrOutcome: "NO",
    kaiMoment: moment,
  });

  const payload = {
    v: "SM-POS-1",
    kind: "position",
    marketId: "market-2",
    positionId: "pos-2",
    side: "NO",
    lineageRootSvgHash: rootHash,
    lineageId,
    kaiMoment: moment,
    userPhiKey,
    kaiSignature,
  };
  const childSvg = `<svg xmlns="http://www.w3.org/2000/svg"><metadata><![CDATA[${JSON.stringify(payload)}]]></metadata></svg>`;

  const ok = await verify.verifySigilLineage(childSvg, rootSvg);
  assert.equal(ok.ok, true);

  const bad = await verify.verifySigilLineage(childSvg, "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>");
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.length > 0);
});

test("claim payload enforces payout zero on loss", async () => {
  const pos = {
    id: "pos-loss",
    marketId: "market-loss",
    lock: {
      vaultId: "vault-loss",
      lockId: "lock-loss",
      lockedStakeMicro: 5000000n,
    },
    entry: {
      side: "YES",
      stakeMicro: 5000000n,
      feeMicro: 0n,
      totalCostMicro: 5000000n,
      sharesMicro: 1000000n,
      avgPriceMicro: 5000000n,
      worstPriceMicro: 5000000n,
      venue: "amm",
      openedAt: { pulse: 2, beat: 1, stepIndex: 0 },
    },
    payoutModel: "amm-shares",
    status: "lost",
    resolution: { outcome: "NO", resolvedPulse: 44 },
    updatedPulse: 44,
  };

  const vault = {
    vaultId: "vault-loss",
    owner: {
      userPhiKey: "phi-loss",
      kaiSignature: "kai-loss",
      identitySigil: {
        svgHash: "root-svg-hash",
      },
    },
    status: "active",
    spendableMicro: 0n,
    lockedMicro: 0n,
    locks: [],
    createdPulse: 0,
    updatedPulse: 0,
  };

  const payload = await mint.buildClaimPayload(pos, vault, { pulse: 44, beat: 0, stepIndex: 0 }, 9000000n);
  assert.equal(payload.payoutPhiMicro, "0");
});

test("victory bundle zip includes expected files", async () => {
  const zipRes = await bundle.buildVictoryBundleZip({
    svgText: "<svg/>",
    receipt: { ok: true },
    proof: { ok: true },
    readme: "hello",
    filenameBase: "bundle-test",
    output: "uint8array",
  });
  assert.ok(zipRes.data && zipRes.data.length > 0);

  const loaded = await JSZip.loadAsync(zipRes.data);
  assert.ok(loaded.file("claim-sigil.svg"));
  assert.ok(loaded.file("receipt.json"));
  assert.ok(loaded.file("proof.json"));
  assert.ok(loaded.file("README.txt"));
});

test("ledger event merge is idempotent", () => {
  const event = {
    eventId: "evt-1",
    kind: "DEPOSIT",
    rootSigilId: "root",
    rootSvgHash: "hash",
    kaiMoment: { pulse: 1, beat: 1, stepIndex: 1 },
    deltaPhiMicro: "10",
    resultingBalanceMicro: "10",
  };
  const merged = ledger.mergeLedgerEvents([event], [event]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].eventId, "evt-1");
});
