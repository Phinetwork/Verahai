// src/utils/useClientReady.ts
//
// Simple "client is ready" hook.
// React 19-safe: avoids calling setState synchronously inside an effect body
// by deferring the update to requestAnimationFrame. This preserves the
// semantics of: false on first render → true after first commit.

import { useEffect, useState } from "react";

export function useClientReady(): boolean {
  const [isReady, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const frameId = window.requestAnimationFrame(() => {
      if (!cancelled) {
        setReady(true);
      }
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frameId);
    };
  }, []);

  return isReady;
}
