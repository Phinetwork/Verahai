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

const kaiPulsePath = new URL("../src/utils/kai_pulse.ts", import.meta.url);
const kai = await loadTsModule(kaiPulsePath);

const {
  normalizePercentIntoStep,
  momentFromUTC,
  PULSE_MS,
  PULSES_STEP,
  STEPS_BEAT,
  BEATS_DAY,
  DAYS_PER_MONTH,
  DAYS_PER_YEAR,
} = kai;

test("normalizePercentIntoStep clamps into [0,1)", () => {
  assert.equal(normalizePercentIntoStep(-0.2), 0);
  assert.equal(normalizePercentIntoStep(0.5), 0.5);
  assert.ok(normalizePercentIntoStep(1) < 1, "upper bound is open");
});

test("PULSE_MS matches φ-derived breath length", () => {
  assert.equal(PULSE_MS, Math.round((3 + Math.sqrt(5)) * 1000));
});

test("momentFromUTC bridges UTC milliseconds to Kai moment", () => {
  const moment = momentFromUTC(new Date(1715323541888));
  assert.equal(typeof moment.pulse, "number");
  assert.equal(moment.stepIndex < PULSES_STEP * STEPS_BEAT, true);
  assert.equal(moment.beat < BEATS_DAY, true);
});

test("calendar sizes are consistent", () => {
  assert.equal(DAYS_PER_YEAR, DAYS_PER_MONTH * 8);
});

