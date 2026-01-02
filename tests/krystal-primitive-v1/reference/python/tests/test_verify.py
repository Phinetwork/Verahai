from __future__ import annotations

import json
from pathlib import Path

from krystal.registry import load_registry
from krystal.verify import verify_registry


def test_verify_registry_sample_ok():
    fixtures = Path(__file__).parent / "fixtures" / "registry_sample.json"
    reg = load_registry(fixtures)
    result = verify_registry(reg, strict=True)
    assert result.ok, result.issues
