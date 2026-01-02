// (Place once in your project, e.g. src/types/global.d.ts)
import type { Groth16 } from "../components/VerifierStamper/zk";

declare global {
  interface Window {
    __PSHORT__?: string;
    snarkjs?: { groth16?: Groth16 };
  }
  interface ImportMetaEnv {
    readonly VITE_PSHORT?: string;
  }
  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}
export {};
