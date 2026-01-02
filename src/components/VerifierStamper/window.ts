import type { VerifierBridge } from "../exhale-note/types";
import type { SigilZkBridge } from "./types";

declare global {
  interface Window {
    SIGIL_ZK_VKEY?: unknown;
    SIGIL_ZK?: SigilZkBridge;
    KKVerifier?: VerifierBridge;
  }
}

export const setSigilZkVkey = (vkey: unknown): void => {
  window.SIGIL_ZK_VKEY = vkey;
};

export const getSigilZkVkey = (): unknown | undefined => window.SIGIL_ZK_VKEY;

export const getSigilZkBridge = (): SigilZkBridge | undefined => window.SIGIL_ZK;

export const setVerifierBridge = (bridge: VerifierBridge): void => {
  window.KKVerifier = bridge;
};
