// src/components/LargeGlyphMinter.tsx
"use client";

import React, { useCallback, useMemo, useState } from "react";
import {
  LargeAssetPart,
  LargeAssetRoot,
  computePartsTotal,
  computeRootKaiHashV1,
  readFileChunk,
  sha256B64u,
  b64uEncodeBytes,
} from "../utils/largeAsset";

type KaiMoment = { pulse: number; beat: number; stepIndex: number };
type KaiNow = () => KaiMoment;

/**
 * Adapter: wire into your existing mint / inhale / registry logic.
 * IMPORTANT: no `any` — payload is strongly typed to what this component produces.
 */
export type PublishGlyph = (payload: LargeAssetRoot | LargeAssetPart) => Promise<{ url: string }>;

type Props = {
  kaiNow: KaiNow;
  publishGlyph: PublishGlyph;
  defaultChunkBytes?: number; // e.g. 262_144 (256KB)
  onMinted?: (root: { rootUrl: string; rootHash: string; partsTotal: number }) => void;
};

export default function LargeGlyphMinter({
  kaiNow,
  publishGlyph,
  defaultChunkBytes = 262_144,
  onMinted,
}: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [chunkBytes, setChunkBytes] = useState<number>(defaultChunkBytes);

  const [status, setStatus] = useState<string>("");
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [rootUrl, setRootUrl] = useState<string>("");
  const [rootHash, setRootHash] = useState<string>("");

  const partsTotal = useMemo(() => {
    if (!file) return 0;
    return computePartsTotal(file.size, chunkBytes);
  }, [file, chunkBytes]);

  const startMint = useCallback(async () => {
    if (!file) return;

    setStatus("Hashing chunks…");
    setRootUrl("");
    setRootHash("");
    setProgress({ done: 0, total: partsTotal + 1 }); // +1 for root glyph

    // 1) Hash each part (streaming)
    const partHashB64u: string[] = [];
    for (let i = 0; i < partsTotal; i++) {
      const start = i * chunkBytes;
      const end = Math.min(file.size, start + chunkBytes);
      const bytes = await readFileChunk(file, start, end);

      const h = await sha256B64u(bytes);
      partHashB64u.push(h);

      // Nudge render loop without lying about progress
      setProgress((p) => ({ ...p }));
    }

    // 2) Root identity (kaihash_v1)
    const root = await computeRootKaiHashV1({
      mime: file.type || "application/octet-stream",
      bytes: file.size,
      chunkBytes,
      partsTotal,
      orderedPartHashB64u: partHashB64u,
    });

    setRootHash(root);

    // 3) Mint root glyph (manifest)
    setStatus("Minting root glyph…");
    const rootPayload: LargeAssetRoot = {
      kind: "large_asset_root",
      version: 1,
      rootHash: root,
      mime: file.type || "application/octet-stream",
      bytes: file.size,
      name: file.name,
      chunkBytes,
      partsTotal,
      kai: kaiNow(),
    };

    const rootRes = await publishGlyph(rootPayload);
    setRootUrl(rootRes.url);
    setProgress((p) => ({ ...p, done: Math.min(p.total, p.done + 1) }));

    // 4) Mint derivatives (chunks)
    setStatus("Minting derivative glyphs…");

    for (let i = 0; i < partsTotal; i++) {
      const start = i * chunkBytes;
      const end = Math.min(file.size, start + chunkBytes);
      const bytes = await readFileChunk(file, start, end);

      const partPayload: LargeAssetPart = {
        kind: "large_asset_part",
        version: 1,
        rootHash: root,
        partIndex: i,
        partsTotal,
        partHash: `sha256:${partHashB64u[i]}`,
        bytesB64u: b64uEncodeBytes(bytes),
        kai: kaiNow(),
      };

      await publishGlyph(partPayload);
      setProgress((p) => ({ ...p, done: Math.min(p.total, p.done + 1) }));
    }

    setStatus("Sealed. Root pointer ready.");
    onMinted?.({ rootUrl: rootRes.url, rootHash: root, partsTotal });
  }, [file, chunkBytes, partsTotal, kaiNow, publishGlyph, onMinted]);

  return (
    <div className="kard">
      <div className="row">
        <input
          type="file"
          accept="video/*,image/*,audio/*,application/pdf,.zip,.glb,.mp4,.webm"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
        />
      </div>

      <div className="row">
        <label>Chunk bytes</label>
        <input
          type="number"
          value={chunkBytes}
          min={32_768}
          step={32_768}
          onChange={(e) => setChunkBytes(Number(e.target.value) || defaultChunkBytes)}
        />
        <div className="hint">
          Parts: {partsTotal || "—"} {file ? `(${(file.size / 1024 / 1024).toFixed(2)} MB)` : ""}
        </div>
      </div>

      <button disabled={!file} onClick={startMint}>
        Mint Large Asset Glyphs
      </button>

      {status && <div className="status">{status}</div>}

      {progress.total > 0 && (
        <div className="status">
          Progress: {progress.done} / {progress.total}
        </div>
      )}

      {rootHash && <div className="mono">rootHash: {rootHash}</div>}
      {rootUrl && <div className="mono">rootUrl: {rootUrl}</div>}
    </div>
  );
}
