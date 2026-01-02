// SigilMarkets/sigils/InhaleGlyphGate.tsx
"use client";

import React, { useCallback, useMemo, useRef, useState } from "react";
import type { KaiMoment } from "../types/marketTypes";
import { asVaultId, type VaultId } from "../types/marketTypes";
import { deriveVaultId, sha256Hex } from "../utils/ids";
import { Sheet } from "../ui/atoms/Sheet";
import { Button } from "../ui/atoms/Button";
import { Divider } from "../ui/atoms/Divider";
import { Icon } from "../ui/atoms/Icon";
import { useSigilMarketsUi } from "../state/uiStore";
import { useSigilMarketsVaultStore } from "../state/vaultStore";
import { asKaiSignature, asSvgHash, asUserPhiKey, type KaiSignature, type SvgHash, type UserPhiKey } from "../types/vaultTypes";

type MetaLoose = Readonly<Record<string, unknown>>;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const isString = (v: unknown): v is string => typeof v === "string";

const extractBetween = (text: string, re: RegExp): string | null => {
  const m = re.exec(text);
  if (!m) return null;
  const g = m[1];
  return typeof g === "string" && g.trim().length > 0 ? g.trim() : null;
};

const parseEmbeddedJson = (svgText: string): MetaLoose | null => {
  // Try <metadata>...</metadata>
  const metaRaw =
    extractBetween(svgText, /<metadata[^>]*>([\s\S]*?)<\/metadata>/i) ??
    extractBetween(svgText, /<desc[^>]*>([\s\S]*?)<\/desc>/i);

  if (metaRaw) {
    // Some generators wrap JSON in CDATA
    const cleaned = metaRaw.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "").trim();
    try {
      const parsed: unknown = JSON.parse(cleaned);
      if (isRecord(parsed)) return parsed;
    } catch {
      // ignore
    }
  }

  // Try data-* attributes commonly used
  const userPhiKey =
    extractBetween(svgText, /data-user-phikey="([^"]+)"/i) ??
    extractBetween(svgText, /data-userPhiKey="([^"]+)"/i) ??
    extractBetween(svgText, /userPhiKey":"([^"]+)"/i);

  const kaiSignature =
    extractBetween(svgText, /data-kai-signature="([^"]+)"/i) ??
    extractBetween(svgText, /data-kaiSignature="([^"]+)"/i) ??
    extractBetween(svgText, /kaiSignature":"([^"]+)"/i);

  if (userPhiKey || kaiSignature) {
    return {
      userPhiKey: userPhiKey ?? undefined,
      kaiSignature: kaiSignature ?? undefined,
    };
  }

  return null;
};

const pickString = (m: MetaLoose | null, keys: readonly string[]): string | null => {
  if (!m) return null;
  for (const k of keys) {
    const v = m[k];
    if (isString(v) && v.trim().length > 0) return v.trim();
  }
  return null;
};

const readFileAsText = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error("Failed to read file"));
    r.onload = () => resolve(typeof r.result === "string" ? r.result : "");
    r.readAsText(file);
  });

export type InhaleGlyphGateProps = Readonly<{
  now: KaiMoment;
}>;

export const InhaleGlyphGate = (props: InhaleGlyphGateProps) => {
  const { state: ui, actions: uiActions } = useSigilMarketsUi();
  const { actions: vaultActions } = useSigilMarketsVaultStore();

  const top = ui.sheets.length > 0 ? ui.sheets[ui.sheets.length - 1].payload : null;
  const open = top?.id === "inhale-glyph";

  const fileRef = useRef<HTMLInputElement | null>(null);

  const [fileName, setFileName] = useState<string>("");
  const [svgHash, setSvgHash] = useState<SvgHash | null>(null);

  const [userPhiKey, setUserPhiKey] = useState<string>("");
  const [kaiSignature, setKaiSignature] = useState<string>("");

  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<boolean>(false);

  const reset = useCallback(() => {
    setFileName("");
    setSvgHash(null);
    setUserPhiKey("");
    setKaiSignature("");
    setErr(null);
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
  }, []);

  const close = useCallback(() => {
    uiActions.popSheet();
    reset();
  }, [reset, uiActions]);

  const onPickFile = useCallback(async (f: File | null) => {
    setErr(null);
    setSvgHash(null);

    if (!f) return;
    setFileName(f.name);

    try {
      const text = await readFileAsText(f);
      const h = await sha256Hex(text);
      const hash = asSvgHash(h);

      const meta = parseEmbeddedJson(text);
      const pk = pickString(meta, ["userPhiKey", "user_phikey", "userPhi", "phiKey", "phikey", "userPhiKey"]);
      const ks = pickString(meta, ["kaiSignature", "kai_signature", "kaiSig", "signature", "kaiSignature"]);

      setSvgHash(hash);
      if (pk && userPhiKey.trim().length === 0) setUserPhiKey(pk);
      if (ks && kaiSignature.trim().length === 0) setKaiSignature(ks);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to inhale";
      setErr(msg);
    }
  }, [kaiSignature, userPhiKey]);

  const canInhale = useMemo(() => {
    if (!svgHash) return false;
    if (userPhiKey.trim().length === 0) return false;
    if (kaiSignature.trim().length === 0) return false;
    return true;
  }, [kaiSignature, svgHash, userPhiKey]);

  const inhale = useCallback(async () => {
    if (!svgHash) return;
    const pk = userPhiKey.trim();
    const ks = kaiSignature.trim();
    if (pk.length === 0 || ks.length === 0) return;

    setBusy(true);
    setErr(null);

    try {
      const vaultId = await deriveVaultId({
        userPhiKey: asUserPhiKey(pk) as UserPhiKey,
        identitySvgHash: svgHash as SvgHash,
      });

      vaultActions.createOrActivateVault({
        vaultId,
        owner: {
          userPhiKey: asUserPhiKey(pk),
          kaiSignature: asKaiSignature(ks),
          identitySigil: { svgHash, url: undefined },
        },
        initialSpendableMicro: 0n,
        createdPulse: props.now.pulse,
      });

      uiActions.toast("success", "Glyph inhaled", `Vault activated`, { atPulse: props.now.pulse });
      uiActions.popSheet();
      reset();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Inhale failed";
      setErr(msg);
    } finally {
      setBusy(false);
    }
  }, [props.now.pulse, reset, svgHash, uiActions, userPhiKey, kaiSignature, vaultActions]);

  // If sheet opens fresh, reset stale state
  React.useEffect(() => {
    if (open) {
      // keep current state if already open
      return;
    }
    reset();
  }, [open, reset]);

  return (
    <Sheet
      open={open}
      onClose={close}
      title="Inhale Glyph"
      subtitle="Upload your Identity Sigil to unlock your Vault for trading, prophecy, and claiming."
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <Button variant="ghost" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={inhale}
            disabled={!canInhale || busy}
            loading={busy}
            leftIcon={<Icon name="scan" size={14} tone="cyan" />}
          >
            Inhale
          </Button>
        </div>
      }
    >
      <div className="sm-inhale">
        <div className="sm-inhale-pick">
          <input
            ref={fileRef}
            type="file"
            accept=".svg,image/svg+xml"
            onChange={(e) => onPickFile(e.target.files && e.target.files[0] ? e.target.files[0] : null)}
            style={{ display: "none" }}
          />
          <Button variant="primary" onClick={() => fileRef.current?.click()} leftIcon={<Icon name="export" size={14} tone="dim" />}>
            Choose SVG
          </Button>
          <div className="sm-small" style={{ opacity: 0.9 }}>
            {fileName ? `Selected: ${fileName}` : "No file selected"}
          </div>
        </div>

        <Divider />

        <div className="sm-inhale-fields">
          <label className="sm-inhale-label">
            <span className="sm-inhale-k">userPhiKey</span>
            <input className="sm-input" value={userPhiKey} onChange={(e) => setUserPhiKey(e.target.value)} placeholder="Your Φ key" />
          </label>

          <label className="sm-inhale-label">
            <span className="sm-inhale-k">kaiSignature</span>
            <input className="sm-input" value={kaiSignature} onChange={(e) => setKaiSignature(e.target.value)} placeholder="Kai signature" />
          </label>

          <div className="sm-small">
            {svgHash ? (
              <>
                svgHash: <span className="mono">{(svgHash as unknown as string).slice(0, 18)}…</span>
              </>
            ) : (
              "svgHash: —"
            )}
          </div>
        </div>

        {err ? (
          <div className="sm-lock-warn" style={{ marginTop: 12 }}>
            <Icon name="warning" size={14} tone="danger" /> {err}
          </div>
        ) : null}

        <div className="sm-small" style={{ marginTop: 12 }}>
          Your Identity Sigil is never consumed. Only Position Sigils become inert on loss.
        </div>
      </div>
    </Sheet>
  );
};
