const FIELD_MODULUS = BigInt(
  "21888242871839275222246405745257275088548364400416034343698204186575808495617"
);

const ROUND_CONSTANTS: [bigint, bigint][] = [
  [1n, 2n],
  [3n, 4n],
  [5n, 6n],
  [7n, 8n],
  [9n, 10n],
  [11n, 12n],
  [13n, 14n],
  [15n, 16n],
];

const MDS: [[bigint, bigint], [bigint, bigint]] = [
  [1n, 2n],
  [3n, 4n],
];

const mod = (value: bigint): bigint => {
  const res = value % FIELD_MODULUS;
  return res >= 0n ? res : res + FIELD_MODULUS;
};

const pow5 = (value: bigint): bigint => {
  const x2 = mod(value * value);
  const x4 = mod(x2 * x2);
  return mod(x4 * value);
};

export const toPoseidonField = (value: bigint): bigint => mod(value);

export const poseidonHash1 = (input: bigint): bigint => {
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
