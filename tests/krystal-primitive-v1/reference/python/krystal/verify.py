from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional

from .kks import kks_1_0
from .krl import decode_krl
from .registry import Registry


@dataclass(frozen=True)
class VerificationIssue:
    index: int
    url: str
    level: str  # 'error' | 'warn'
    code: str
    message: str


@dataclass(frozen=True)
class VerificationResult:
    ok: bool
    total: int
    decoded: int
    issues: List[VerificationIssue]


def verify_registry(registry: Registry, *, strict: bool = True) -> VerificationResult:
    issues: List[VerificationIssue] = []
    decoded = 0

    for i, url in enumerate(registry.urls):
        try:
            d = decode_krl(url)
            decoded += 1
        except Exception as e:
            issues.append(
                VerificationIssue(
                    index=i,
                    url=url,
                    level="error" if strict else "warn",
                    code="krl_decode_failed",
                    message=str(e),
                )
            )
            continue

        # Unknown locators are errors in strict mode (can't be verified)
        if d.kind == "unknown":
            issues.append(
                VerificationIssue(
                    index=i,
                    url=url,
                    level="error" if strict else "warn",
                    code="unknown_locator",
                    message="unrecognized locator shape",
                )
            )
            continue

        # Coordinate validation if claim is present
        if d.pulse is not None and d.beat is not None and d.step_index is not None:
            coord = kks_1_0(d.pulse)
            if coord.beat != d.beat or coord.step_index != d.step_index:
                issues.append(
                    VerificationIssue(
                        index=i,
                        url=url,
                        level="error",
                        code="kks_mismatch",
                        message=(
                            f"claimed beat/step=({d.beat},{d.step_index}) "
                            f"but derived=({coord.beat},{coord.step_index}) for pulse={d.pulse}"
                        ),
                    )
                )

        # If pulse is present but beat/step is missing, that's allowed; verifier can't check.
        # Producers are encouraged to include the capsule for quick validation.

    ok = all(issue.level != "error" for issue in issues)
    return VerificationResult(ok=ok, total=len(registry.urls), decoded=decoded, issues=issues)
