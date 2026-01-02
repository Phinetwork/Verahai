import { useCallback, useEffect, useRef, useState } from "react";
import type { ChartPoint } from "../../valuation/series";
import { kaiPulseNow } from "../constants";

export type LiveChartPoint = ChartPoint & { fx?: number };

type RollingSeriesInput = {
  seriesKey: string;
  sampleMs: number;
  valuePhi: number;
  usdPerPhi: number;
  maxPoints?: number;
  snapKey?: number;
};

const makePoint = (i: number, value: number, fx: number): LiveChartPoint => ({
  i,
  value,
  premium: value,
  fx,
});

export default function useRollingChartSeries({
  seriesKey,
  sampleMs,
  valuePhi,
  usdPerPhi,
  maxPoints = 2048,
  snapKey,
}: RollingSeriesInput): LiveChartPoint[] {
  const [data, setData] = useState<LiveChartPoint[]>([]);
  const dataRef = useRef<LiveChartPoint[]>([]);
  const vRef = useRef(valuePhi);
  const fxRef = useRef(usdPerPhi);

  useEffect(() => {
    if (Number.isFinite(valuePhi)) vRef.current = valuePhi;
  }, [valuePhi]);

  useEffect(() => {
    if (Number.isFinite(usdPerPhi) && usdPerPhi > 0) fxRef.current = usdPerPhi;
  }, [usdPerPhi]);

  const snapNow = useCallback(() => {
    const p = kaiPulseNow();
    const val = Number.isFinite(vRef.current) ? vRef.current : 0;
    const fx = Number.isFinite(fxRef.current) && fxRef.current > 0 ? fxRef.current : 0;

    const prev = dataRef.current;
    if (!prev.length) {
      const seed: LiveChartPoint[] = [
        makePoint(p - 1, val, fx),
        makePoint(p, val, fx),
      ];
      dataRef.current = seed;
      setData(seed);
      return;
    }

    const last = prev[prev.length - 1];
    let next: LiveChartPoint[];

    if (last?.i === p) {
      next = [...prev.slice(0, -1), { ...last, value: val, premium: val, fx }];
    } else if (typeof last?.i === "number" && last.i < p) {
      next = [...prev, makePoint(p, val, fx)];
    } else {
      next = [...prev.slice(0, -1), { ...last, value: val, premium: val, fx }];
    }

    if (next.length > maxPoints) next.splice(0, next.length - maxPoints);

    dataRef.current = next;
    setData(next);
  }, [maxPoints]);

  useEffect(() => {
    dataRef.current = [];
    setData([]);
    snapNow();
  }, [seriesKey, snapNow]);

  useEffect(() => {
    snapNow();
  }, [valuePhi, usdPerPhi, snapNow]);

  useEffect(() => {
    if (typeof snapKey === "number") snapNow();
  }, [snapKey, snapNow]);

  useEffect(() => {
    const id = window.setInterval(() => {
      const p = kaiPulseNow();
      const prev = dataRef.current;
      const last = prev[prev.length - 1];
      if (last?.i === p) return;

      const nextPoint = makePoint(p, vRef.current, fxRef.current);
      const next = prev.length ? [...prev, nextPoint] : [nextPoint];
      if (next.length > maxPoints) next.splice(0, next.length - maxPoints);

      dataRef.current = next;
      setData(next);
    }, sampleMs);

    return () => window.clearInterval(id);
  }, [sampleMs, maxPoints]);

  return data;
}
