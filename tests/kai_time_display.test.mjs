import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  const dataUrl = `data:text/javascript,${encodeURIComponent(transpiled)}`;
  return import(dataUrl);
}

const displayPath = new URL("../src/utils/kaiTimeDisplay.ts", import.meta.url);
const display = await loadTsModule(displayPath);

const { readNum, fmt2, formatPulse, modPos } = display;

test("readNum returns numbers and rejects non-numeric input", () => {
  assert.equal(readNum({ pulse: 123 }, "pulse"), 123);
  assert.equal(readNum({ pulse: "123" }, "pulse"), null);
  assert.equal(readNum(null, "pulse"), null);
});

test("fmt2 pads and formats numbers", () => {
  assert.equal(fmt2(3), "03");
  assert.equal(fmt2(12.9), "12");
  assert.equal(fmt2(-1), "-1");
});

test("formatPulse handles ranges and formatting", () => {
  assert.equal(formatPulse(42), "000042");
  assert.equal(formatPulse(1_234_567), "1,234,567");
  assert.equal(formatPulse(NaN), "—");
});

test("modPos returns positive modulo for negatives", () => {
  assert.equal(modPos(-1, 10), 9);
  assert.equal(modPos(12, 10), 2);
});
