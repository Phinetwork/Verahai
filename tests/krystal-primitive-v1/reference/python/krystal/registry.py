from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import List


@dataclass(frozen=True)
class Registry:
    """KRC-0 registry."""
    urls: List[str]


def load_registry(path: str | Path) -> Registry:
    p = Path(path)
    obj = json.loads(p.read_text(encoding="utf-8"))
    if not isinstance(obj, dict):
        raise TypeError("registry must be a JSON object")
    if "urls" not in obj:
        raise ValueError("registry missing 'urls'")
    urls = obj["urls"]
    if not isinstance(urls, list):
        raise TypeError("registry 'urls' must be an array")
    for i, u in enumerate(urls):
        if not isinstance(u, str):
            raise TypeError(f"registry urls[{i}] must be a string")
    return Registry(urls=list(urls))
