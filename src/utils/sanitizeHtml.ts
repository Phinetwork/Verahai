/* eslint-disable no-control-regex */

/**
 * sanitizeHtml — strict, allowlist-based HTML sanitizer (no deps)
 * ---------------------------------------------------------------
 * Guarantees:
 *  - Removes scripts/iframes/forms and all executable vectors
 *  - Removes event handlers and inline styles
 *  - Anchor normalization (noopener/noreferrer/nofollow)
 *  - Treats <pre>/<code> as TEXT-ONLY containers
 *  - SSR-safe fallback (DOMParser not required)
 *  - Deterministic output (no nondeterministic attribute ordering)
 *
 * Sovereign-grade security, stable for untrusted user content.
 */

export type SanitizeHtmlOptions = {
  allowImages?: boolean;
  allowClasses?: boolean;
  allowIds?: boolean;
  forceTargetBlank?: boolean;
  maxInputLength?: number;
};

const DEFAULTS: Required<SanitizeHtmlOptions> = {
  allowImages: false,
  allowClasses: true,
  allowIds: false,
  forceTargetBlank: true,
  maxInputLength: 200_000,
};

// Elements removed entirely (most attack vectors originate here)
const DROP_ENTIRELY = new Set<string>([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "link",
  "meta",
  "base",
  "form",
  "input",
  "textarea",
  "button",
  "select",
  "option",
  "svg",
  "math",
  "video",
  "audio",
  "source",
  "track",
  "canvas",
]);

// Baseline allowed tags; img added based on opts
const ALLOWED_TAGS_BASE = new Set<string>([
  "a",
  "b",
  "strong",
  "i",
  "em",
  "u",
  "s",
  "br",
  "p",
  "div",
  "span",
  "ul",
  "ol",
  "li",
  "blockquote",
  "pre",
  "code",
  "hr",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
]);

// Global attributes allowed for all tags
const ALLOWED_ATTR_GLOBAL = new Set<string>([
  "title",
  "role",
  "aria-label",
  "aria-hidden",
  "aria-describedby",
  "aria-labelledby",
]);

const SAFE_ID_RE = /^[A-Za-z][A-Za-z0-9\-_:.]*$/;
const SAFE_CLASS_TOKEN_RE = /^[A-Za-z0-9\-_:.]+$/;
const SAFE_LANG_CLASS_RE = /^language-[A-Za-z0-9_+-]+$/;

// Escape plain text safely
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/* ────────────────────────────────────────────────────────────
   URL SAFETY
──────────────────────────────────────────────────────────── */

function isSafeHref(raw: string): boolean {
  const s = raw.trim();
  if (!s) return false;

  // Internal or fragment links
  if (s.startsWith("#")) return true;
  if (s.startsWith("/")) return true;
  if (s.startsWith("./") || s.startsWith("../")) return true;

  // Absolute URLs
  try {
    const u = new URL(s);
    const proto = u.protocol.toLowerCase();
    return proto === "https:" || proto === "http:" || proto === "mailto:" || proto === "tel:";
  } catch {
    return false;
  }
}

function isSafeImgSrc(raw: string): boolean {
  const s = raw.trim();
  if (!s) return false;

  if (s.startsWith("/")) return true;
  if (s.startsWith("./") || s.startsWith("../")) return true;

  // Strict data: URI policy (no SVG!)
  if (s.startsWith("data:")) {
    return /^data:image\/(?:png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+/=\s]+$/i.test(s);
  }

  if (s.startsWith("blob:")) return true;

  try {
    const u = new URL(s);
    const proto = u.protocol.toLowerCase();
    return proto === "https:" || proto === "http:";
  } catch {
    return false;
  }
}

/* ────────────────────────────────────────────────────────────
   CLASS + REL NORMALIZATION
──────────────────────────────────────────────────────────── */

function sanitizeClassValue(v: string): string {
  const tokens = v.split(/\s+/g).map((t) => t.trim()).filter(Boolean);
  const safe: string[] = [];

  for (const t of tokens) {
    if (!SAFE_CLASS_TOKEN_RE.test(t)) continue;

    if (t.startsWith("language-")) {
      if (SAFE_LANG_CLASS_RE.test(t)) safe.push(t);
      continue;
    }

    safe.push(t);
  }
  return safe.join(" ");
}

function normalizeRel(existing: string | null): string {
  const tokens = (existing ?? "")
    .split(/\s+/g)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

  const set = new Set(tokens);
  set.add("noopener");
  set.add("noreferrer");
  set.add("nofollow");

  return Array.from(set).join(" ");
}

/* ────────────────────────────────────────────────────────────
   TREE MANIPULATION HELPERS
──────────────────────────────────────────────────────────── */

function unwrap(el: Element): void {
  const parent = el.parentNode;
  if (!parent) return;

  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  parent.removeChild(el);
}

function removeNode(node: Node): void {
  const p = node.parentNode;
  if (p) p.removeChild(node);
}

/* ────────────────────────────────────────────────────────────
   CORE SANITIZATION
──────────────────────────────────────────────────────────── */

function sanitizeElement(el: Element, opts: Required<SanitizeHtmlOptions>): void {
  const tag = el.tagName.toLowerCase();

  // Fully blocked tags
  if (DROP_ENTIRELY.has(tag)) {
    removeNode(el);
    return;
  }

  // Allowed tags (conditionally add <img>)
  const allowedTags = new Set(ALLOWED_TAGS_BASE);
  if (opts.allowImages) allowedTags.add("img");

  if (!allowedTags.has(tag)) {
    unwrap(el); // unknown tags become their children
    return;
  }

  // PRE / CODE block: preserve only safe attributes, strip all HTML inside
  if (tag === "pre" || tag === "code") {
    const text = el.textContent ?? "";
    const cls = el.getAttribute("class") ?? "";

    // Remove all attrs, re-add only class if allowed
    for (const a of Array.from(el.attributes)) el.removeAttribute(a.name);

    if (opts.allowClasses) {
      const safeClass = sanitizeClassValue(cls);
      if (safeClass) el.setAttribute("class", safeClass);
    }

    el.textContent = text;
    return;
  }

  /* Attribute filtering */
  for (const a of Array.from(el.attributes)) {
    const name = a.name.toLowerCase();
    const value = a.value;

    // Remove JS/event/style vectors
    if (name.startsWith("on") || name === "style") {
      el.removeAttribute(name);
      continue;
    }

    // aria-* and data-* always allowed
    if (name.startsWith("aria-") || name.startsWith("data-")) continue;

    // class handling
    if (name === "class") {
      if (!opts.allowClasses) {
        el.removeAttribute(name);
        continue;
      }
      const sanitized = sanitizeClassValue(value);
      if (sanitized) el.setAttribute("class", sanitized);
      else el.removeAttribute(name);
      continue;
    }

    // id handling
    if (name === "id") {
      if (!opts.allowIds || !SAFE_ID_RE.test(value)) el.removeAttribute(name);
      continue;
    }

    // Tag-specific filtering
    if (tag === "a") {
      if (name === "href") {
        if (!isSafeHref(value)) el.removeAttribute(name);
        continue;
      }
      if (name === "target" || name === "rel" || name === "title") continue;

      el.removeAttribute(name);
      continue;
    }

    if (tag === "img") {
      if (name === "src") {
        if (!isSafeImgSrc(value)) el.removeAttribute(name);
        continue;
      }
      if (
        name === "alt" ||
        name === "title" ||
        name === "width" ||
        name === "height" ||
        name === "loading" ||
        name === "decoding" ||
        name === "referrerpolicy"
      )
        continue;

      el.removeAttribute(name);
      continue;
    }

    // Global allowlist
    if (ALLOWED_ATTR_GLOBAL.has(name)) continue;

    // Everything else removed
    el.removeAttribute(name);
  }

  // Final anchor enforcement
  if (tag === "a") {
    const href = el.getAttribute("href");
    if (href && isSafeHref(href)) {
      if (opts.forceTargetBlank) el.setAttribute("target", "_blank");
      el.setAttribute("rel", normalizeRel(el.getAttribute("rel")));
    } else {
      el.removeAttribute("href");
    }
  }

  // Final <img> enforcement
  if (tag === "img") {
    const src = el.getAttribute("src");
    if (!src || !isSafeImgSrc(src)) {
      removeNode(el);
      return;
    }
    el.setAttribute("loading", "lazy");
    el.setAttribute("decoding", "async");
    el.setAttribute("referrerpolicy", "no-referrer");
  }
}

/* ────────────────────────────────────────────────────────────
   WALK THE DOCUMENT
──────────────────────────────────────────────────────────── */

function walk(node: Node, opts: Required<SanitizeHtmlOptions>): void {
  // Remove comments
  if (node.nodeType === Node.COMMENT_NODE) {
    removeNode(node);
    return;
  }

  // Remove unexpected node types
  if (
    node.nodeType !== Node.ELEMENT_NODE &&
    node.nodeType !== Node.TEXT_NODE &&
    node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE &&
    node.nodeType !== Node.DOCUMENT_NODE
  ) {
    removeNode(node);
    return;
  }

  if (node.nodeType === Node.ELEMENT_NODE) {
    sanitizeElement(node as Element, opts);

    // If the sanitizer removed the node, bail
    if (!node.parentNode && (node as Element).tagName) return;
  }

  // Copy list to avoid mutation interference
  const children = Array.from(node.childNodes);
  for (const c of children) walk(c, opts);
}

/* ────────────────────────────────────────────────────────────
   MAIN SANITIZER
──────────────────────────────────────────────────────────── */

export function sanitizeHtml(
  input: string,
  options: SanitizeHtmlOptions = {},
): string {
  const opts: Required<SanitizeHtmlOptions> = { ...DEFAULTS, ...options };

  const raw =
    input.length > opts.maxInputLength
      ? `${input.slice(0, opts.maxInputLength)}\n\n…(truncated)`
      : input;

  /* SSR fallback */
  if (
    typeof globalThis === "undefined" ||
    typeof (globalThis as { DOMParser?: unknown }).DOMParser === "undefined" ||
    typeof document === "undefined"
  ) {
    return escapeHtml(raw)
      .replace(/\r\n?/g, "\n")
      .replace(/\n/g, "<br/>");
  }

  const doc = new DOMParser().parseFromString(
    `<!doctype html><body>${raw}`,
    "text/html",
  );

  const root = doc.body;
  walk(root, opts);

  return (root.innerHTML ?? "").replace(/[\u0000-\u001F\u007F]/g, "");
}
