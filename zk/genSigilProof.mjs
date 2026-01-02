// zk/genSigilProof.mjs
import fs from "fs";
import { execSync } from "child_process";

const FIELD_MODULUS = BigInt(
  "21888242871839275222246405745257275088548364400416034343698204186575808495617"
);

const RC = [
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

const mod = (v) => ((v % FIELD_MODULUS) + FIELD_MODULUS) % FIELD_MODULUS;
const pow5 = (v) => {
  const sq = mod(v * v);
  const quad = mod(sq * sq);
  return mod(quad * v);
};

const poseidon1 = (input) => {
  let x0 = mod(input);
  let x1 = 0n;

  for (let r = 0; r < 8; r += 1) {
    const t0 = mod(x0 + RC[r][0]);
    const t1 = mod(x1 + RC[r][1]);
    const s0 = pow5(t0);
    const s1 = pow5(t1);

    x0 = mod(s0 * MDS[0][0] + s1 * MDS[0][1]);
    x1 = mod(s0 * MDS[1][0] + s1 * MDS[1][1]);
  }

  return x0;
};

const run = async () => {
  const secretInput = process.argv[2];

  if (!secretInput) {
    console.error("❌ Usage: node zk/genSigilProof.mjs <secretPhraseOrNumber>");
    process.exit(1);
  }

  const secret = BigInt(secretInput);
  const expectedHash = poseidon1(secret).toString();

  console.log("🔐 Expected Hash:", expectedHash);

  // Step 1: Write input.json
  const input = {
    secret: secret.toString(),
    expectedHash
  };

  const inputPath = "zk/input.json";
  fs.writeFileSync(inputPath, JSON.stringify(input, null, 2));
  console.log("✅ Wrote:", inputPath);

  // Step 2: Run witness
  console.log("⚙️  Calculating witness...");
  execSync(`snarkjs wtns calculate public/zk/sigil_proof.wasm ${inputPath} zk/witness.wtns`, {
    stdio: "inherit"
  });

  // Step 3: Run proof
  console.log("🔮 Generating proof...");
  execSync(`snarkjs groth16 prove public/zk/sigil_proof_final.zkey zk/witness.wtns zk/proof.json zk/public.json`, {
    stdio: "inherit"
  });

  console.log("✅ Proof and public outputs generated.");

// Step 4: Show result for embedding
const proof = JSON.parse(fs.readFileSync("zk/proof.json"));
const pub = JSON.parse(fs.readFileSync("zk/public.json"));

const zkEmbed = {
  zkPoseidonHash: pub[0],
  zkProof: {
    pi_a: proof.pi_a,
    pi_b: proof.pi_b,
    pi_c: proof.pi_c
  }
};

console.log("\n📦 Embed this in your SVG or manifest:");
console.log(JSON.stringify(zkEmbed, null, 2));


};

run();
