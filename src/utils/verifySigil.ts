import { derivePhiKeyFromSig } from "../components/VerifierStamper/sigilUtils";
import { extractEmbeddedMetaFromSvg, type EmbeddedMeta } from "./sigilMetadata";

export type SlugInfo = {
  raw: string;
  pulse: number | null;
  shortSig: string | null;
};

export type VerifyChecks = {
  hasSignature: boolean;
  slugPulseMatches: boolean | null;
  slugShortSigMatches: boolean | null;
  derivedPhiKeyMatchesEmbedded: boolean | null;
};

export type VerifyResult =
  | {
      status: "idle";
    }
  | {
      status: "error";
      message: string;
      slug: SlugInfo;
      embedded?: EmbeddedMeta;
      derivedPhiKey?: string;
      checks?: VerifyChecks;
    }
  | {
      status: "ok";
      slug: SlugInfo;
      embedded: EmbeddedMeta;
      derivedPhiKey: string;
      checks: VerifyChecks;
    };

export function parseSlug(rawSlug: string): SlugInfo {
  const raw = decodeURIComponent(rawSlug || "").trim();
  const m = raw.match(/^(\d+)-([A-Za-z0-9]+)$/);
  if (!m) return { raw, pulse: null, shortSig: null };

  const pulseNum = Number(m[1]);
  const pulse = Number.isFinite(pulseNum) && pulseNum > 0 ? pulseNum : null;
  const shortSig = m[2] ? String(m[2]) : null;

  return { raw, pulse, shortSig };
}

function firstN(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n);
}

export async function verifySigilSvg(slug: SlugInfo, svgText: string): Promise<VerifyResult> {
  try {
    const embedded = extractEmbeddedMetaFromSvg(svgText);
    const sig = (embedded.kaiSignature ?? "").trim();
    if (!sig) {
      return {
        status: "error",
        message: "No kaiSignature found in the SVG metadata.",
        slug,
        embedded,
      };
    }

    const derivedPhiKey = await derivePhiKeyFromSig(sig);
    const embeddedPhiKey = (embedded.phiKey ?? "").trim();
    const embeddedPulseExact = embedded.pulseExact;
    const embeddedPulse =
      embeddedPulseExact && Number.isFinite(Number(embeddedPulseExact))
        ? Number(embeddedPulseExact)
        : embedded.pulse;

    const slugPulseMatches =
      slug.pulse == null || embeddedPulse == null ? null : slug.pulse === embeddedPulse;

    const slugShortSigMatches =
      slug.shortSig == null ? null : slug.shortSig === firstN(sig, slug.shortSig.length);

    const derivedPhiKeyMatchesEmbedded =
      embeddedPhiKey.length === 0 ? null : derivedPhiKey === embeddedPhiKey;

    const checks: VerifyChecks = {
      hasSignature: true,
      slugPulseMatches,
      slugShortSigMatches,
      derivedPhiKeyMatchesEmbedded,
    };

    const hardFail =
      checks.slugPulseMatches === false ||
      checks.slugShortSigMatches === false ||
      checks.derivedPhiKeyMatchesEmbedded === false;

    if (hardFail) {
      return {
        status: "error",
        message: "Verification failed: one or more checks did not match.",
        slug,
        embedded,
        derivedPhiKey,
        checks,
      };
    }

    const normalizedEmbedded: EmbeddedMeta = {
      ...embedded,
      pulse: embeddedPulse ?? embedded.pulse,
    };

    return {
      status: "ok",
      slug,
      embedded: {
        ...normalizedEmbedded,
        phiKey: embeddedPhiKey.length > 0 ? embeddedPhiKey : derivedPhiKey,
      },
      derivedPhiKey,
      checks,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Verification failed.";
    return { status: "error", message: msg, slug };
  }
}
