"""Production-only Cartwheel credentials for the local reference integration."""
import hashlib
import json
import os
from dataclasses import dataclass
from pathlib import Path


PRODUCTION_API_URL = "https://external-mogen.api.getcartwheel.com"
API_KEY_SETTING = "Cartwheel.Connection.ProductionApiKey"


@dataclass(frozen=True, repr=False)
class Connection:
    api_key: str

    @property
    def environment(self):
        return "production"

    @property
    def base_url(self):
        return PRODUCTION_API_URL

    @property
    def fingerprint(self):
        # Retain the production identity so interrupted production jobs resume.
        return hashlib.sha256(f"production\0{self.base_url}\0{self.api_key}".encode()).hexdigest()


def read_connection(settings_path: Path, *, multi_user=False):
    if multi_user:
        raise ValueError("The Cartwheel reference integration supports single-user ComfyUI only. Shared service credentials require a user-scoped proxy.")
    try:
        settings = json.loads(settings_path.read_text()) if settings_path.is_file() else {}
    except (OSError, ValueError):
        raise ValueError("Cartwheel settings could not be read. Open ComfyUI Settings → Cartwheel → Connection.") from None
    if not isinstance(settings, dict):
        raise ValueError("Cartwheel connection settings must be a JSON object.")
    value = os.environ.get("CARTWHEEL_API_KEY") or settings.get(API_KEY_SETTING, "")
    if not isinstance(value, str) or not value.strip():
        raise ValueError("Add your API key in ComfyUI Settings → Cartwheel → Connection, then run again.")
    api_key = value.strip()
    if any(ord(char) < 33 or ord(char) > 126 for char in api_key):
        raise ValueError("The Cartwheel API key contains invalid characters. Paste the key without spaces or line breaks.")
    return Connection(api_key)
