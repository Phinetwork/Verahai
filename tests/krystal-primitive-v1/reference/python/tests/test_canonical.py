from __future__ import annotations

import json
from pathlib import Path

from krystal.canonical import canonicalize_json
from krystal.hashing import sha256_hex


def test_canonical_vectors_match():
    fixtures = Path(__file__).parent / "fixtures" / "canonical_vectors.json"
    data = json.loads(fixtures.read_text(encoding="utf-8"))
    for v in data["vectors"]:
        canon = canonicalize_json(v["input"]).decode("utf-8")
        assert canon == v["canonical"]
        assert sha256_hex(canon.encode("utf-8")) == v["sha256"]
