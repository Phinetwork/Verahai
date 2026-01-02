/* src/components/KaiVoh/SocialConnector.shared.ts */

/* -------------------------------------------------------------------------- */
/*                                   Types                                    */
/* -------------------------------------------------------------------------- */

export type SocialPlatform =
  | "x"
  | "instagram"
  | "facebook"
  | "linkedin"
  | "tiktok"
  | "system-share"
  | "copy-caption"
  | "copy-proof"
  | "download";

export interface SocialMediaPayload {
  content: Blob;
  filename: string;
  type: "image" | "video" | "text";
  metadata?: {
    kaiSignature?: string;
    phiKey?: string;
    pulse?: number;
    chakraDay?: string;
    verifierUrl?: string;
    // Structured future-safe fields (no any)
    [key: string]: string | number | boolean | null | undefined;
  };
}

export interface SocialConnectorProps {
  /** Sealed media that came out of your SignatureEmbedder / KKS pipeline. */
  media: SocialMediaPayload | null;
  /** Optional human-readable caption; we append proof metadata under it. */
  suggestedCaption?: string;
  /**
   * Optional explicit verifier URL. If omitted, we look in metadata.verifierUrl
   * and otherwise omit it from the caption.
   */
  verifierUrl?: string;
  /** Callback when a share path completes successfully. */
  onShared?: (platform: SocialPlatform) => void;
  /** Callback when a share path errors. */
  onError?: (platform: SocialPlatform, error: Error) => void;
}

export interface ProofContext {
  baseCaption?: string;
  phiKey?: string;
  kaiSignature?: string;
  pulse?: number;
  chakraDay?: string;
  verifierUrl?: string;
}

/* -------------------------------------------------------------------------- */
/*                          Caption / Proof Helpers                           */
/* -------------------------------------------------------------------------- */

/**
 * Build the canonical proof caption that will accompany any social post.
 * This is what makes the post self-verifiable as human-authored under a Φ-Key.
 */
export function buildProofCaption(ctx: ProofContext): string {
  const { baseCaption, phiKey, kaiSignature, pulse, chakraDay, verifierUrl } =
    ctx;

  const lines: string[] = [];

  if (baseCaption && baseCaption.trim().length > 0) {
    lines.push(baseCaption.trim(), "");
  }

  lines.push("—");
  lines.push("Kai-Sigil Proof of Origin");
  if (phiKey) lines.push(`Φ-Key: ${phiKey}`);
  if (kaiSignature) lines.push(`Kai Signature: ${kaiSignature}`);
  if (typeof pulse === "number") lines.push(`Pulse: ${pulse}`);
  if (chakraDay) lines.push(`Chakra Day: ${chakraDay}`);

  if (verifierUrl) {
    lines.push("");
    lines.push(`Verify this post: ${verifierUrl}`);
  }

  return lines.join("\n");
}

/** Deterministic proof JSON for copy/save/debug */
export function buildProofJson(ctx: ProofContext): string {
  const { phiKey, kaiSignature, pulse, chakraDay, verifierUrl } = ctx;

  const proof = {
    phiKey: phiKey ?? null,
    kaiSignature: kaiSignature ?? null,
    pulse: typeof pulse === "number" ? pulse : null,
    chakraDay: chakraDay ?? null,
    verifierUrl: verifierUrl ?? null,
  };

  return JSON.stringify(proof, null, 2);
}
