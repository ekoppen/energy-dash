"""display_sleutel.py — sleutels voor displays: alleen de sha256 wordt opgeslagen."""
from __future__ import annotations

import hashlib
import secrets


def nieuwe_sleutel() -> str:
    return "ed_" + secrets.token_urlsafe(32)


def sleutel_id(sleutel: str) -> str:
    return hashlib.sha256(sleutel.encode()).hexdigest()
