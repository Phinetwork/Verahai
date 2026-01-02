from __future__ import annotations

import hashlib


def sha256_hex(data: bytes) -> str:
    """Return SHA-256 digest as 64 lowercase hex characters."""
    return hashlib.sha256(data).hexdigest()
