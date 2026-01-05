// SigilMarkets/views/Prophecy/ProphecySigilComposer.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { KaiMoment, KaiPulse, PhiMicro } from "../../types/marketTypes";
import type { EvidenceBundle, EvidenceItem } from "../../types/oracleTypes";
import { asEvidenceLabel, asEvidenceUrl } from "../../types/oracleTypes";
import { asEvidenceHash } from "../../types/marketTypes";
import { parsePhiToMicro } from "../../utils/format";
import { Button } from "../../ui/atoms/Button";
import { Card, CardContent } from "../../ui/atoms/Card";
import { Chip } from "../../ui/atoms/Chip";
import { Divider } from "../../ui/atoms/Divider";
import { Icon } from "../../ui/atoms/Icon";
import { useProphecySigils } from "../../hooks/useProphecySigils";
import { momentFromUTC } from "../../../utils/kai_pulse";

export type ProphecySigilComposerProps = Readonly<{
  now: KaiMoment;
}>;

const TEXT_LIMIT = 320;

const fileHashHex = async (file: File): Promise<string> => {
  const buf = await file.arrayBuffer();
  if (typeof crypto === "undefined" || !crypto.subtle) {
    throw new Error("crypto.subtle unavailable");
  }
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

export const ProphecySigilComposer = (props: ProphecySigilComposerProps) => {
  const { activeVault, actions } = useProphecySigils();

  const [text, setText] = useState("");
  const [category, setCategory] = useState("");
  const [expirationRaw, setExpirationRaw] = useState("");
  const [escrowRaw, setEscrowRaw] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [evidenceItems, setEvidenceItems] = useState<EvidenceItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zkStatus, setZkStatus] = useState<"idle" | "generating" | "ready" | "error">("idle");

  const remaining = TEXT_LIMIT - text.length;

  const expirationPulse = useMemo(() => {
    if (!expirationRaw.trim()) return undefined;
    const n = Number(expirationRaw);
    if (!Number.isFinite(n)) return undefined;
    return Math.max(0, Math.floor(n)) as KaiPulse;
  }, [expirationRaw]);

  const escrowMicro = useMemo(() => {
    if (!escrowRaw.trim()) return undefined;
    const parsed = parsePhiToMicro(escrowRaw.trim());
    return parsed.ok ? parsed.micro : undefined;
  }, [escrowRaw]);

  const evidence: EvidenceBundle | undefined = useMemo(() => {
    if (evidenceItems.length === 0) return undefined;
    return { items: evidenceItems };
  }, [evidenceItems]);

  const liveMoment = useMemo(() => momentFromUTC(), [props.now.pulse, props.now.beat, props.now.stepIndex]);

  useEffect(() => {
    if (!busy && zkStatus === "ready") setZkStatus("idle");
  }, [busy, category, escrowRaw, expirationRaw, evidenceItems, text, zkStatus]);

  const addUrl = (): void => {
    const v = urlInput.trim();
    if (!v) return;
    setEvidenceItems((prev) => [...prev, { kind: "url", url: asEvidenceUrl(v) }]);
    setUrlInput("");
  };

  const onPickFile = async (evt: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = evt.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const hash = await fileHashHex(file);
      setEvidenceItems((prev) => [
        ...prev,
        { kind: "hash", hash: asEvidenceHash(hash), label: asEvidenceLabel(file.name) },
      ]);
      setBusy(false);
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : "evidence hash failed");
    }
  };

  const removeEvidence = (idx: number): void => {
    setEvidenceItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const onSeal = async (): Promise<void> => {
    setError(null);

    if (!text.trim()) {
      setError("Prophecy text is required.");
      return;
    }

    if (expirationPulse != null && expirationPulse < liveMoment.pulse) {
      setError("Expiration pulse must be current or future.");
      return;
    }

    if (escrowRaw.trim() && escrowMicro == null) {
      setError("Escrow amount must be a valid Φ value.");
      return;
    }

    setBusy(true);
    setZkStatus("generating");

    const res = await actions.sealProphecy({
      text: text.trim(),
      category: category.trim() || undefined,
      expirationPulse,
      escrowPhiMicro: escrowMicro as PhiMicro | undefined,
      evidence,
    });

    if (!res.ok) {
      setError(res.error);
      setBusy(false);
      setZkStatus("error");
      return;
    }

    setText("");
    setCategory("");
    setExpirationRaw("");
    setEscrowRaw("");
    setEvidenceItems([]);
    setBusy(false);
    setZkStatus("ready");
  };

  return (
    <Card variant="glass2" className="sm-proph-sigil-card">
      <CardContent>
        <div className="sm-title" style={{ fontSize: 14 }}>
          Mint a Prophecy Sigil
        </div>
        <div className="sm-subtitle" style={{ marginTop: 6 }}>
          Sealed, time-locked claims with signature + ZK integrity. Portable and verifiable offline.
        </div>

        <Divider />

        <label className="sm-label">Prophecy text</label>
        <textarea
          className="sm-textarea"
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, TEXT_LIMIT))}
          placeholder="I predict..."
        />
        <div className={`sm-small ${remaining < 40 ? "sm-warn" : ""}`}>
          {remaining} characters remaining
        </div>

        <Divider />

        <label className="sm-label">Category (optional)</label>
        <input
          className="sm-input"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="Markets, World, Personal…"
        />

        <Divider />

        <div className="sm-proph-sigil-row">
          <div className="sm-proph-sigil-field">
            <label className="sm-label">Expiration pulse (optional)</label>
            <input
              className="sm-input"
              value={expirationRaw}
              onChange={(e) => setExpirationRaw(e.target.value)}
              placeholder={`>= ${props.now.pulse}`}
              inputMode="numeric"
            />
          </div>

          <div className="sm-proph-sigil-field">
            <label className="sm-label">Φ escrow (optional)</label>
            <input
              className="sm-input"
              value={escrowRaw}
              onChange={(e) => setEscrowRaw(e.target.value)}
              placeholder="0.00"
              inputMode="decimal"
            />
          </div>
        </div>

        <Divider />

        <label className="sm-label">Evidence (optional)</label>
        <div className="sm-proph-sigil-evidence">
          <div className="sm-proph-sigil-evidence-row">
            <input
              className="sm-input"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="https://…"
            />
            <Button variant="ghost" size="sm" onClick={addUrl} disabled={!urlInput.trim()}>
              Add URL
            </Button>
          </div>
          <input type="file"  className="sm-proph-sigil-file-input" onChange={onPickFile} />
          {evidenceItems.length ? (
            <div className="sm-proph-sigil-evidence-list">
              {evidenceItems.map((item, idx) => (
                <div key={`${item.kind}-${idx}`} className="sm-proph-sigil-evidence-item">
                  <span className="mono sm-small">
                    {item.kind === "url" ? item.url : item.hash}
                  </span>
                  <Button variant="ghost" size="xs" onClick={() => removeEvidence(idx)}>
                    Remove
                  </Button>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <Divider />

        <div className="sm-proph-sigil-status">
          <div className="sm-small">
            Seals at p{liveMoment.pulse} • beat {liveMoment.beat} • step {liveMoment.stepIndex}
          </div>
          <div className="sm-proph-sigil-badges">
            <Chip size="sm" selected={false} variant="outline" tone={activeVault ? "gold" : "default"}>
              Signature {activeVault ? "✓" : "–"}
            </Chip>
            <Chip size="sm" selected={false} variant="outline" tone={zkStatus === "ready" ? "success" : zkStatus === "error" ? "danger" : "default"}>
              ZK {zkStatus === "ready" ? "✓" : zkStatus === "generating" ? "…" : "–"}
            </Chip>
          </div>
        </div>

        <details className="sm-proph-sigil-zk">
          <summary className="sm-small">Zero-Knowledge proof</summary>
          <div className="sm-small" style={{ marginTop: 6 }}>
            Private proof: reveals nothing, proves authorship. Uses groth16-poseidon with on-device verification.
          </div>
        </details>

        {error ? <div className="sm-small sm-err">{error}</div> : null}

        <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
          <Button
            variant="primary"
            onClick={() => void onSeal()}
            disabled={!activeVault || busy}
            leftIcon={<Icon name="spark" size={14} tone="gold" />}
          >
            {busy ? "Sealing…" : "Mint Prophecy Sigil"}
          </Button>
        </div>

        {!activeVault ? (
          <div className="sm-small" style={{ marginTop: 10 }}>
            Inhale a glyph to bind your identity before sealing.
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
};
