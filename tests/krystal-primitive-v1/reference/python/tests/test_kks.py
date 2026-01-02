from __future__ import annotations

import json
from pathlib import Path

from krystal.kks import kks_1_0


def test_kks_vectors_match():
    fixtures = Path(__file__).parent / "fixtures" / "kks_vectors.json"
    data = json.loads(fixtures.read_text(encoding="utf-8"))
    for v in data["vectors"]:
        pulse = int(v["pulse"])
        coord = kks_1_0(pulse)
        assert coord.beat == v["beat"]
        assert coord.step_index == v["stepIndex"]
        assert coord.pulse_in_step == v["pulseInStep"]
        assert coord.day_index == v["dayIndex"]
        assert coord.grid_index == v["gridIndex"]
