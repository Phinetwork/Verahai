import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { groth16 } from "snarkjs";
import handler, { loadSigilVkey } from "../api/proof/sigil.js";

const ARTIFACTS_DIR = path.join(process.cwd(), "public", "zk");
const requiredArtifacts = [
  path.join(ARTIFACTS_DIR, "sigil_proof.wasm"),
  path.join(ARTIFACTS_DIR, "sigil_proof_final.zkey"),
  path.join(ARTIFACTS_DIR, "verification_key.json"),
];

const hasArtifacts = requiredArtifacts.every((file) => fs.existsSync(file));

test(
  "Groth16 proofs vary with expectedHash inputs",
  { skip: !hasArtifacts, timeout: 180_000 },
  async () => {
    const vkey = await loadSigilVkey();

    const callApi = async (body) =>
      new Promise((resolve) => {
        const req = Readable.from([Buffer.from(JSON.stringify(body))]);
        const res = {
          statusCode: 0,
          headers: {},
          setHeader(key, value) {
            this.headers[key] = value;
          },
          end(chunk) {
            resolve({
              statusCode: this.statusCode,
              body: chunk ? chunk.toString("utf8") : "",
            });
          },
        };
        handler(req, res);
      });

    const resA = await callApi({ secret: "1", expectedHash: "1" });
    const resB = await callApi({ secret: "2", expectedHash: "2" });

    assert.equal(resA.statusCode, 200, "proof A should return 200");
    assert.equal(resB.statusCode, 200, "proof B should return 200");

    const proofA = JSON.parse(resA.body);
    const proofB = JSON.parse(resB.body);

    assert.ok(
      await groth16.verify(vkey, proofA.zkPublicInputs, proofA.zkProof),
      "proof A should verify"
    );
    assert.ok(
      await groth16.verify(vkey, proofB.zkPublicInputs, proofB.zkProof),
      "proof B should verify"
    );

    assert.equal(proofA.zkPublicInputs[0], "1", "public input should match expectedHash A");
    assert.equal(proofB.zkPublicInputs[0], "2", "public input should match expectedHash B");

    assert.notStrictEqual(
      JSON.stringify(proofA.zkProof),
      JSON.stringify(proofB.zkProof),
      "proofs should differ for different expected hashes"
    );
  }
);
