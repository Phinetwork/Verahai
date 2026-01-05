import { useEffect, useState } from "react";

/* ──────────────────────────────────────────────────────────────────────────────
   Shared VisualViewport publisher (RAF-throttled)
────────────────────────────────────────────────────────────────────────────── */
type VVSize = { width: number; height: number; offsetTop: number; offsetLeft: number };

type VVStore = {
  size: VVSize;
  subs: Set<(s: VVSize) => void>;
  listening: boolean;
  rafId: number | null;
  cleanup?: (() => void) | null;
};

const vvStore: VVStore = {
  size: { width: 0, height: 0, offsetTop: 0, offsetLeft: 0 }, // ✅ FIX
  subs: new Set(),
  listening: false,
  rafId: null,
  cleanup: null,
};

function readVVNow(): VVSize {
  if (typeof window === "undefined") {
    return { width: 0, height: 0, offsetTop: 0, offsetLeft: 0 };
  }

  const vv = window.visualViewport;
  if (vv) {
    return {
      width: Math.round(vv.width),
      height: Math.round(vv.height),
      offsetTop: Math.round(vv.offsetTop),
      offsetLeft: Math.round(vv.offsetLeft),
    };
  }

  return {
    width: window.innerWidth,
    height: window.innerHeight,
    offsetTop: 0,
    offsetLeft: 0,
  };
}

function startVVListeners(): void {
  if (typeof window === "undefined" || vvStore.listening) return;

  vvStore.listening = true;
  vvStore.size = readVVNow();

  const publish = (): void => {
    vvStore.rafId = null;
    const next = readVVNow();
    const prev = vvStore.size;

    if (
      next.width === prev.width &&
      next.height === prev.height &&
      next.offsetTop === prev.offsetTop &&
      next.offsetLeft === prev.offsetLeft
    ) {
      return;
    }

    vvStore.size = next;
    vvStore.subs.forEach((fn) => fn(next));
  };

  const schedule = (): void => {
    if (vvStore.rafId !== null) return;
    vvStore.rafId = window.requestAnimationFrame(publish);
  };

  const vv = window.visualViewport;

  window.addEventListener("resize", schedule, { passive: true });
  window.addEventListener("orientationchange", schedule, { passive: true });
  window.addEventListener("focusin", schedule, { passive: true });
  window.addEventListener("focusout", schedule, { passive: true });
  if (vv) {
    vv.addEventListener("resize", schedule, { passive: true });
    vv.addEventListener("scroll", schedule, { passive: true });
  }

  vvStore.cleanup = (): void => {
    if (vvStore.rafId !== null) {
      window.cancelAnimationFrame(vvStore.rafId);
      vvStore.rafId = null;
    }

    window.removeEventListener("resize", schedule);
    window.removeEventListener("orientationchange", schedule);
    window.removeEventListener("focusin", schedule);
    window.removeEventListener("focusout", schedule);
    if (vv) {
      vv.removeEventListener("resize", schedule);
      vv.removeEventListener("scroll", schedule);
    }

    vvStore.cleanup = null;
    vvStore.listening = false;
  };
}

function stopVVListenersIfIdle(): void {
  if (vvStore.subs.size > 0) return;
  vvStore.cleanup?.();
}

export function useVisualViewportSize(): VVSize {
  const [size, setSize] = useState<VVSize>(() => readVVNow());

  useEffect(() => {
    if (typeof window === "undefined") return;

    startVVListeners();

    const sub = (s: VVSize): void => setSize(s);
    vvStore.subs.add(sub);
    sub(vvStore.size);

    return () => {
      vvStore.subs.delete(sub);
      stopVVListenersIfIdle();
    };
  }, []);

  return size;
}