import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import ts from "typescript";
import { test } from "node:test";

const tempRoot = mkdtempSync(join(process.cwd(), ".tmp-verify-bundle-"));
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

const verifyPath = new URL("../src/utils/verifySigil.ts", import.meta.url);
const sigilPath = new URL("../src/components/VerifierStamper/sigilUtils.ts", import.meta.url);
const verify = await import(pathToFileURL(transpileRecursive(verifyPath.href)).href);
const sigilUtils = await import(pathToFileURL(transpileRecursive(sigilPath.href)).href);

const { parseSlug, verifySigilSvg } = verify;
const { derivePhiKeyFromSig } = sigilUtils;

process.on("exit", () => {
  rmSync(tempRoot, { recursive: true, force: true });
});

test("verifySigilSvg passes for matching slug + embedded metadata", async () => {
  const pulse = 123;
  const kaiSignature = "abcdEFGH";
  const phiKey = await derivePhiKeyFromSig(kaiSignature);
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg">
      <metadata>{"pulse":${pulse},"kaiSignature":"${kaiSignature}","userPhiKey":"${phiKey}"}</metadata>
    </svg>
  `;
  const slug = parseSlug(`${pulse}-${kaiSignature.slice(0, 4)}`);
  const result = await verifySigilSvg(slug, svg);
  assert.equal(result.status, "ok");
  assert.equal(result.checks?.slugPulseMatches, true);
  assert.equal(result.checks?.slugShortSigMatches, true);
  assert.equal(result.checks?.derivedPhiKeyMatchesEmbedded, true);
});

test("verifySigilSvg accepts legacy data-attribute metadata", async () => {
  const pulse = 456;
  const kaiSignature = "LEGACYsig";
  const phiKey = await derivePhiKeyFromSig(kaiSignature);
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg"
      data-pulse="${pulse}"
      data-beat="7"
      data-step-index="2"
      data-frequency-hz="528"
      data-chakra-day="Root"
      data-chakra-gate="Gate-A"
      data-kai-signature="${kaiSignature}"
      data-phi-key="${phiKey}">
    </svg>
  `;
  const slug = parseSlug(`${pulse}-${kaiSignature.slice(0, 4)}`);
  const result = await verifySigilSvg(slug, svg);
  assert.equal(result.status, "ok");
  assert.equal(result.checks?.slugPulseMatches, true);
  assert.equal(result.checks?.slugShortSigMatches, true);
  assert.equal(result.embedded?.beat, 7);
  assert.equal(result.embedded?.stepIndex, 2);
  assert.equal(result.embedded?.frequencyHz, 528);
  assert.equal(result.embedded?.chakraDay, "Root");
  assert.equal(result.embedded?.chakraGate, "Gate-A");
});

test("verifySigilSvg fails when slug pulse mismatches embedded pulse", async () => {
  const pulse = 321;
  const kaiSignature = "sigXYZ";
  const phiKey = await derivePhiKeyFromSig(kaiSignature);
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg">
      <metadata>{"pulse":${pulse},"kaiSignature":"${kaiSignature}","userPhiKey":"${phiKey}"}</metadata>
    </svg>
  `;
  const slug = parseSlug(`${pulse + 1}-${kaiSignature.slice(0, 3)}`);
  const result = await verifySigilSvg(slug, svg);
  assert.equal(result.status, "error");
  assert.equal(result.checks?.slugPulseMatches, false);
});

test("verifySigilSvg passes for fixture sigils", async () => {
  const fixtures = [
    {
      file: new URL("./fixtures/sigils/golden-root.svg", import.meta.url),
      pulse: 111,
      kaiSignature: "ROOTSIG1234",
    },
    {
      file: new URL("./fixtures/sigils/golden-desc.svg", import.meta.url),
      pulse: 222,
      kaiSignature: "DESCSIG5678",
    },
  ];

  for (const fixture of fixtures) {
    const svg = readFileSync(fixture.file, "utf8");
    const slug = parseSlug(`${fixture.pulse}-${fixture.kaiSignature.slice(0, 4)}`);
    const result = await verifySigilSvg(slug, svg);
    assert.equal(result.status, "ok");
    assert.equal(result.checks?.slugPulseMatches, true);
    assert.equal(result.checks?.slugShortSigMatches, true);
  }
});
