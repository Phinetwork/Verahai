// SigilMarkets/views/Vault/VaultGrowthLine.tsx
"use client";

import React, { useEffect, useMemo, useRef } from "react";
import type { KaiMoment, PhiMicro } from "../../types/marketTypes";
import type { VaultRecord } from "../../types/vaultTypes";
import { Card, CardContent } from "../../ui/atoms/Card";
import { Icon } from "../../ui/atoms/Icon";
import { formatPhiMicroCompact } from "../../utils/format";

export type VaultGrowthLineProps = Readonly<{
  vault: VaultRecord;
  now: KaiMoment;
}>;

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

const makeSeries = (nowPulse: number, totalMicro: bigint, points = 72): readonly number[] => {
  const base = clamp01(Math.log10(1 + Number(totalMicro)) / 16);
  const out: number[] = [];
  for (let i = 0; i < points; i += 1) {
    const t = (nowPulse - (points - 1 - i)) * 0.12;
    const wobble = Math.sin(t) * 0.035 + Math.sin(t * 0.41) * 0.018;
    out.push(clamp01(base + wobble));
  }
  return out;
};

export const VaultGrowthLine = (props: VaultGrowthLineProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const totalMicroBig = useMemo(
    () => (props.vault.spendableMicro as unknown as bigint) + (props.vault.lockedMicro as unknown as bigint),
    [props.vault.spendableMicro, props.vault.lockedMicro],
  );

  const totalMicro = useMemo(() => (totalMicroBig as unknown) as PhiMicro, [totalMicroBig]);

  const label = useMemo(() => formatPhiMicroCompact(totalMicro, { withUnit: true, maxSig: 5 }), [totalMicro]);

  const series = useMemo(() => makeSeries(props.now.pulse, totalMicroBig, 72), [props.now.pulse, totalMicroBig]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;

    const dpr = typeof window !== "undefined" ? Math.max(1, Math.floor(window.devicePixelRatio || 1)) : 1;
    const w = c.clientWidth;
    const h = 110;

    c.width = Math.floor(w * dpr);
    c.height = Math.floor(h * dpr);

    const ctx = c.getContext("2d");
    if (!ctx) return;

    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const pad = 10;
    const innerW = w - pad * 2;
    const innerH = h - pad * 2;

    const min = Math.max(0, Math.min(...series) - 0.05);
    const max = Math.min(1, Math.max(...series) + 0.05);
    const span = Math.max(0.0001, max - min);

    const xAt = (i: number): number => pad + (i / (series.length - 1)) * innerW;
    const yAt = (v: number): number => pad + (1 - (v - min) / span) * innerH;

    ctx.beginPath();
    for (let i = 0; i < series.length; i += 1) {
      const x = xAt(i);
      const y = yAt(series[i]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(183,163,255,0.78)";
    ctx.stroke();

    ctx.lineWidth = 6;
    ctx.strokeStyle = "rgba(183,163,255,0.18)";
    ctx.stroke();

    const lx = xAt(series.length - 1);
    const ly = yAt(series[series.length - 1]);
    ctx.beginPath();
    ctx.arc(lx, ly, 4, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(183,163,255,0.88)";
    ctx.fill();
  }, [series]);

  return (
    <Card variant="glass2">
      <CardContent>
        <div className="sm-vault-growth-head">
          <div className="sm-vault-growth-title">
            <Icon name="spark" size={14} tone="violet" /> Growth
          </div>
          <div className="sm-vault-growth-right">{label}</div>
        </div>
        <div className="sm-vault-growth-canvas">
          <canvas ref={canvasRef} className="sm-vault-growth-c" />
        </div>
      </CardContent>
    </Card>
  );
};
