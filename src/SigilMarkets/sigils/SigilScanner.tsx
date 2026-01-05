// SigilMarkets/sigils/SigilScanner.tsx
"use client";

/* eslint-disable @typescript-eslint/consistent-type-definitions */

/**
 * SigilScanner (MVP)
 *
 * Goal:
 * - Let users upload/scan a Sigil artifact (currently SVG) and immediately see:
 *   - kind (position / resolution / vault / prophecy / unknown)
 *   - embedded JSON payload (from <metadata> or <desc>)
 *   - basic extracted fields (marketId, side, pulse, etc.)
 *
 * Notes:
 * - PNG camera scanning is wired after we standardize embedded payloads in PNG exports.
 * - This MVP is still hugely useful: users can verify artifacts offline by uploading SVGs.
 */

import React, { useMemo, useRef, useState } from "react";
import { Card, CardContent } from "../ui/atoms/Card";
import { Button } from "../ui/atoms/Button";
import { Divider } from "../ui/atoms/Divider";
import { Icon } from "../ui/atoms/Icon";
import { Chip } from "../ui/atoms/Chip";
import { shortHash } from "../utils/format";
import { sha256Hex } from "../utils/ids";
import { useSigilMarketsUi } from "../state/uiStore";

type UnknownRecord = Record<string, unknown>;
const isRecord = (v: unknown): v is UnknownRecord => typeof v === "object" && v !== null;
const isString = (v: unknown): v is string => typeof v === "string";

const readFileText = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ""));
    r.onerror = () => reject(new Error("Failed to read file"));
    r.readAsText(file);
  });

const tryJson = (s: string): unknown | null => {
  const t = s.trim();
  if (!t) return null;
  try {
    return JSON.parse(t) as unknown;
  } catch {
    return null;
  }
};

const extractAttr = (el: Element, names: readonly string[]): string | null => {
  for (const n of names) {
    const v = el.getAttribute(n);
    if (v && v.trim().length > 0) return v.trim();
  }
  return null;
};

export type SigilKind = "position" | "claim" | "resolution" | "vault" | "prophecy" | "unknown";

export type SigilScanResult = Readonly<{
  kind: SigilKind;
  svgHashHex: string;
  svgText: string;
  payload: unknown | null;
  /** Quick extracted fields */
  fields: Readonly<Record<string, string>>;
}>;

const detectKind = (svg: Element, payload: unknown | null): SigilKind => {
  const dk = extractAttr(svg, ["data-kind"]);
  const v = extractAttr(svg, ["data-v"]);

  if (dk?.includes("sigilmarkets-position") || v === "SM-POS-1") return "position";
  if (dk?.includes("sigilmarkets-claim") || v === "SM-CLAIM-1") return "claim";
  if (dk?.includes("sigilmarkets-resolution") || v === "SM-RES-1") return "resolution";
  if (dk?.includes("sigilmarkets-vault") || v === "SM-VAULT-1") return "vault";
  if (dk?.includes("sigilmarkets-prophecy") || dk === "prophecy" || v === "SM-PROP-1" || v === "SM-PROPHECY-1") return "prophecy";

  if (payload && isRecord(payload)) {
    const vv = payload["v"];
    const kind = payload["kind"];
    if (vv === "SM-POS-1" || kind === "position") return "position";
    if (vv === "SM-CLAIM-1" || kind === "claim") return "claim";
    if (vv === "SM-RES-1" || kind === "resolution") return "resolution";
    if (vv === "SM-VAULT-1" || kind === "vault") return "vault";
    if (vv === "SM-PROP-1" || vv === "SM-PROPHECY-1" || kind === "prophecy") return "prophecy";
  }

  return "unknown";
};

const extractFields = (svg: Element, payload: unknown | null): Readonly<Record<string, string>> => {
  const out: Record<string, string> = {};

  const add = (k: string, v: string | null | undefined): void => {
    if (!v) return;
    const t = v.trim();
    if (!t) return;
    out[k] = t;
  };

  add("v", extractAttr(svg, ["data-v"]));
  add("kind", extractAttr(svg, ["data-kind"]));
  add("marketId", extractAttr(svg, ["data-market-id"]));
  add("prophecyId", extractAttr(svg, ["data-prophecy-id"]));
  add("positionId", extractAttr(svg, ["data-position-id"]));
  add("side", extractAttr(svg, ["data-side"]));
  add("outcome", extractAttr(svg, ["data-outcome"]));
  add("payoutPhi", extractAttr(svg, ["data-payout-phi"]));
  add("vaultId", extractAttr(svg, ["data-vault-id"]));
  add("lockId", extractAttr(svg, ["data-lock-id"]));
  add("userPhiKey", extractAttr(svg, ["data-user-phikey", "data-userPhiKey"]));
  add("kaiSignature", extractAttr(svg, ["data-kai-signature", "data-kaiSignature"]));
  add("pulse", extractAttr(svg, ["data-pulse"]));
  add("chakraDay", extractAttr(svg, ["data-chakra-day", "data-chakraDay"]));

  if (payload && isRecord(payload)) {
    const vv = payload["v"];
    const kind = payload["kind"];
    if (isString(vv)) add("payload.v", vv);
    if (isString(kind)) add("payload.kind", kind);

    const marketId = payload["marketId"];
    const side = payload["side"];
    const outcome = payload["outcome"];
    const payoutPhi = payload["payoutPhiMicro"];
    if (isString(marketId)) add("payload.marketId", marketId);
    if (isString(side)) add("payload.side", side);
    if (isString(outcome)) add("payload.outcome", outcome);
    if (isString(payoutPhi)) add("payload.payoutPhiMicro", payoutPhi);
  }

  return out;
};

const parseSvgForPayload = (svgText: string): Readonly<{ svg: Element; payload: unknown | null }> => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, "image/svg+xml");
  const svg = doc.documentElement;

  if (!svg || svg.nodeName.toLowerCase() !== "svg") {
    throw new Error("Not a valid SVG");
  }

  const metaEl = doc.getElementsByTagName("metadata")?.[0] ?? null;
  const descEl = doc.getElementsByTagName("desc")?.[0] ?? null;

  const meta = tryJson(metaEl?.textContent ?? "");
  const desc = tryJson(descEl?.textContent ?? "");

  const payload = meta ?? desc ?? null;
  return { svg, payload };
};

export type SigilScannerProps = Readonly<{
  onScanned?: (result: SigilScanResult) => void;
  /** show camera capture hint (mobile). Default true */
  allowCapture?: boolean;
}>;

export const SigilScanner = (props: SigilScannerProps) => {
  const { actions: ui } = useSigilMarketsUi();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<SigilScanResult | null>(null);

  const allowCapture = props.allowCapture ?? true;

  const scanFile = async (file: File): Promise<void> => {
    setBusy(true);
    setErr(null);
    setResult(null);

    try {
      const name = file.name.toLowerCase();
      const type = (file.type || "").toLowerCase();

      if (!(type.includes("svg") || name.endsWith(".svg"))) {
        throw new Error("MVP scanner supports SVG. Export PNG scanning wires next.");
      }

      const svgText = await readFileText(file);
      const svgHashHex = await sha256Hex(svgText);

      const { svg, payload } = parseSvgForPayload(svgText);
      const kind = detectKind(svg, payload);
      const fields = extractFields(svg, payload);

      const out: SigilScanResult = { kind, svgHashHex, svgText, payload, fields };
      setResult(out);
      if (props.onScanned) props.onScanned(out);

      ui.toast("success", "Scanned", `kind: ${kind}`);
      setBusy(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "scan failed";
      setErr(msg);
      ui.toast("error", "Scan failed", msg);
      setBusy(false);
    }
  };

  const title = useMemo(() => (result ? `Scanned • ${result.kind}` : "Sigil Scanner"), [result]);

  const chips = useMemo(() => {
    const list: React.ReactNode[] = [];
    if (!result) return list;

    list.push(<Chip key="kind">{result.kind.toUpperCase()}</Chip>);

    const v = result.fields["v"] ?? result.fields["payload.v"];
    if (v) list.push(<Chip key="v">{v}</Chip>);

    const marketId = result.fields["marketId"] ?? result.fields["payload.marketId"];
    if (marketId) list.push(<Chip key="mid">{`market ${shortHash(marketId, 10, 6)}`}</Chip>);

    const pulse = result.fields["pulse"];
    if (pulse) list.push(<Chip key="pulse">{`pulse ${pulse}`}</Chip>);

    list.push(<Chip key="payload">{result.payload ? "payload ✓" : "payload —"}</Chip>);
    list.push(<Chip key="fields">{`fields ${Object.keys(result.fields).length}`}</Chip>);

    return list;
  }, [result]);

  return (
    <Card variant="glass" className="sm-scan">
      <CardContent>
        <div className="sm-scan-head">
          <div className="sm-scan-title">
            <Icon name="scan" size={14} tone="cyan" /> {title}
          </div>

          <input
            ref={inputRef}
            type="file"
            accept=".svg,image/svg+xml"
            capture={allowCapture ? "environment" : undefined}
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void scanFile(f);
            }}
          />

          <Button
            variant="primary"
            size="sm"
            onClick={() => inputRef.current?.click()}
            loading={busy}
            leftIcon={<Icon name="scan" size={14} tone="cyan" />}
          >
            Scan SVG
          </Button>
        </div>

        {chips.length > 0 ? (
          <div
            className="sm-scan-chips"
            role="group"
            aria-label="Scan status"
            aria-live="polite"
            style={{ marginTop: 10, overflowX: "auto", whiteSpace: "nowrap" }}
          >
            {chips.map((c, idx) => (
              <span key={idx} style={{ display: "inline-block", marginRight: 8 }}>
                {c}
              </span>
            ))}
          </div>
        ) : null}

        {err ? (
          <div className="sm-scan-err">
            <Icon name="warning" size={14} tone="danger" /> {err}
          </div>
        ) : null}

        {result ? (
          <>
            <Divider />

            <div className="sm-scan-meta">
              <div className="row">
                <span className="k">svgHash</span>
                <span className="v mono">{shortHash(result.svgHashHex, 14, 12)}</span>
              </div>

              <div className="row">
                <span className="k">fields</span>
                <span className="v">{Object.keys(result.fields).length}</span>
              </div>
            </div>

            <div className="sm-scan-fields">
              {Object.entries(result.fields)
                .slice(0, 10)
                .map(([k, v]) => (
                  <div key={k} className="sm-scan-field">
                    <span className="k">{k}</span>
                    <span className="v mono">{v.length > 38 ? shortHash(v, 18, 16) : v}</span>
                  </div>
                ))}
            </div>

            <Divider />

            <div className="sm-scan-json">
              <div className="sm-small">payload</div>
              <pre className="sm-scan-pre">{result.payload ? JSON.stringify(result.payload, null, 2) : "null"}</pre>
            </div>
          </>
        ) : (
          <div className="sm-subtitle" style={{ marginTop: 10 }}>
            Upload an exported sigil SVG to verify it instantly (offline-friendly).
          </div>
        )}
      </CardContent>
    </Card>
  );
};
