from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


BASE_DIR = Path(__file__).resolve().parent.parent
ENV_PATH = BASE_DIR / ".env"

load_dotenv(ENV_PATH)


@dataclass(frozen=True, slots=True)
class Settings:
    client_id: str
    client_secret: str
    request_timeout: int = 30
    log_level: str = "INFO"
    auth_url: str = "https://id.cisco.com/oauth2/default/v1/token"
    software_suggestion_base_url: str = "https://apix.cisco.com/software/suggestion/v2"
    eox_base_url: str = "https://apix.cisco.com/supporttools/eox/rest/5"


def get_settings() -> Settings:
    return Settings(
        client_id=os.getenv("CLIENT_ID", "").strip(),
        client_secret=os.getenv("CLIENT_SECRET", "").strip(),
        request_timeout=int(os.getenv("REQUEST_TIMEOUT", "30")),
        log_level=os.getenv("LOG_LEVEL", "INFO").upper(),
    )


def configure_logging(level: str) -> None:
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
