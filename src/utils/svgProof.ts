const PROOF_METADATA_ID = "kai-voh-proof";
const PROOF_METADATA_REGEX = new RegExp(
  `<metadata\\b[^>]*id=["']${PROOF_METADATA_ID}["'][^>]*>[\\s\\S]*?<\\/metadata>`,
  "gi"
);

export function stripProofMetadata(svg: string): string {
  return svg.replace(PROOF_METADATA_REGEX, "");
}

export function normalizeSvgForHash(svgText: string): string {
  return stripProofMetadata(svgText);
}

export function svgCanonicalForHash(svg: string): string {
  return normalizeSvgForHash(svg);
}

export function embedProofMetadata(svg: string, bundle: unknown): string {
  const json = JSON.stringify(bundle);
  const block = `<metadata id="${PROOF_METADATA_ID}" type="application/json"><![CDATA[${json}]]></metadata>`;

  PROOF_METADATA_REGEX.lastIndex = 0;
  if (PROOF_METADATA_REGEX.test(svg)) {
    PROOF_METADATA_REGEX.lastIndex = 0;
    return svg.replace(PROOF_METADATA_REGEX, block);
  }

  const closeTag = "</svg>";
  const idx = svg.lastIndexOf(closeTag);
  if (idx === -1) return `${svg}${block}`;
  return `${svg.slice(0, idx)}${block}${svg.slice(idx)}`;
}
