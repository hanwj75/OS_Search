from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Any

import requests

from .config import Settings
from .errors import ApiParsingError, ApiTimeoutError, AuthError, PermissionDeniedError


LOGGER = logging.getLogger(__name__)


@dataclass(slots=True)
class TokenCache:
    access_token: str | None = None
    expires_at: float = 0.0

    def is_valid(self) -> bool:
        return bool(self.access_token) and time.time() < self.expires_at


class CiscoAuthClient:
    def __init__(self, settings: Settings, session: requests.Session | None = None) -> None:
        self._settings = settings
        self._session = session or requests.Session()
        self._cache = TokenCache()

    def get_access_token(self) -> str:
        if self._cache.is_valid():
            return self._cache.access_token or ""
        return self._refresh_token()

    def _refresh_token(self) -> str:
        if not self._settings.client_id or not self._settings.client_secret:
            raise AuthError("CLIENT_ID 또는 CLIENT_SECRET 이 설정되지 않았습니다.")

        payload = {
            "grant_type": "client_credentials",
            "client_id": self._settings.client_id,
            "client_secret": self._settings.client_secret,
        }

        try:
            # Cisco 공식 문서:
            # POST https://id.cisco.com/oauth2/default/v1/token
            # Content-Type: application/x-www-form-urlencoded
            response = self._session.post(
                self._settings.auth_url,
                data=payload,
                timeout=self._settings.request_timeout,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
        except requests.Timeout as exc:
            raise ApiTimeoutError("토큰 발급 요청이 시간 초과되었습니다.") from exc
        except requests.RequestException as exc:
            raise AuthError(f"토큰 발급 요청 실패: {exc}") from exc

        if response.status_code in (401, 400):
            raise AuthError("인증 실패: CLIENT_ID/CLIENT_SECRET 또는 앱 권한을 확인하세요.")
        if response.status_code == 403:
            raise PermissionDeniedError("권한 없음: Cisco Support API 접근 권한을 확인하세요.")

        try:
            response.raise_for_status()
            payload_json: dict[str, Any] = response.json()
        except ValueError as exc:
            raise ApiParsingError("토큰 응답 JSON 파싱 실패") from exc
        except requests.HTTPError as exc:
            raise AuthError(f"토큰 발급 HTTP 오류: {response.status_code}") from exc

        token = payload_json.get("access_token")
        expires_in = int(payload_json.get("expires_in", 3600))
        if not token:
            raise ApiParsingError("토큰 응답에 access_token 필드가 없습니다.")

        # 만료 직전 재사용을 피하기 위해 60초 여유를 둔다.
        self._cache.access_token = token
        self._cache.expires_at = time.time() + max(expires_in - 60, 0)
        LOGGER.info("Cisco access token refreshed")
        return token
