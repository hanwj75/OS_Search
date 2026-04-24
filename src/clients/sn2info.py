from __future__ import annotations

from typing import Any

import requests

from ..auth import CiscoAuthClient
from ..config import Settings
from ..errors import ApiParsingError, ApiTimeoutError, PermissionDeniedError
from ..utils.batching import chunked


class SerialNumberToInformationClient:
    def __init__(
        self,
        settings: Settings,
        auth_client: CiscoAuthClient,
        session: requests.Session | None = None,
    ) -> None:
        self._settings = settings
        self._auth_client = auth_client
        self._session = session or requests.Session()

    def lookup_coverage_status(self, serial_numbers: list[str]) -> dict[str, dict[str, Any]]:
        return self._lookup_serial_payloads("coverage/status", serial_numbers)

    def lookup_owner_coverage_status(self, serial_numbers: list[str]) -> dict[str, dict[str, Any]]:
        return self._lookup_serial_payloads("coverage/owner_status", serial_numbers)

    def _lookup_serial_payloads(self, path: str, serial_numbers: list[str]) -> dict[str, dict[str, Any]]:
        results: dict[str, dict[str, Any]] = {}
        for batch in chunked(serial_numbers, 75):
            payload = self._get(
                f"{self._settings.serial_number_to_information_base_url}/{path}/serial_numbers/{','.join(batch)}"
            )
            for item in payload.get("serial_numbers", []) or []:
                serial_number = str(item.get("sr_no", "")).strip()
                if serial_number:
                    results[serial_number] = item
        return results

    def _get(self, url: str) -> dict[str, Any]:
        try:
            response = self._session.get(
                url,
                timeout=self._settings.request_timeout,
                headers={
                    "Authorization": f"Bearer {self._auth_client.get_access_token()}",
                    "Accept": "application/json",
                },
            )
        except requests.Timeout as exc:
            raise ApiTimeoutError("Serial Number to Information API 요청이 시간 초과되었습니다.") from exc
        except requests.RequestException as exc:
            raise ApiParsingError(f"Serial Number to Information API 요청 실패: {exc}") from exc

        if response.status_code == 403:
            raise PermissionDeniedError("Serial Number to Information API 권한이 없습니다.")

        try:
            response.raise_for_status()
            return response.json()
        except ValueError as exc:
            raise ApiParsingError("Serial Number to Information API 응답 JSON 파싱 실패") from exc
        except requests.HTTPError as exc:
            raise ApiParsingError(
                f"Serial Number to Information API HTTP 오류: {response.status_code}"
            ) from exc

