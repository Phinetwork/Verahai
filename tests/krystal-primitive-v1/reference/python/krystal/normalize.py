from __future__ import annotations

import json
from dataclasses import dataclass
from typing import List, Tuple
from urllib.parse import urlparse, parse_qs

from .b64 import b64url_decode_unpadded, b64url_encode_unpadded
from .kks import kks_1_0
from .registry import Registry


@dataclass(frozen=True)
class NormalizeResult:
    fixed_capsules: int
    total: int


def _encode_json_b64url(obj: dict) -> str:
    # Stable encoding for payload transport.
    # (Payload transport is not hashed; this is for deterministic outputs.)
    s = json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return b64url_encode_unpadded(s.encode("utf-8"))


def normalize_registry(registry: Registry) -> Tuple[Registry, NormalizeResult]:
    """Return a new Registry where any capsule payloads are corrected to match KKS-1.0.

    Only rewrites the capsule metadata (b/s) to match the canonical KKS mapping for its pulse.
    Does not fetch any artifact bytes.
    """
    fixed = 0
    new_urls: List[str] = []

    for url in registry.urls:
        pu = urlparse(url)

        if pu.path.startswith("/s/"):
            qs = parse_qs(pu.query)
            if "p" in qs:
                p = qs["p"][0]
                if p.startswith("c:"):
                    payload = json.loads(b64url_decode_unpadded(p[2:]).decode("utf-8"))
                    if isinstance(payload, dict) and "u" in payload:
                        pulse = int(payload["u"])
                        coord = kks_1_0(pulse)
                        if payload.get("b") != coord.beat or payload.get("s") != coord.step_index:
                            payload["b"] = coord.beat
                            payload["s"] = coord.step_index
                            new_p = "c:" + _encode_json_b64url(payload)
                            new_url = f"{pu.scheme}://{pu.netloc}{pu.path}?p={new_p}"
                            new_urls.append(new_url)
                            fixed += 1
                            continue

        new_urls.append(url)

    return Registry(urls=new_urls), NormalizeResult(fixed_capsules=fixed, total=len(new_urls))
