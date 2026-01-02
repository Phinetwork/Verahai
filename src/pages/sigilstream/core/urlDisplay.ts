// src/pages/sigilstream/core/urlDisplay.ts

function truncateMiddle(s: string, head: number, tail: number): string {
  const t = (s ?? "").toString();
  if (t.length <= head + tail + 1) return t;
  return `${t.slice(0, head)}…${t.slice(-tail)}`;
}

function safeDecodeURIComponent(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function truncateToken(token: string): string {
  const t = (token ?? "").trim();
  if (!t) return t;
  // first few + last few (payload-style)
  return truncateMiddle(t, 14, 12);
}

/**
 * Display-only truncation:
 * - keeps URL clickable (href stays full elsewhere)
 * - shows first/last of payload token for /stream/p/<token>, /p~<token>, #t=<token>, ?t=<token>
 */
export function truncateUrlForDisplay(fullUrl: string): string {
  const raw = (fullUrl ?? "").trim();
  if (!raw) return raw;

  try {
    const u = new URL(raw);
    const origin = u.origin;

    // /p~<token>
    if (u.pathname.startsWith("/p~")) {
      const tok = u.pathname.slice(3);
      return `${origin}/p~${truncateToken(tok)}`;
    }

    // /stream/p/<token> or /feed/p/<token>
    const m = u.pathname.match(/\/(stream|feed)\/p\/([^/]+)/);
    if (m) {
      const prefix = `/${m[1]}/p/`;
      const tok = safeDecodeURIComponent(m[2] ?? "");
      return `${origin}${prefix}${truncateToken(tok)}`;
    }

    // hash #t=<token> / #p=<token> / #token=<token>
    if (u.hash && u.hash !== "#") {
      const h = new URLSearchParams(u.hash.startsWith("#") ? u.hash.slice(1) : u.hash);
      const tok = h.get("t") ?? h.get("p") ?? h.get("token");
      if (tok) return `${origin}${u.pathname}#t=${truncateToken(tok)}`;
    }

    // query ?t=<token> / ?p=<token> / ?token=<token>
    if (u.search && u.search !== "?") {
      const s = new URLSearchParams(u.search);
      const tok = s.get("t") ?? s.get("p") ?? s.get("token");
      if (tok) return `${origin}${u.pathname}?t=${truncateToken(tok)}`;
    }

    // generic fallback for long URLs
    return raw.length > 100 ? truncateMiddle(raw, 52, 28) : raw;
  } catch {
    // not a URL; just truncate the string
    return raw.length > 100 ? truncateMiddle(raw, 52, 28) : raw;
  }
}
