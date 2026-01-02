export function readNum(obj: unknown, key: string): number | null {
  if (!obj || typeof obj !== "object") return null;
  const rec = obj as Record<string, unknown>;
  const v = rec[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function fmt2(n: number): string {
  const nn = Math.floor(n);
  if (!Number.isFinite(nn)) return "00";
  if (nn < 0) return String(nn);
  return String(nn).padStart(2, "0");
}

export function formatPulse(pulse: number): string {
  if (!Number.isFinite(pulse)) return "—";
  if (pulse < 0) return String(pulse);
  if (pulse < 1_000_000) return String(pulse).padStart(6, "0");
  return pulse.toLocaleString("en-US");
}

export function modPos(n: number, d: number): number {
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return 0;
  const r = n % d;
  return r < 0 ? r + d : r;
}

