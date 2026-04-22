from __future__ import annotations

import logging
import re
from typing import Any
from urllib.parse import unquote_plus

import requests

from ..auth import CiscoAuthClient
from ..config import Settings
from ..errors import ApiParsingError, ApiTimeoutError, EoxNotFoundError, PermissionDeniedError
from ..models import EoxErrorDetail, EoxRecord


LOGGER = logging.getLogger(__name__)


class EoxClient:
    def __init__(
        self,
        settings: Settings,
        auth_client: CiscoAuthClient,
        session: requests.Session | None = None,
    ) -> None:
        self._settings = settings
        self._auth_client = auth_client
        self._session = session or requests.Session()

    def lookup_by_software_releases(
        self,
        release_queries: list[tuple[str, str | None]],
        debug: bool = False,
    ) -> tuple[list[EoxRecord], list[dict[str, Any]]]:
        if not release_queries:
            return [], []

        headers = {
            "Authorization": f"Bearer {self._auth_client.get_access_token()}",
            "Accept": "application/json",
        }
        params: list[tuple[str, str]] = [("responseencoding", "json")]
        for index, (release, os_type) in enumerate(release_queries, start=1):
            key = f"input{index}"
            value = f"{release},{os_type}" if os_type else release
            params.append((key, value))

        try:
            # Cisco 공식 문서:
            # GET /supporttools/eox/rest/5/EOXBySWReleaseString/{pageIndex}
            # query string 에 input1..input20=<release>,<OSType?> 조합 전달
            # TODO: 문서 예시가 단일 input1 위주라서, 멀티 input 응답 형태는 실 API로 재검증 필요.
            response = self._session.get(
                f"{self._settings.eox_base_url}/EOXBySWReleaseString/1",
                headers=headers,
                params=params,
                timeout=self._settings.request_timeout,
            )
        except requests.Timeout as exc:
            raise ApiTimeoutError("EoX API 요청이 시간 초과되었습니다.") from exc
        except requests.RequestException as exc:
            raise ApiParsingError(f"EoX API 요청 실패: {exc}") from exc

        if response.status_code == 403:
            raise PermissionDeniedError("EoX API 권한이 없습니다.")

        try:
            response.raise_for_status()
            payload = response.json()
        except ValueError as exc:
            raise ApiParsingError("EoX API 응답 JSON 파싱 실패") from exc
        except requests.HTTPError as exc:
            raise ApiParsingError(f"EoX API HTTP 오류: {response.status_code}") from exc

        LOGGER.info("Fetched EoX data for %s software release queries", len(release_queries))
        records = self._parse_payload(payload)
        if not records and payload.get("EOXError"):
            raise EoxNotFoundError(str(payload["EOXError"]))
        return records, [payload] if debug else []

    def _parse_payload(self, payload: dict[str, Any]) -> list[EoxRecord]:
        raw_records = payload.get("EOXRecord", [])
        if raw_records is None:
            return []
        if not isinstance(raw_records, list):
            raise ApiParsingError("EoX API 응답의 EOXRecord 형식이 올바르지 않습니다.")

        records: list[EoxRecord] = []
        for item in raw_records:
            input_value = item.get("EOXInputValue")
            query_key, normalized_release, os_type = self._extract_query_metadata(input_value)
            records.append(
                EoxRecord(
                    query_key=query_key,
                    input_value=input_value,
                    normalized_release=normalized_release,
                    os_type=os_type,
                    eox_input_type=item.get("EOXInputType"),
                    eol_product_id=item.get("EOLProductID"),
                    product_description=item.get("ProductIDDescription"),
                    eox_external_announcement_date=self._extract_date(item.get("EOXExternalAnnouncementDate")),
                    end_of_sale_date=self._extract_date(item.get("EndOfSaleDate")),
                    last_date_of_support=self._extract_date(item.get("LastDateOfSupport")),
                    end_of_sw_maintenance=self._extract_date(item.get("EndOfSWMaintenanceReleases")),
                    end_of_security_support=self._extract_date(item.get("EndOfSecurityVulSupportDate")),
                    end_of_routine_failure_analysis=self._extract_date(item.get("EndOfRoutineFailureAnalysisDate")),
                    end_of_service_contract_renewal=self._extract_date(item.get("EndOfServiceContractRenewal")),
                    end_of_service_attach=self._extract_date(item.get("EndOfSvcAttachDate")),
                    bulletin_url=item.get("LinkToProductBulletinURL") or item.get("LinkToProductBullet-let-inURL"),
                    product_bulletin_number=item.get("ProductBulletinNumber"),
                    error=self._extract_error(item.get("EOXError")),
                    raw=item,
                )
            )
        return records

    @staticmethod
    def _extract_date(node: Any) -> str | None:
        if isinstance(node, dict):
            value = node.get("value")
            return value.strip() if isinstance(value, str) and value.strip() else None
        return None

    @staticmethod
    def _extract_error(node: Any) -> EoxErrorDetail | None:
        if not isinstance(node, dict):
            return None
        return EoxErrorDetail(
            error_id=node.get("ErrorID"),
            error_description=node.get("ErrorDescription"),
            error_data_type=node.get("ErrorDataType"),
            error_data_value=node.get("ErrorDataValue"),
        )

    @staticmethod
    def _extract_query_metadata(input_value: str | None) -> tuple[str, str, str | None]:
        if not input_value:
            return "", "", None
        # 예:
        # - input1=12.4%2815%29T,IOS
        # - input3=10.3(6),null,input2=17.11(1a),null,input1=17.9(5),null
        # Cisco EoX 응답은 다중 입력일 때 현재 record와 무관한 다른 inputN 조합을
        # 같은 문자열에 이어 붙여 반환할 수 있으므로, 첫 inputN 값만 잘라서 사용한다.
        decoded = unquote_plus(input_value).strip()
        match = re.search(r"input\d+=(.*?)(?=,input\d+=|$)", decoded)
        if match:
            query_key = match.group(1).strip()
        else:
            _, _, raw_value = decoded.partition("=")
            query_key = raw_value.strip() if raw_value else decoded
        release_part, os_type = EoxClient._split_release_and_os_type(query_key)
        normalized_release = EoxClient.normalize_release_string(release_part)
        return query_key, normalized_release, os_type

    @staticmethod
    def _split_release_and_os_type(query_key: str) -> tuple[str, str | None]:
        if "," not in query_key:
            return query_key.strip(), None
        release_part, _, os_type = query_key.partition(",")
        normalized_os = os_type.strip() or None
        if normalized_os and normalized_os.lower() == "null":
            normalized_os = None
        return release_part.strip(), normalized_os

    @staticmethod
    def normalize_release_string(release: str) -> str:
        normalized = release.strip().upper()
        normalized = re.sub(r"\s+", "", normalized)
        normalized = normalized.replace("(", ".").replace(")", "")
        normalized = re.sub(r"\.+", ".", normalized)
        return normalized.strip(".")
