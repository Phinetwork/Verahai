from __future__ import annotations

import base64


def b64url_encode_unpadded(data: bytes) -> str:
    """Base64url encode without '=' padding."""
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def b64url_decode_unpadded(text: str) -> bytes:
    """Decode base64url without '=' padding."""
    # restore padding
    pad = "=" * (-len(text) % 4)
    return base64.urlsafe_b64decode(text + pad)
