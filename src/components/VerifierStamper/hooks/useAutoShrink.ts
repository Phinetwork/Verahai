import { useEffect, useRef, useState, type DependencyList } from "react";

export default function useAutoShrink<T extends HTMLElement>(
  deps: DependencyList,
  paddingPx = 16,
  minScale = 0.65
) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<T | null>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const box = boxRef.current;
    const txt = textRef.current;
    if (!box || !txt) return;

    const recompute = () => {
      // available width inside the pill minus padding
      const boxW = Math.max(0, box.clientWidth - paddingPx);
      const textW = txt.scrollWidth;
      if (boxW <= 0 || textW <= 0) {
        setScale(1);
        return;
      }

      const next = Math.min(1, Math.max(minScale, boxW / textW));
      setScale(next);
    };

    // First compute + observe future changes
    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(box);
    ro.observe(txt);

    // Also adjust on font load / viewport changes
    window.addEventListener("resize", recompute);
    const id = window.setInterval(recompute, 250); // cheap safety net

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", recompute);
      window.clearInterval(id);
    };
  }, deps);

  return { boxRef, textRef, scale };
}
