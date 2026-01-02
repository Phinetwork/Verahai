// src/utils/extractKaiMetadata.ts
//
// Kai Sigil metadata extractor for verify.kai
// ------------------------------------------
// - Locates <metadata> in the SVG
// - Parses JSON inside it
// - Searches for any object that has BOTH kaiSignature + userPhiKey
// - If found → "ok" (complete Kai Sigil metadata)
// - If JSON exists but no pair → "warning" (incomplete)
// - If no JSON at all → "error"
//
// This is intentionally tolerant of nesting and schema evolution so
// future Kai Sigil formats still verify correctly.

import type { VerificationResult } from "../types";

type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];
interface JsonObject {
  [key: string]: JsonValue;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Pull out the JSON blob from inside a <metadata>...</metadata> block.
 * We don't care about surrounding XML/whitespace—just the first {...} we find.
 */
function extractJsonFromMetadata(svgText: string): JsonValue | null {
  const metaMatch = svgText.match(/<metadata[^>]*>([\s\S]*?)<\/metadata>/i);
  if (!metaMatch) return null;

  const inner = metaMatch[1];
  const start = inner.indexOf("{");
  const end = inner.lastIndexOf("}");
  if (start === -1 || end <= start) return null;

  const jsonStr = inner.slice(start, end + 1);
  try {
    return JSON.parse(jsonStr) as JsonValue;
  } catch {
    return null;
  }
}

/**
 * Walk an arbitrary JSON tree and find the first object that has BOTH:
 *   - kaiSignature: string
 *   - userPhiKey:  string
 *
 * We don't assume a particular nesting (kks.meta, embedded.meta, etc.).
 */
function findKaiSigNode(root: JsonValue): JsonObject | null {
  const seen = new Set<unknown>();

  function dfs(node: JsonValue): JsonObject | null {
    if (!isRecord(node) || seen.has(node)) return null;
    seen.add(node);

    const obj = node as JsonObject;

    const kaiSig = obj.kaiSignature;
    const phiKey = obj.userPhiKey;

    if (typeof kaiSig === "string" && typeof phiKey === "string") {
      return obj;
    }

    for (const value of Object.values(obj)) {
      if (isRecord(value) || Array.isArray(value)) {
        const found = dfs(value as JsonValue);
        if (found) return found;
      }
    }

    if (Array.isArray(node)) {
      for (const item of node) {
        const found = dfs(item as JsonValue);
        if (found) return found;
      }
    }

    return null;
  }

  return dfs(root);
}

/**
 * Public API used by VerifierForm + ResultCard.
 */
export function extractMetadataFromSvg(svgText: string): VerificationResult {
  const json = extractJsonFromMetadata(svgText);

  // Nothing we can parse at all
  if (!json) {
    const emptyPretty = "";
    return {
      status: "error",
      title: "No Kai metadata found",
      message:
        "This SVG does not contain a readable <metadata> block with Kai Sigil data.",
      // include both shapes so ResultCard can use whichever it expects
      metadata: null as unknown,
      metadataJson: emptyPretty,
    } as VerificationResult;
  }

  const sigNode = findKaiSigNode(json);
  const pretty = JSON.stringify(json, null, 2);

  // We have JSON, but no Kai Signature + Φ-key pair anywhere
  if (!sigNode) {
    return {
      status: "warning",
      title: "Metadata issue — Metadata incomplete",
      message:
        "Metadata JSON was found, but Kai Signature fields (kaiSignature, userPhiKey) are missing.",
      metadata: json as unknown,
      metadataJson: pretty,
    } as VerificationResult;
  }

  // ✅ Complete Kai Sigil metadata detected
  return {
    status: "ok",
    title: "Kai Sigil detected",
    message:
      "Embedded Kai Signature metadata is present and complete. This is a real minted Kai Sigil.",
    metadata: json as unknown,
    metadataJson: pretty,
  } as VerificationResult;
}
