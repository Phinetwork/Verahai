import {Buffer} from "node:buffer";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { groth16 } from "snarkjs";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACTS_DIR = path.resolve(MODULE_DIR, "../../public/zk");
const WASM_PATH = path.join(ARTIFACTS_DIR, "sigil_proof.wasm");
const ZKEY_PATH = path.join(ARTIFACTS_DIR, "sigil_proof_final.zkey");
const VKEY_PATH = path.join(ARTIFACTS_DIR, "verification_key.json");

async function loadSigilVkey() {
  const raw = await fs.readFile(VKEY_PATH, "utf8");
  return JSON.parse(raw);
}

function normalizeValue(value) {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map((entry) => normalizeValue(entry));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, normalizeValue(entry)])
    );
  }
  return value;
}

function normalizePublicSignals(signals) {
  if (!Array.isArray(signals)) return [];
  return signals.map((entry) => {
    if (typeof entry === "bigint") return entry.toString();
    if (typeof entry === "number") return entry.toString();
    return String(entry);
  });
}

export async function generateSigilProof({
  secret,
  expectedHash,
} = {}) {
  const canonicalSecret = secret != null ? String(secret).trim() : "";
  const canonicalExpectedHash =
    expectedHash != null ? String(expectedHash).trim() : "";

  if (!canonicalSecret || !canonicalExpectedHash) {
    throw new Error("Missing secret/expectedHash");
  }

  const input = {
    secret: canonicalSecret,
    expectedHash: canonicalExpectedHash,
  };

  const { proof, publicSignals } = await groth16.fullProve(
    input,
    WASM_PATH,
    ZKEY_PATH
  );

  const normalizedProof = normalizeValue(proof);
  const normalizedSignals = normalizePublicSignals(publicSignals);
  if (normalizedSignals.length < 1) {
    throw new Error("ZK public input missing");
  }
  const publicInput0 = normalizedSignals[0];

  if (publicInput0 !== canonicalExpectedHash) {
    throw new Error("ZK public input mismatch");
  }

  const vkey = await loadSigilVkey();
  const verified = await groth16.verify(vkey, normalizedSignals, normalizedProof);
  if (!verified) {
    throw new Error("ZK proof failed verification");
  }

  return {
    zkPoseidonHash: publicInput0,
    zkProof: normalizedProof,
    zkPublicInputs: normalizedSignals,
    proofHints: {
      scheme: "groth16-poseidon",
      api: "/api/proof/sigil",
      explorer: `/keystream/hash/${publicInput0}`,
    },
  };
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export default async function handler(req, res) {
  
  try {
    const body = await readJsonBody(req);
    const result = await generateSigilProof(body);
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(result));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Proof generation failed";
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: message }));
  }
}

export const config = {
  runtime: "nodejs",
};

export { loadSigilVkey };
