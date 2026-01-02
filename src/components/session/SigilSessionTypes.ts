// src/session/SigilSessionTypes.ts

export type SigilSessionData = {
  appId: string;
  userGlyphUrl: string;
  userPhiKey: string;
  kaiSignature?: string;
  pulse: number;
  beat: number;
  stepIndex: number;
  expiresAtPulse?: number;
};

export type CtxShape = {
  session: SigilSessionData | null;
  login: (url: string) => boolean;
  logout: () => void;
};
