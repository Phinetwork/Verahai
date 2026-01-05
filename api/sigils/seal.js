import crypto from "node:crypto";
import { sigilStore } from "./store.js";

const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const safeCdata = (raw) => {
  const safe = String(raw).replace(/]]>/g, "]]]]><![CDATA[>");
  return `<![CDATA[${safe}]]>`;
};


const sha256Hex = (value) => crypto.createHash("sha256").update(value).digest("hex");

const isRecord = (v) => typeof v === "object" && v !== null;

const toJsonValue = (v) => {
  if (v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (Array.isArray(v)) return v.map((x) => toJsonValue(x));
  if (isRecord(v)) {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = toJsonValue(v[k]);
    return out;
  }
  return String(v);
};

const stableStringify = (v) => {
  if (v === null) return "null";
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : JSON.stringify(String(v));
  if (typeof v === "boolean") return v ? "true" : "false";
  if (Array.isArray(v)) return `[${v.map((x) => stableStringify(x)).join(",")}]`;
  if (typeof v !== "object" || v === null) return JSON.stringify(String(v));
  const keys = Object.keys(v).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(",")}}`;
};

const canonicalPayloadForProphecy = (payload) =>
  toJsonValue({
    v: payload.v,
    kind: payload.kind,
    prophecyId: payload.prophecyId,
    text: payload.text,
    textEnc: payload.textEnc,
    category: payload.category ?? null,
    expirationPulse: payload.expirationPulse ?? null,
    escrowPhiMicro: payload.escrowPhiMicro ?? null,
    evidence: payload.evidence ?? null,
    userPhiKey: payload.userPhiKey,
    kaiSignature: payload.kaiSignature,
    pulse: payload.pulse,
    beat: payload.beat,
    stepIndex: payload.stepIndex,
    stepPct: payload.stepPct,
    chakraDay: payload.chakraDay,
    createdAtPulse: payload.createdAtPulse,
  });

const computeCanonicalHash = (payload) => {
  const canon = canonicalPayloadForProphecy(payload);
  const canonStr = stableStringify(canon);
  return sha256Hex(`SM:PROPHECY:CANON:${canonStr}`).toLowerCase();
};

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

const buildProphecySvg = ({ payload, textEncoded }) => {
  const textEnc = payload.textEnc ?? "uri";
  const encodedText = textEncoded ?? encodeURIComponent(String(payload.text ?? ""));

  const zk = payload.zk ?? {};
  const proofJson = zk.proof ? JSON.stringify(zk.proof) : "";
  const publicInputsJson = zk.publicInputs ? JSON.stringify(zk.publicInputs) : "";
  const poseidonHash = zk.poseidonHash ?? "";

  const payloadJson = JSON.stringify({ ...payload, textEncoded: encodedText, textEnc });
  const zkJson = JSON.stringify({
    scheme: zk.scheme ?? "groth16-poseidon",
    proof: zk.proof ?? null,
    publicInputs: zk.publicInputs ?? null,
    poseidonHash,
    verifiedHint: zk.verifiedHint ?? undefined,
  });

  const descText = String(payload.text ?? "").replace(/\s+/g, " ").slice(0, 140);
  const desc = `Prophecy • ${descText}${payload.expirationPulse ? ` • exp p${payload.expirationPulse}` : ""}`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
  viewBox="0 0 1000 1000"
  width="1000" height="1000"
  role="img"
  aria-label="${esc(`Prophecy Sigil ${payload.prophecyId}`)}"
  data-kind="prophecy"
  data-v="SM-PROPHECY-1"
  data-prophecy-id="${esc(payload.prophecyId)}"
  data-text="${esc(encodedText)}"
  data-text-enc="${esc(textEnc)}"
  data-category="${payload.category ? esc(payload.category) : ""}"
  data-expiration="${payload.expirationPulse != null ? esc(String(payload.expirationPulse)) : ""}"
  data-phikey="${esc(payload.userPhiKey)}"
  data-kai-signature="${esc(payload.kaiSignature)}"
  data-pulse="${esc(String(payload.pulse))}"
  data-beat="${esc(String(payload.beat))}"
  data-step-index="${esc(String(payload.stepIndex))}"
  data-step-pct="${esc(String(payload.stepPct))}"
  data-chakra-day="${esc(String(payload.chakraDay))}"
  data-payload-hash="${esc(payload.canonicalHash)}"
  data-zk-scheme="${esc(zk.scheme ?? "groth16-poseidon")}"\
  data-zk-proof="${esc(proofJson)}"
  data-zk-public="${esc(publicInputsJson)}"
  data-zk-public-inputs="${esc(publicInputsJson)}"
  data-zk-poseidon-hash="${esc(String(poseidonHash))}"
  data-evidence-hash="${payload.evidence?.bundleHash ? esc(String(payload.evidence.bundleHash)) : ""}"
  data-evidence-urls="${payload.evidence?.items
    ? esc(
        payload.evidence.items
          .filter((it) => it.kind === "url")
          .map((it) => it.url)
          .join("|")
      )
    : ""}"
  data-phi-escrow-micro="${payload.escrowPhiMicro ? esc(String(payload.escrowPhiMicro)) : ""}">
  <title>${esc(`Prophecy Sigil • p${payload.pulse}`)}</title>
  <desc>${esc(desc)}</desc>
  <metadata id="sm-prophecy">${safeCdata(payloadJson)}</metadata>
  <metadata id="sm-zk">${safeCdata(zkJson)}</metadata>

  <defs>
    <radialGradient id="bg" cx="50%" cy="38%" r="70%">
      <stop offset="0%" stop-color="rgba(255,255,255,0.10)"/>
      <stop offset="60%" stop-color="rgba(0,0,0,0.00)"/>
      <stop offset="100%" stop-color="rgba(0,0,0,0.22)"/>
    </radialGradient>
    <linearGradient id="pulse" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="rgba(120,255,240,0.85)"/>
      <stop offset="100%" stop-color="rgba(120,150,255,0.85)"/>
    </linearGradient>
    <filter id="glow" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="9" result="b"/>
      <feColorMatrix in="b" type="matrix"
        values="1 0 0 0 0
                0 1 0 0 0
                0 0 1 0 0
                0 0 0 0.42 0"/>
      <feMerge>
        <feMergeNode/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>

  <rect x="0" y="0" width="1000" height="1000" fill="rgba(8,10,18,1)"/>
  <rect x="0" y="0" width="1000" height="1000" fill="url(#bg)"/>

  <circle cx="500" cy="500" r="360" fill="none" stroke="rgba(255,255,255,0.10)" stroke-width="10"/>
  <circle cx="500" cy="500" r="320" fill="none" stroke="url(#pulse)" stroke-width="4" opacity="0.8"/>
  <circle cx="500" cy="500" r="220" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="2"/>

  <circle cx="500" cy="500" r="128" fill="rgba(8,10,18,0.6)" stroke="rgba(255,255,255,0.12)" stroke-width="2"/>
  <circle cx="500" cy="500" r="98" fill="none" stroke="url(#pulse)" stroke-width="6" filter="url(#glow)" opacity="0.9"/>

  <g font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace" fill="rgba(255,255,255,0.78)">
    <text x="70" y="88" font-size="22">SM-PROPHECY-1</text>
    <text x="70" y="120" font-size="16">p${esc(String(payload.pulse))} • beat ${esc(String(payload.beat))} • step ${esc(String(payload.stepIndex))}</text>
    <text x="70" y="152" font-size="16">ΦKey ${esc(String(payload.userPhiKey)).slice(0, 12)}…</text>
    <text x="70" y="184" font-size="14">zk ${esc(zk.scheme ?? "groth16-poseidon")} • ${poseidonHash ? `poseidon ${esc(String(poseidonHash)).slice(0, 12)}…` : ""}</text>

    <text x="70" y="910" font-size="16">${esc(payload.category ?? "Prophecy")}</text>
    <text x="70" y="940" font-size="14">${esc(descText)}</text>
  </g>
</svg>`;
};

export default async function handler(req, res) {
  try {
    const body = await readJsonBody(req);
    if (!body || body.kind !== "prophecy" || !isRecord(body.payload)) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "invalid payload" }));
      return;
    }

    const payload = body.payload;
    if (payload.kind !== "prophecy" || payload.v !== "SM-PROPHECY-1") {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "invalid payload kind" }));
      return;
    }

    if (!payload.text || !payload.userPhiKey || !payload.kaiSignature || !payload.canonicalHash) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "missing fields" }));
      return;
    }

    if (!payload.zk || !payload.zk.proof || !payload.zk.publicInputs) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "missing zk bundle" }));
      return;
    }

    const computed = computeCanonicalHash(payload);
    if (computed !== String(payload.canonicalHash).toLowerCase()) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "canonical hash mismatch" }));
      return;
    }

    const sigilId = payload.prophecyId ?? `prophecy_${computed.slice(0, 40)}`;
    payload.prophecyId = sigilId;

    const svg = buildProphecySvg({ payload, textEncoded: body.textEncoded });
    const svgHash = sha256Hex(svg);

    sigilStore.set(sigilId, svg);

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        sigilId,
        svg,
        svgHash,
        canonicalHash: payload.canonicalHash,
      })
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "seal failed";
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: message }));
  }
}

export const config = {
  runtime: "nodejs",
};
