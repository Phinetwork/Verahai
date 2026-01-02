import React, { useState } from "react";
import { extractMetadataFromSvg } from "../utils/extractKaiMetadata";
import { validateSvgForVerifier } from "../utils/svgMeta";
import type { VerificationResult } from "../types";

interface VerifierFormProps {
  onResult: (result: VerificationResult | null) => void;
  onLoadingChange: (loading: boolean) => void;
}

export const VerifierForm: React.FC<VerifierFormProps> = ({
  onResult,
  onLoadingChange,
}) => {
  const [url, setUrl] = useState("");

  /**
   * Shared SVG verification pipeline.
   * 1. Run through SVG validator (KKS-compliant Kai Sigil check).
   * 2. If valid, extract embedded metadata (Kai Signature, Φ-key, etc.).
   */
  function verifySvgText(svgText: string): VerificationResult {
    const { ok, errors } = validateSvgForVerifier(svgText);

    if (!ok) {
      const firstError = errors && errors.length ? errors[0] : null;
      return {
        status: "error",
        title: "Invalid or unsupported Sigil SVG",
        message:
          firstError ??
          "This file does not appear to be a KKS-compliant Kai Sigil. Make sure you’re using a real minted glyph.",
      };
    }

    // If it passes the canonical verifier, we can safely trust the metadata extractor.
    return extractMetadataFromSvg(svgText);
  }

  async function handleUrlSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;

    onLoadingChange(true);
    onResult(null);

    try {
      const response = await fetch(trimmed);
      if (!response.ok) {
        onResult({
          status: "error",
          title: "Failed to fetch URL",
          message: `HTTP ${response.status}: ${response.statusText}. Make sure this URL points directly to the Sigil SVG and is publicly accessible (no auth / CORS blocks).`,
        });
        return;
      }

      const text = await response.text();
      const result = verifySvgText(text);
      onResult(result);
    } catch {
      onResult({
        status: "error",
        title: "Network error",
        message:
          "There was an error fetching the provided URL. Check your connection and confirm the URL points directly to a Kai Sigil SVG.",
      });
    } finally {
      onLoadingChange(false);
    }
  }

  const handleFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (
      !file.type.includes("svg") &&
      !file.name.toLowerCase().endsWith(".svg")
    ) {
      onResult({
        status: "error",
        title: "Unsupported file type",
        message:
          "verify.kai accepts Kai Sigil SVGs with embedded KKS metadata. Please choose a .svg file minted from Kai-Klok.",
      });
      return;
    }

    onLoadingChange(true);
    onResult(null);

    try {
      const text = await file.text();
      const result = verifySvgText(text);
      onResult(result);
    } catch {
      onResult({
        status: "error",
        title: "File read error",
        message:
          "There was an error reading the selected file. Try re-exporting the Sigil from Kai-Klok and uploading again.",
      });
    } finally {
      onLoadingChange(false);
    }
  };

  return (
    <section className="verifier">
      {/* URL-based verification */}
      <form className="verifier-form" onSubmit={handleUrlSubmit}>
        <label htmlFor="sigil-url" className="field-label">
          Paste a Kai Sigil URL
        </label>
        <div className="field-row">
          <input
            id="sigil-url"
            type="url"
            inputMode="url"
            autoComplete="off"
            placeholder="https://…your-sigil.svg"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <button type="submit">Verify</button>
        </div>
        <p className="field-hint">
          Use a direct link to the Sigil SVG (for example from a Kai-Klok export or
          glyph host). We&apos;ll fetch it, validate the KKS metadata, and read the
          embedded Kai Signature.
        </p>
      </form>

      <div className="divider">
        <span>or</span>
      </div>

      {/* File-based verification */}
      <div className="file-uploader">
        <label htmlFor="sigil-file" className="file-label">
          Drop a Sigil SVG
        </label>
        <input
          id="sigil-file"
          type="file"
          accept="image/svg+xml,.svg"
          onChange={handleFileChange}
        />
        <p className="field-hint">
          Upload a real Kai Sigil exported from Kai-Klok. We&apos;ll confirm it is
          a valid KKS glyph and surface the full embedded metadata.
        </p>
      </div>
    </section>
  );
};
