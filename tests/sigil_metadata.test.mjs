import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { test } from "node:test";

async function loadTsModule(tsPath) {
  const source = readFileSync(tsPath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
    },
  }).outputText;
  const tempDir = mkdtempSync(join(process.cwd(), ".tmp-sigil-meta-"));
  const tempFile = join(tempDir, "sigilMetadata.mjs");
  writeFileSync(tempFile, transpiled, "utf8");
  const mod = await import(pathToFileURL(tempFile).href);
  rmSync(tempDir, { recursive: true, force: true });
  return mod;
}

const metaPath = new URL("../src/utils/sigilMetadata.ts", import.meta.url);
const meta = await loadTsModule(metaPath);

const { extractEmbeddedMetaFromSvg } = meta;

test("extractEmbeddedMetaFromSvg reads JSON in <metadata>", () => {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg">
      <metadata>{"pulse":123,"kaiSignature":"abc","phiKey":"φK-123","userPhiKey":"φK-123"}</metadata>
    </svg>
  `;
  const embedded = extractEmbeddedMetaFromSvg(svg);
  assert.equal(embedded.pulse, 123);
  assert.equal(embedded.kaiSignature, "abc");
  assert.equal(embedded.phiKey, "φK-123");
});

test("extractEmbeddedMetaFromSvg reads JSON in CDATA", () => {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg">
      <metadata><![CDATA[{"pulse":5,"kaiSignature":"xyz"}]]></metadata>
    </svg>
  `;
  const embedded = extractEmbeddedMetaFromSvg(svg);
  assert.equal(embedded.pulse, 5);
  assert.equal(embedded.kaiSignature, "xyz");
});

test("extractEmbeddedMetaFromSvg reads JSON in <desc>", () => {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg">
      <desc>{"pulse":77,"kaiSignature":"sig"} </desc>
    </svg>
  `;
  const embedded = extractEmbeddedMetaFromSvg(svg);
  assert.equal(embedded.pulse, 77);
  assert.equal(embedded.kaiSignature, "sig");
});

test("extractEmbeddedMetaFromSvg falls back to text scan", () => {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg">
      <text>{"kaiSignature":"fallback","pulse":9}</text>
    </svg>
  `;
  const embedded = extractEmbeddedMetaFromSvg(svg);
  assert.equal(embedded.pulse, 9);
  assert.equal(embedded.kaiSignature, "fallback");
});

test("extractEmbeddedMetaFromSvg falls back to nearby JSON block", () => {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg">
      <text>{"pulse":1}</text>
      <text>noise {"pulse":2,"kaiSignature":"nearby-sig","chakraDay":"Root"} tail</text>
    </svg>
  `;
  const embedded = extractEmbeddedMetaFromSvg(svg);
  assert.equal(embedded.pulse, 2);
  assert.equal(embedded.kaiSignature, "nearby-sig");
});

test("extractEmbeddedMetaFromSvg ignores unquoted kaiSignature labels", () => {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg">
      <text>kaiSignature</text>
      <metadata>{"pulse":88,"kaiSignature":"real-sig","userPhiKey":"φK-REAL"}</metadata>
    </svg>
  `;
  const embedded = extractEmbeddedMetaFromSvg(svg);
  assert.equal(embedded.pulse, 88);
  assert.equal(embedded.kaiSignature, "real-sig");
});

test("extractEmbeddedMetaFromSvg ignores unquoted kaiSignature JSON", () => {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg">
      <text>{kaiSignature:"nope","pulse":55}</text>
    </svg>
  `;
  const embedded = extractEmbeddedMetaFromSvg(svg);
  assert.equal(embedded.kaiSignature, undefined);
  assert.equal(embedded.pulse, undefined);
});

test("extractEmbeddedMetaFromSvg prefers outer block when kaiSignature is nested", () => {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg">
      <text>{"meta":{"kaiSignature":"INNER"},"pulse":123,"kaiSignature":"OUTER"}</text>
    </svg>
  `;
  const embedded = extractEmbeddedMetaFromSvg(svg);
  assert.equal(embedded.kaiSignature, "OUTER");
  assert.equal(embedded.pulse, 123);
});
