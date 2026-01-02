// src/components/LargeGlyphViewer.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LargeAssetPart,
  LargeAssetRoot,
  b64uDecodeToBytes,
  computeRootKaiHashV1,
  makeBlobUrl,
  sha256B64u,
} from "../utils/largeAsset";

/** Adapter: fetch payload by URL (your existing decode/fetch pipeline) */
export type FetchGlyph = (url: string) => Promise<unknown>;

/** Adapter: discover part glyph URLs for a rootHash (use your global registry) */
export type FindParts = (rootHash: string) => Promise<readonly string[]>;

type Props = {
  rootUrl: string;
  fetchGlyph: FetchGlyph;
  findPartUrls: FindParts; // returns URLs of derivative glyphs
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function isLargeAssetRoot(v: unknown): v is LargeAssetRoot {
  if (!isRecord(v)) return false;
  return (
    v.kind === "large_asset_root" &&
    v.version === 1 &&
    typeof v.rootHash === "string" &&
    typeof v.mime === "string" &&
    typeof v.bytes === "number" &&
    Number.isFinite(v.bytes) &&
    typeof v.chunkBytes === "number" &&
    Number.isFinite(v.chunkBytes) &&
    typeof v.partsTotal === "number" &&
    Number.isFinite(v.partsTotal)
  );
}

function isLargeAssetPart(v: unknown): v is LargeAssetPart {
  if (!isRecord(v)) return false;
  return (
    v.kind === "large_asset_part" &&
    v.version === 1 &&
    typeof v.rootHash === "string" &&
    typeof v.partIndex === "number" &&
    Number.isFinite(v.partIndex) &&
    typeof v.partsTotal === "number" &&
    Number.isFinite(v.partsTotal) &&
    typeof v.partHash === "string" &&
    typeof v.bytesB64u === "string"
  );
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message || "Unknown error";
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e);
  } catch {
    return "Unknown error";
  }
}

export default function LargeGlyphViewer({ rootUrl, fetchGlyph, findPartUrls }: Props) {
  const [root, setRoot] = useState<LargeAssetRoot | null>(null);
  const [parts, setParts] = useState<Map<number, LargeAssetPart>>(new Map());
  const [status, setStatus] = useState<string>("");

  const [blobUrl, setBlobUrl] = useState<string>("");
  const [sealed, setSealed] = useState<boolean>(false);

  // Always revoke the *previous* object URL when we create a new one.
  const lastObjectUrlRef = useRef<string>("");
  useEffect(() => {
    const prev = lastObjectUrlRef.current;
    if (prev && prev !== blobUrl) URL.revokeObjectURL(prev);
    lastObjectUrlRef.current = blobUrl;
  }, [blobUrl]);

  // Also revoke on unmount.
  useEffect(() => {
    return () => {
      const prev = lastObjectUrlRef.current;
      if (prev) URL.revokeObjectURL(prev);
      lastObjectUrlRef.current = "";
    };
  }, []);

  const partsTotal = root?.partsTotal ?? 0;

  const progress = useMemo(() => {
    if (!partsTotal) return { have: 0, total: 0 };
    return { have: parts.size, total: partsTotal };
  }, [parts.size, partsTotal]);

  const reconstruct = useCallback(
    async (r: LargeAssetRoot, partsMap: Map<number, LargeAssetPart>) => {
      // Need all parts
      if (partsMap.size !== r.partsTotal) return;

      setStatus("Verifying chunks…");

      const orderedPartHashB64u: string[] = [];
      const orderedBytes: Uint8Array[] = [];

      for (let i = 0; i < r.partsTotal; i++) {
        const p = partsMap.get(i);
        if (!p) throw new Error(`Missing part ${i}`);

        const bytes = b64uDecodeToBytes(p.bytesB64u);
        const computed = await sha256B64u(bytes);

        const expected = p.partHash.startsWith("sha256:")
          ? p.partHash.slice("sha256:".length)
          : p.partHash;

        if (computed !== expected) throw new Error(`Part hash mismatch at ${i}`);

        orderedPartHashB64u.push(computed);
        orderedBytes.push(bytes);
      }

      // Verify root identity (kaihash_v1)
      const recomputedRoot = await computeRootKaiHashV1({
        mime: r.mime,
        bytes: r.bytes,
        chunkBytes: r.chunkBytes,
        partsTotal: r.partsTotal,
        orderedPartHashB64u,
      });

      if (recomputedRoot !== r.rootHash) throw new Error("Root hash mismatch");

      setStatus("Sealed. Rendering…");

      // Assemble bytes (single concat). For huge files, swap this for persisted assembly.
      const totalLen = orderedBytes.reduce((acc, b) => acc + b.length, 0);
      const full = new Uint8Array(totalLen);

      let off = 0;
      for (const b of orderedBytes) {
        full.set(b, off);
        off += b.length;
      }

      const url = makeBlobUrl(r.mime, full);
      setBlobUrl(url);
      setSealed(true);
      setStatus("");
    },
    []
  );

  useEffect(() => {
    let dead = false;

    (async () => {
      try {
        setSealed(false);
        setBlobUrl("");
        setParts(new Map());
        setRoot(null);

        setStatus("Loading root…");
        const rawRoot = await fetchGlyph(rootUrl);
        if (dead) return;

        if (!isLargeAssetRoot(rawRoot)) throw new Error("Not a large_asset_root glyph");
        setRoot(rawRoot);

        setStatus("Discovering derivatives…");
        const urls = await findPartUrls(rawRoot.rootHash);
        if (dead) return;

        setStatus(`Loading ${urls.length} parts…`);

        const map = new Map<number, LargeAssetPart>();

        for (const u of urls) {
          const rawPart = await fetchGlyph(u);
          if (dead) return;

          if (isLargeAssetPart(rawPart) && rawPart.rootHash === rawRoot.rootHash) {
            map.set(rawPart.partIndex, rawPart);
            setParts(new Map(map)); // progress tick
          }
        }

        await reconstruct(rawRoot, map);
      } catch (e: unknown) {
        if (dead) return;
        setSealed(false);
        setBlobUrl("");
        setStatus(errorMessage(e) || "Failed to load large asset.");
      }
    })();

    return () => {
      dead = true;
    };
  }, [rootUrl, fetchGlyph, findPartUrls, reconstruct]);

  if (!root) return <div className="status">{status || "…"}</div>;

  return (
    <div className="kard">
      <div className="row">
        <div className="title">{root.name || "Large Asset"}</div>
        <div className="hint">
          {root.mime} • {(root.bytes / 1024 / 1024).toFixed(2)} MB • {progress.have}/{progress.total}
        </div>
      </div>

      {status && <div className="status">{status}</div>}

      {sealed && blobUrl ? (
        <>
          {root.mime.startsWith("video/") && (
            <video
              controls
              playsInline
              preload="metadata"
              src={blobUrl}
              style={{ width: "100%", borderRadius: 14 }}
            />
          )}

          {root.mime.startsWith("audio/") && (
            <audio controls preload="metadata" src={blobUrl} style={{ width: "100%" }} />
          )}

          {root.mime.startsWith("image/") && (
            <img
              alt={root.name || "asset"}
              src={blobUrl}
              style={{ width: "100%", borderRadius: 14 }}
            />
          )}

          {root.mime === "application/pdf" && (
            <iframe
              title="pdf"
              src={blobUrl}
              style={{ width: "100%", height: 700, borderRadius: 14, border: "0" }}
            />
          )}

          {!root.mime.startsWith("video/") &&
            !root.mime.startsWith("audio/") &&
            !root.mime.startsWith("image/") &&
            root.mime !== "application/pdf" && (
              <a href={blobUrl} download={root.name || "asset"}>
                Download reconstructed file
              </a>
            )}
        </>
      ) : (
        <div className="status">Waiting for all derivatives…</div>
      )}
    </div>
  );
}
