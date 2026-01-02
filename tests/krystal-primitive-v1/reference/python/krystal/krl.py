from __future__ import annotations

from dataclasses import dataclass
from typing import Optional
from urllib.parse import urlparse, parse_qs

import json

from .b64 import b64url_decode_unpadded


@dataclass(frozen=True)
class KRLDecoded:
    """Decoded Krystal Resource Locator."""

    kind: str  # 'stream' | 'content' | 'unknown'
    url: str
    pulse: Optional[int]
    beat: Optional[int]
    step_index: Optional[int]
    payload: Optional[dict]
    artifact_hash: Optional[str]


def _json_from_b64url(b64: str) -> dict:
    raw = b64url_decode_unpadded(b64)
    obj = json.loads(raw.decode("utf-8"))
    if not isinstance(obj, dict):
        raise TypeError("decoded payload must be a JSON object")
    return obj


def decode_krl(url: str) -> KRLDecoded:
    """Decode a KRL-1.0 locator string.

    Supported:
      - Stream (path):      /stream/p/{b64url_json}
      - Stream (fragment):  /stream#t={b64url_json}
      - Content:            /s/{hexhash}?p={b64url_json} or ?p=c:{b64url_json}
    """
    pu = urlparse(url)
    path = pu.path

    # Stream locator (path-based)
    if "/stream/p/" in path:
        b64 = path.split("/stream/p/")[1]
        payload = _json_from_b64url(b64)

        pulse = payload.get("pulse")
        beat = payload.get("beat")
        step_index = payload.get("stepIndex")

        return KRLDecoded(
            kind="stream",
            url=url,
            pulse=int(pulse) if pulse is not None else None,
            beat=int(beat) if beat is not None else None,
            step_index=int(step_index) if step_index is not None else None,
            payload=payload,
            artifact_hash=None,
        )

    # Stream locator (fragment-based, e.g. /stream#t=...)
    if path.rstrip("/").endswith("/stream") and pu.fragment:
        frag_qs = parse_qs(pu.fragment)
        if "t" in frag_qs:
            payload = _json_from_b64url(frag_qs["t"][0])
            pulse = payload.get("pulse")
            beat = payload.get("beat")
            step_index = payload.get("stepIndex")
            return KRLDecoded(
                kind="stream",
                url=url,
                pulse=int(pulse) if pulse is not None else None,
                beat=int(beat) if beat is not None else None,
                step_index=int(step_index) if step_index is not None else None,
                payload=payload,
                artifact_hash=None,
            )

    # Content locator
    if path.startswith("/s/"):
        artifact_hash = path.split("/")[-1]
        qs = parse_qs(pu.query)
        payload = None
        pulse = beat = step_index = None

        if "p" in qs:
            p = qs["p"][0]
            if p.startswith("c:"):
                payload = _json_from_b64url(p[2:])
                pulse = payload.get("u")
                beat = payload.get("b")
                step_index = payload.get("s")
            else:
                payload = _json_from_b64url(p)
                pulse = payload.get("pulse")
                beat = payload.get("beat")
                step_index = payload.get("stepIndex")

        return KRLDecoded(
            kind="content",
            url=url,
            pulse=int(pulse) if pulse is not None else None,
            beat=int(beat) if beat is not None else None,
            step_index=int(step_index) if step_index is not None else None,
            payload=payload,
            artifact_hash=artifact_hash,
        )

    return KRLDecoded(
        kind="unknown",
        url=url,
        pulse=None,
        beat=None,
        step_index=None,
        payload=None,
        artifact_hash=None,
    )
