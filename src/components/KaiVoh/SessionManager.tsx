// src/components/session/SessionManager.tsx
"use client";

/**
 * SessionManager — unified wrapper for SessionProvider.
 * ---------------------------------------------------------------
 * Fast Refresh compliant:
 *   - Exports ONLY components
 *   - Contains NO hooks, NO context, NO re-exports
 */

import type { ReactNode, ReactElement } from "react";
import { SessionProvider } from "../session/SessionProvider";

interface Props {
  children: ReactNode;
}

export function SessionManager({ children }: Props): ReactElement {
  return <SessionProvider>{children}</SessionProvider>;
}
