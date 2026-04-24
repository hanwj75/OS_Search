from __future__ import annotations

import logging
from typing import Any
from urllib.parse import quote

import requests

from ..auth import CiscoAuthClient
from ..config import Settings
from ..errors import ApiParsingError, ApiTimeoutError, PermissionDeniedError


LOGGER = logging.getLogger(__name__)


class EoxHardwareClient:
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
        return {
            product_id: self._lookup_single("EOXByProductID", product_id, "EoX Product ID API")
            for product_id in product_ids
        }

    def lookup_by_serial_numbers(self, serial_numbers: list[str]) -> dict[str, list[dict[str, Any]]]:
        return {
            serial_number: self._lookup_single("EOXBySerialNumber", serial_number, "EoX Serial Number API")
            for serial_number in serial_numbers
        }

    def _lookup_single(self, method_name: str, input_value: str, api_name: str) -> list[dict[str, Any]]:
        headers = {
            "Authorization": f"Bearer {self._auth_client.get_access_token()}",
            "Accept": "application/json",
        }
        # Cisco 공식 문서:
        # - Get EoX by Product ID(s): /supporttools/eox/rest/5/EOXByProductID/{pageIndex}/{productID}
        # - Get EoX by Serial Number(s): /supporttools/eox/rest/5/EOXBySerialNumber/{pageIndex}/{serialNumber}
        # - responseencoding=json 사용
        url = (
            f"{self._settings.eox_base_url}/{method_name}/1/{quote(input_value, safe=',=*')}"
            "?responseencoding=json"
        )

        try:
            response = self._session.get(
                url,
                headers=headers,
                timeout=self._settings.request_timeout,
            )
        except requests.Timeout as exc:
            raise ApiTimeoutError(f"{api_name} 요청이 시간 초과되었습니다.") from exc
        except requests.RequestException as exc:
            raise ApiParsingError(f"{api_name} 요청 실패: {exc}") from exc

        if response.status_code == 403:
            raise PermissionDeniedError(f"{api_name} 권한이 없습니다.")

        try:
            response.raise_for_status()
            payload = response.json()
        except ValueError as exc:
            raise ApiParsingError(f"{api_name} 응답 JSON 파싱 실패") from exc
        except requests.HTTPError as exc:
            raise ApiParsingError(f"{api_name} HTTP 오류: {response.status_code}") from exc

        LOGGER.info("Fetched %s response for %s", api_name, input_value)
        raw_records = payload.get("EOXRecord", [])
        if not isinstance(raw_records, list):
            raise ApiParsingError(f"{api_name} 응답의 EOXRecord 형식이 올바르지 않습니다.")
        return [self._parse_record(item) for item in raw_records if isinstance(item, dict)]

    @staticmethod
    def _parse_record(item: dict[str, Any]) -> dict[str, Any]:
        migration = item.get("EOXMigrationDetails") if isinstance(item.get("EOXMigrationDetails"), dict) else {}
        error = item.get("EOXError") if isinstance(item.get("EOXError"), dict) else {}
        return {
            "eolProductId": _clean(item.get("EOLProductID")),
            "productDescription": _clean(item.get("ProductIDDescription")),
            "productBulletinNumber": _clean(item.get("ProductBulletinNumber")),
            "bulletinUrl": _clean(item.get("LinkToProductBulletinURL")),
            "lastDateOfSupport": _extract_date(item.get("LastDateOfSupport")),
            "endOfSaleDate": _extract_date(item.get("EndOfSaleDate")),
            "endOfServiceContractRenewal": _extract_date(item.get("EndOfServiceContractRenewal")),
            "updatedTimeStamp": _extract_date(item.get("UpdatedTimeStamp")),
            "migrationProductId": _clean(migration.get("MigrationProductId")),
            "migrationProductName": _clean(migration.get("MigrationProductName")),
            "migrationInformation": _clean(migration.get("MigrationInformation")),
            "migrationStrategy": _clean(migration.get("MigrationStrategy")),
            "migrationProductInfoUrl": _clean(migration.get("MigrationProductInfoURL")),
            "errorId": _clean(error.get("ErrorID")),
            "errorDescription": _clean(error.get("ErrorDescription")),
            "errorDataType": _clean(error.get("ErrorDataType")),
            "errorDataValue": _clean(error.get("ErrorDataValue")),
            "inputValue": _clean(item.get("EOXInputValue")),
            "inputType": _clean(item.get("EOXInputType")),
            "raw": item,
        }


def _extract_date(node: Any) -> str | None:
    if isinstance(node, dict):
        return _clean(node.get("value"))
    return None


def _clean(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    stripped = value.strip()
    return stripped or None
