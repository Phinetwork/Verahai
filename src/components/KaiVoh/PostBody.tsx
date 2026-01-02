// PostBody.tsx
"use client";

/**
 * PostBody — renders post content with:
 * - Fenced code blocks (```lang ... ```) rendered as real code (never executed)
 * - Optional sanitized HTML segments
 * - Plain text paragraphs w/ preserved line breaks
 *
 * This is the “highest safety” posture: code is always treated as text,
 * HTML is allowlist-sanitized before rendering.
 */

import React, { useMemo, useState } from "react";
import { sanitizeHtml } from "../../utils/sanitizeHtml";

type PostFormat = "auto" | "text" | "html";

export type PostBodyProps = {
  content?: string | null;
  /** auto = detect HTML; code fences always win. Default: auto */
  format?: PostFormat;
  /** Allow sanitized HTML rendering. Default: true (still sanitized). */
  allowHtml?: boolean;
  /** Allow <img> in HTML. Default: false. */
  allowImages?: boolean;
  className?: string;
  /** Defensive clamp for absurdly large bodies. Default: 200_000 */
  maxChars?: number;
};

type Segment =
  | { kind: "text"; text: string }
  | { kind: "code"; code: string; lang?: string };

const DEFAULT_MAX = 200_000 as const;

function normalizeNewlines(s: string): string {
  return s.replace(/\r\n?/g, "\n");
}

function looksLikeHtml(s: string): boolean {
  // Heuristic: tags or entities commonly used in HTML fragments.
  // Keep it conservative to avoid “<3” being treated as HTML.
  const t = s.trim();
  if (!t) return false;
  if (t.startsWith("<") && t.endsWith(">")) return true;
  return /<\/?[a-z][\s\S]*>/i.test(t);
}

function splitFencedCode(input: string): Segment[] {
  const text = normalizeNewlines(input);
  const lines = text.split("\n");

  const out: Segment[] = [];
  let textBuf: string[] = [];

  let inCode = false;
  let codeBuf: string[] = [];
  let codeLang: string | undefined;

  const flushText = (): void => {
    const joined = textBuf.join("\n");
    if (joined.trim().length > 0 || joined.length > 0) out.push({ kind: "text", text: joined });
    textBuf = [];
  };

  const flushCode = (): void => {
    const joined = codeBuf.join("\n");
    out.push({ kind: "code", code: joined, lang: codeLang });
    codeBuf = [];
    codeLang = undefined;
  };

  for (const line of lines) {
    const fenceMatch = line.match(/^```([A-Za-z0-9_+-]*)\s*$/);
    if (fenceMatch) {
      if (!inCode) {
        flushText();
        inCode = true;
        codeLang = fenceMatch[1] ? fenceMatch[1].toLowerCase() : undefined;
      } else {
        // closing fence
        flushCode();
        inCode = false;
      }
      continue;
    }

    if (inCode) codeBuf.push(line);
    else textBuf.push(line);
  }

  // Unclosed fence: treat remainder as code
  if (inCode) flushCode();
  else flushText();

  return out;
}

function splitParagraphs(text: string): string[] {
  const t = normalizeNewlines(text).trimEnd();
  // Preserve intentional spacing: split on blank lines
  return t.length ? t.split(/\n{2,}/g) : [];
}

function normalizeLangLabel(lang?: string): string | undefined {
  if (!lang) return undefined;
  const clean = lang.trim().toLowerCase();
  if (!clean) return undefined;
  // keep it short & safe
  if (!/^[a-z0-9_+-]{1,24}$/.test(clean)) return undefined;
  return clean;
}

function CodeBlock(props: { code: string; lang?: string }): React.JSX.Element {
  const [copied, setCopied] = useState<boolean>(false);
  const lang = normalizeLangLabel(props.lang);

  return (
    <div className="post-body__code">
      <div className="post-body__codeHead">
        <div className="post-body__codeLang">{lang ? lang : "code"}</div>
        <button
          type="button"
          className="post-body__codeCopy"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(props.code);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 900);
            } catch {
              setCopied(false);
            }
          }}
          aria-label="Copy code"
          title="Copy code"
        >
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>

      <pre className="post-body__pre">
        <code className={lang ? `language-${lang}` : undefined}>{props.code}</code>
      </pre>
    </div>
  );
}

function PlainTextBlock(props: { text: string }): React.JSX.Element {
  const paras = useMemo(() => splitParagraphs(props.text), [props.text]);
  if (paras.length === 0) return <div className="post-body__text" />;

  return (
    <div className="post-body__text">
      {paras.map((p, i) => {
        const lines = normalizeNewlines(p).split("\n");
        return (
          <p key={`p-${i}`} className="post-body__p">
            {lines.map((ln, j) => (
              <React.Fragment key={`l-${i}-${j}`}>
                {ln}
                {j < lines.length - 1 ? <br /> : null}
              </React.Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

function HtmlBlock(props: { html: string }): React.JSX.Element {
  return (
    <div
      className="post-body__html"
      // sanitized upstream; never pass raw
      dangerouslySetInnerHTML={{ __html: props.html }}
    />
  );
}

export default function PostBody({
  content,
  format = "auto",
  allowHtml = true,
  allowImages = false,
  className,
  maxChars = DEFAULT_MAX,
}: PostBodyProps): React.JSX.Element {
  const safeContent = useMemo(() => {
    const raw = (content ?? "").toString();
    if (raw.length <= maxChars) return raw;
    return `${raw.slice(0, maxChars)}\n\n…(truncated)`;
  }, [content, maxChars]);

  const segments = useMemo(() => splitFencedCode(safeContent), [safeContent]);

  const rendered = useMemo(() => {
    return segments.map((seg, idx) => {
      if (seg.kind === "code") {
        return (
          <div key={`seg-${idx}`} className="post-body__seg">
            <CodeBlock code={seg.code} lang={seg.lang} />
          </div>
        );
      }

      const t = seg.text;

      const shouldHtml =
        allowHtml &&
        (format === "html" || (format === "auto" && looksLikeHtml(t)));

      if (shouldHtml) {
        const cleaned = sanitizeHtml(t, {
          allowImages,
          allowClasses: true,
          allowIds: false,
          forceTargetBlank: true,
          maxInputLength: maxChars,
        });
        return (
          <div key={`seg-${idx}`} className="post-body__seg">
            <HtmlBlock html={cleaned} />
          </div>
        );
      }

      return (
        <div key={`seg-${idx}`} className="post-body__seg">
          <PlainTextBlock text={t} />
        </div>
      );
    });
  }, [segments, allowHtml, allowImages, format, maxChars]);

  return <div className={className ? `post-body ${className}` : "post-body"}>{rendered}</div>;
}
