from __future__ import annotations

from collections import defaultdict
from typing import Any

import requests

from ..auth import CiscoAuthClient
from ..config import Settings
from ..errors import ApiParsingError, ApiTimeoutError, PermissionDeniedError
from ..utils.batching import chunked


class ProductInformationClient:
    def __init__(
        self,
        settings: Settings,
        auth_client: CiscoAuthClient,
        session: requests.Session | None = None,
    ) -> None:
        self._settings = settings
        self._auth_client = auth_client
        self._session = session or requests.Session()

    def lookup_by_product_ids(self, product_ids: list[str]) -> dict[str, list[dict[str, Any]]]:
        results: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for batch in chunked(product_ids, 5):
            payload = self._get(
                f"{self._settings.product_information_base_url}/product_ids/{','.join(batch)}",
                params={"page_index": 1},
            )
            for item in payload.get("product_list", []) or []:
                product_id = str(item.get("product_id", "")).strip()
                if product_id:
                    results[product_id].append(item)
        return results

    def lookup_by_serial_numbers(self, serial_numbers: list[str]) -> dict[str, list[dict[str, Any]]]:
        results: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for batch in chunked(serial_numbers, 5):
            payload = self._get(
                f"{self._settings.product_information_base_url}/serial_numbers/{','.join(batch)}",
                params={"page_index": 1},
            )
            for item in payload.get("product_list", []) or []:
                serial_number = str(item.get("sr_no", "")).strip()
                if serial_number:
                    results[serial_number].append(item)
        return results

    def _get(self, url: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        try:
            response = self._session.get(
                url,
                params=params,
                timeout=self._settings.request_timeout,
                headers={
                    "Authorization": f"Bearer {self._auth_client.get_access_token()}",
                    "Accept": "application/json",
                },
            )
        except requests.Timeout as exc:
            raise ApiTimeoutError("Product Information API 요청이 시간 초과되었습니다.") from exc
        except requests.RequestException as exc:
            raise ApiParsingError(f"Product Information API 요청 실패: {exc}") from exc

        if response.status_code == 403:
            raise PermissionDeniedError("Product Information API 권한이 없습니다.")

        try:
            response.raise_for_status()
            return response.json()
        except ValueError as exc:
            raise ApiParsingError("Product Information API 응답 JSON 파싱 실패") from exc
        except requests.HTTPError as exc:
            raise ApiParsingError(f"Product Information API HTTP 오류: {response.status_code}") from exc

