import assert from "node:assert/strict";
import test from "node:test";
import { groth16 } from "snarkjs";

import { generateSigilProof, loadSigilVkey } from "../api/proof/sigil.js";

const FIELD_MODULUS = BigInt(
  "21888242871839275222246405745257275088548364400416034343698204186575808495617"
);

const ROUND_CONSTANTS = [
  [1n, 2n],
  [3n, 4n],
  [5n, 6n],
  [7n, 8n],
  [9n, 10n],
  [11n, 12n],
  [13n, 14n],
  [15n, 16n],
];

const MDS = [
  [1n, 2n],
  [3n, 4n],
];

const mod = (value) => {
  const res = value % FIELD_MODULUS;
  return res >= 0n ? res : res + FIELD_MODULUS;
};

const pow5 = (value) => {
  const x2 = mod(value * value);
  const x4 = mod(x2 * x2);
  return mod(x4 * value);
};

const poseidonHash1 = (input) => {
  let s0 = mod(input);
  let s1 = 0n;

  for (const [c0, c1] of ROUND_CONSTANTS) {
    const t0 = mod(s0 + c0);
    const t1 = mod(s1 + c1);
    const sbox0 = pow5(t0);
    const sbox1 = pow5(t1);
    const m0 = mod(sbox0 * MDS[0][0] + sbox1 * MDS[0][1]);
    const m1 = mod(sbox0 * MDS[1][0] + sbox1 * MDS[1][1]);
    s0 = m0;
    s1 = m1;
  }

  return s0;
};

test("sigil proof API generates distinct, valid proofs", async () => {
  const secretA = "123";
  const secretB = "456";
  const expectedA = poseidonHash1(BigInt(secretA)).toString();
  const expectedB = poseidonHash1(BigInt(secretB)).toString();

  const proofA = await generateSigilProof({ secret: secretA, expectedHash: expectedA });
  const proofB = await generateSigilProof({ secret: secretB, expectedHash: expectedB });

  assert.equal(proofA.zkPublicInputs[0], expectedA);
  assert.equal(proofB.zkPublicInputs[0], expectedB);
  assert.notDeepEqual(proofA.zkProof, proofB.zkProof);

  const vkey = await loadSigilVkey();
  const verifiedA = await groth16.verify(vkey, proofA.zkPublicInputs, proofA.zkProof);
  const verifiedB = await groth16.verify(vkey, proofB.zkPublicInputs, proofB.zkProof);

  assert.equal(verifiedA, true);
  assert.equal(verifiedB, true);
});
