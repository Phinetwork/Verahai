import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { webcrypto } from "node:crypto";
import { test } from "node:test";
import ts from "typescript";
import { groth16 } from "snarkjs";

if (!globalThis.crypto) {
  globalThis.crypto = webcrypto;
}

const tempRoot = mkdtempSync(join(process.cwd(), ".tmp-sigil-bundle-"));
const moduleCache = new Map();

const IMPORT_FROM_RE = /from\s+["']([^"']+)["']/g;
const IMPORT_CALL_RE = /import\(\s*["']([^"']+)["']\s*\)/g;

function resolveImport(spec, baseFile) {
  if (!spec.startsWith(".")) return null;
  const baseDir = dirname(baseFile);
  const candidates = [
    spec,
    `${spec}.ts`,
    `${spec}.tsx`,
    `${spec}.js`,
    `${spec}.jsx`,
  ];
  for (const candidate of candidates) {
    const full = resolve(baseDir, candidate);
    if (existsSync(full)) return full;
  }
  return null;
}

function gatherImports(source) {
  const specs = new Set();
  for (const match of source.matchAll(IMPORT_FROM_RE)) {
    specs.add(match[1]);
  }
  for (const match of source.matchAll(IMPORT_CALL_RE)) {
    specs.add(match[1]);
  }
  return [...specs];
}

function rewriteImports(code, replacements) {
  let out = code;
  for (const [spec, replacement] of replacements) {
    out = out.replaceAll(`"${spec}"`, `"${replacement}"`);
    out = out.replaceAll(`'${spec}'`, `'${replacement}'`);
  }
  return out;
}

function transpileRecursive(fileUrl) {
  const filePath = fileURLToPath(fileUrl);
  if (moduleCache.has(filePath)) return moduleCache.get(filePath);

  const source = readFileSync(filePath, "utf8");
  const imports = gatherImports(source);
  const replacements = new Map();

  for (const spec of imports) {
    const resolved = resolveImport(spec, filePath);
    if (!resolved) continue;
    const depUrl = pathToFileURL(resolved).href;
    const compiledPath = transpileRecursive(depUrl);
    replacements.set(spec, pathToFileURL(compiledPath).href);
  }

  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
    },
  }).outputText;

  const rewritten = rewriteImports(transpiled, replacements);
  const tempFile = join(
    tempRoot,
    `${basename(filePath).replace(/\W+/g, "_")}-${Date.now()}-${Math.random().toString(16).slice(2)}.mjs`
  );
  writeFileSync(tempFile, rewritten, "utf8");
  moduleCache.set(filePath, tempFile);
  return tempFile;
}

process.on("exit", () => {
  rmSync(tempRoot, { recursive: true, force: true });
});

const svgProofPath = new URL("../src/utils/svgProof.ts", import.meta.url);
const verifierPath = new URL("../src/components/KaiVoh/verifierProof.ts", import.meta.url);
const metaPath = new URL("../src/utils/sigilMetadata.ts", import.meta.url);
const kasPath = new URL("../src/utils/webauthnKAS.ts", import.meta.url);
const shaPath = new URL("../src/utils/sha256.ts", import.meta.url);
const kaiPath = new URL("../src/utils/kai.ts", import.meta.url);

const svgProof = await import(pathToFileURL(transpileRecursive(svgProofPath.href)).href);
const verifier = await import(pathToFileURL(transpileRecursive(verifierPath.href)).href);
const meta = await import(pathToFileURL(transpileRecursive(metaPath.href)).href);
const kas = await import(pathToFileURL(transpileRecursive(kasPath.href)).href);
const sha = await import(pathToFileURL(transpileRecursive(shaPath.href)).href);
const kai = await import(pathToFileURL(transpileRecursive(kaiPath.href)).href);

const { embedProofMetadata } = svgProof;
const {
  buildBundleUnsigned,
  hashBundle,
  hashProofCapsuleV1,
  hashSvgText,
  PROOF_CANON,
  PROOF_HASH_ALG,
} = verifier;
const { extractProofBundleMetaFromSvg } = meta;
const { verifyBundleAuthorSig } = kas;
const { base64UrlEncode, hexToBytes, sha256Bytes } = sha;
const { computeZkPoseidonHash } = kai;

function makeRandomBytes(size) {
  const out = new Uint8Array(size);
  crypto.getRandomValues(out);
  return out;
}

async function makeAuthorSig(bundleHash) {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
  const pubKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const credId = base64UrlEncode(makeRandomBytes(16));
  const authenticatorData = makeRandomBytes(37);
  const challengeBytes = hexToBytes(bundleHash);
  const challenge = base64UrlEncode(challengeBytes);
  const clientData = JSON.stringify({
    type: "webauthn.get",
    challenge,
    origin: "https://example.test",
  });
  const clientDataBytes = new TextEncoder().encode(clientData);
  const clientDataHash = await sha256Bytes(clientDataBytes);
  const signedPayload = new Uint8Array(authenticatorData.length + clientDataHash.length);
  signedPayload.set(authenticatorData, 0);
  signedPayload.set(clientDataHash, authenticatorData.length);
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    keyPair.privateKey,
    signedPayload
  );

  return {
    v: "KAS-1",
    alg: "webauthn-es256",
    credId,
    pubKeyJwk,
    challenge,
    signature: base64UrlEncode(new Uint8Array(signature)),
    authenticatorData: base64UrlEncode(authenticatorData),
    clientDataJSON: base64UrlEncode(clientDataBytes),
  };
}

test("sigil proof bundle hashes/signature stay deterministic with zk proof", async () => {
  const payloadHashHex = "0".repeat(63) + "1";
  const { hash: zkPoseidonHash, secret } = await computeZkPoseidonHash(payloadHashHex);
  const { generateSigilProof, loadSigilVkey } = await import("../api/proof/sigil.js");
  const { zkProof, zkPublicInputs, proofHints } = await generateSigilProof({
    secret,
    expectedHash: zkPoseidonHash,
  });
  const vkey = await loadSigilVkey();

  const baseSvg = `<svg xmlns="http://www.w3.org/2000/svg"><g><text>Kai</text></g></svg>`;
  const proofCapsule = {
    v: "KPV-1",
    pulse: 123,
    chakraDay: "Root",
    kaiSignature: "deadbeef",
    phiKey: "phi-test",
    verifierSlug: "123-deadbeef",
  };
  const capsuleHash = await hashProofCapsuleV1(proofCapsule);
  const svgHash = await hashSvgText(baseSvg);

  const proofBundleBase = {
    v: "KPB-1",
    hashAlg: PROOF_HASH_ALG,
    canon: PROOF_CANON,
    proofCapsule,
    capsuleHash,
    svgHash,
    shareUrl: "https://example.test/share",
    verifierUrl: "https://example.test/verify/123-deadbeef",
    authorSig: null,
    zkPoseidonHash,
    zkProof,
    proofHints,
    zkPublicInputs,
  };

  const bundleUnsigned = buildBundleUnsigned(proofBundleBase);
  const bundleHash = await hashBundle(bundleUnsigned);
  const authorSig = await makeAuthorSig(bundleHash);
  const proofBundleSigned = { ...proofBundleBase, bundleHash, authorSig };

  const sealedSvg = embedProofMetadata(baseSvg, proofBundleSigned);
  const embedded = extractProofBundleMetaFromSvg(sealedSvg);
  assert.ok(embedded?.raw, "embedded bundle should be detected");

  const svgHashNext = await hashSvgText(sealedSvg);
  assert.equal(svgHashNext, svgHash);

  const embeddedRaw =
    embedded && embedded.raw && typeof embedded.raw === "object" ? embedded.raw : {};
  const embeddedUnsigned = buildBundleUnsigned({
    ...embeddedRaw,
    svgHash: svgHashNext,
    capsuleHash,
    proofCapsule,
  });
  const bundleHashNext = await hashBundle(embeddedUnsigned);
  assert.equal(bundleHashNext, bundleHash);

  const sigOk = await verifyBundleAuthorSig(bundleHashNext, authorSig);
  assert.equal(sigOk, true);

  const zkVerified = await groth16.verify(vkey, zkPublicInputs, zkProof);
  assert.equal(zkVerified, true);
});
