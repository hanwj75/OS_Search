from __future__ import annotations

import logging
from typing import Any

import requests

from ..auth import CiscoAuthClient
from ..config import Settings
from ..errors import ApiParsingError, ApiTimeoutError, PermissionDeniedError
from ..models import ProductInfo, ProductSuggestionResult, Suggestion


LOGGER = logging.getLogger(__name__)


class SoftwareSuggestionClient:
    def __init__(
        self,
        settings: Settings,
        auth_client: CiscoAuthClient,
        session: requests.Session | None = None,
    ) -> None:
        self._settings = settings
        self._auth_client = auth_client
        self._session = session or requests.Session()

    def get_suggested_releases(self, product_ids: list[str], debug: bool = False) -> tuple[list[ProductSuggestionResult], list[dict[str, Any]]]:
        if not product_ids:
            return [], []

        path = ",".join(product_ids)
        url = f"{self._settings.software_suggestion_base_url}/suggestions/releases/productIds/{path}"
        headers = {
            "Authorization": f"Bearer {self._auth_client.get_access_token()}",
            "Accept": "application/json",
        }
        params = {"pageIndex": 1}

        try:
            # Cisco 공식 문서:
            # GET /software/suggestion/v2/suggestions/releases/productIds/{productIds}?pageIndex=1
            # productIds 최대 10개
            response = self._session.get(
                url,
                headers=headers,
                params=params,
                timeout=self._settings.request_timeout,
            )
        except requests.Timeout as exc:
            raise ApiTimeoutError("Software Suggestion API 요청이 시간 초과되었습니다.") from exc
        except requests.RequestException as exc:
            raise ApiParsingError(f"Software Suggestion API 요청 실패: {exc}") from exc

        if response.status_code == 403:
            raise PermissionDeniedError("Software Suggestion API 권한이 없습니다.")

        try:
            response.raise_for_status()
            payload = response.json()
        except ValueError as exc:
            raise ApiParsingError("Software Suggestion API 응답 JSON 파싱 실패") from exc
        except requests.HTTPError as exc:
            raise ApiParsingError(f"Software Suggestion API HTTP 오류: {response.status_code}") from exc

        LOGGER.info("Fetched suggested releases for %s product IDs", len(product_ids))
        results = self._parse_payload(payload)
        debug_payloads = [payload] if debug else []
        return results, debug_payloads

    def _parse_payload(self, payload: dict[str, Any]) -> list[ProductSuggestionResult]:
        product_list = payload.get("productList", [])
        if not isinstance(product_list, list):
            raise ApiParsingError("Software Suggestion API 응답의 productList 형식이 올바르지 않습니다.")

        results: list[ProductSuggestionResult] = []
        for item in product_list:
            product = item.get("product", {})
            suggestions_raw = item.get("suggestions", [])
            suggestions = [
                Suggestion(
                    is_suggested=str(suggestion.get("isSuggested", "")).strip(),
                    release_format1=suggestion.get("releaseFormat1"),
                    release_format2=suggestion.get("releaseFormat2"),
                    release_date=suggestion.get("releaseDate"),
                    release_display_name=suggestion.get("relDispName"),
                    train_display_name=suggestion.get("trainDispName"),
                    raw=suggestion,
                )
                for suggestion in suggestions_raw
            ]
            results.append(
                ProductSuggestionResult(
                    product=ProductInfo(
                        base_pid=str(product.get("basePID", "")).strip(),
                        product_name=product.get("productName"),
                        software_type=product.get("softwareType"),
                    ),
                    suggestions=suggestions,
                    raw=item,
                )
            )
        return results
