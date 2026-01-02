from __future__ import annotations

import json
from pathlib import Path

from krystal.krl import decode_krl


def test_url_vectors_match():
    fixtures = Path(__file__).parent / "fixtures" / "url_vectors.json"
    data = json.loads(fixtures.read_text(encoding="utf-8"))
    for v in data["vectors"]:
        d = decode_krl(v["url"])
        exp = v["decoded"]
        assert d.kind == exp["kind"]
        assert d.pulse == exp["pulse"]
        assert d.beat == exp["beat"]
        assert d.step_index == exp["stepIndex"]
        assert d.artifact_hash == exp["artifactHash"]
