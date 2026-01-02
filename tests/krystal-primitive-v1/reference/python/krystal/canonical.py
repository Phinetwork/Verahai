from __future__ import annotations

import math
from typing import Any


def _escape_json_string(s: str) -> str:
    """Return the minimally-escaped JSON string content (without surrounding quotes)."""
    # Minimal JSON escaping (RFC 8259):
    # - escape backslash and double quote
    # - escape control characters U+0000..U+001F
    # - do NOT escape '/' or non-ASCII characters unnecessarily
    out: list[str] = []
    for ch in s:
        code = ord(ch)
        if ch == '"':
            out.append('\\"')   # JSON requires escaping double quotes
        elif ch == "\\":
            out.append('\\\\')  # JSON requires escaping backslash
        elif code < 0x20:
            # Control characters
            if ch == "\b":
                out.append("\\b")
            elif ch == "\f":
                out.append("\\f")
            elif ch == "\n":
                out.append("\\n")
            elif ch == "\r":
                out.append("\\r")
            elif ch == "\t":
                out.append("\\t")
            else:
                out.append("\\u%04x" % code)
        else:
            out.append(ch)
    return "".join(out)


def canonicalize_json(value: Any) -> bytes:
    """Return KCS-1 canonical JSON UTF-8 bytes for the given JSON value.

    Supported types:
      - dict (object) with string keys
      - list/tuple (array)
      - str
      - int
      - bool
      - None

    Floats are rejected to keep determinism strict.

    This canonicalization is designed to be stable across languages:
      - object keys sorted lexicographically
      - no insignificant whitespace
      - minimal required string escaping
      - integers as minimal base-10

    Raises:
        TypeError: on unsupported types or non-string object keys
        ValueError: on NaN/Infinity floats (if ever allowed)
    """

    def enc(v: Any) -> str:
        if v is None:
            return "null"
        if v is True:
            return "true"
        if v is False:
            return "false"
        if isinstance(v, int) and not isinstance(v, bool):
            return str(v)
        if isinstance(v, float):
            # Reject floats for strict determinism in v1.
            if math.isnan(v) or math.isinf(v):
                raise ValueError("non-finite number not allowed")
            raise TypeError("floats are not allowed in canonical form (use integers)")
        if isinstance(v, str):
            return '"' + _escape_json_string(v) + '"'
        if isinstance(v, (list, tuple)):
            return "[" + ",".join(enc(x) for x in v) + "]"
        if isinstance(v, dict):
            # Keys must be strings; sort lexicographically by Unicode codepoints.
            items: list[str] = []
            for k in sorted(v.keys(), key=lambda x: x):
                if not isinstance(k, str):
                    raise TypeError("object keys must be strings")
                items.append('"' + _escape_json_string(k) + '":' + enc(v[k]))
            return "{" + ",".join(items) + "}"
        raise TypeError(f"unsupported type for canonical JSON: {type(v)}")

    return enc(value).encode("utf-8")
