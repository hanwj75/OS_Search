from __future__ import annotations

import logging
from collections import defaultdict
from datetime import datetime
from typing import Any

from ..clients.software_suggestion import SoftwareSuggestionClient
from ..errors import RecommendationNotFoundError, UnsupportedProductError
from ..models import ProductSuggestionResult, RecommendedRelease, Suggestion
from ..utils.batching import chunked
from ..utils.os_mapper import map_software_type_to_os_type


LOGGER = logging.getLogger(__name__)


class RecommendationService:
    def __init__(self, client: SoftwareSuggestionClient) -> None:
        self._client = client

    def get_recommendations(
        self,
        product_ids: list[str],
        debug: bool = False,
    ) -> tuple[dict[str, RecommendedRelease], dict[str, str], list[dict[str, Any]]]:
        recommendations: dict[str, RecommendedRelease] = {}
        failures: dict[str, str] = {}
        debug_payloads: list[dict[str, Any]] = []

        for batch in chunked(product_ids, 10):
            results, payloads = self._client.get_suggested_releases(batch, debug=debug)
            debug_payloads.extend(payloads)
            mapped = self._index_by_pid(results)

            for pid in batch:
                result = mapped.get(pid)
                if result is None:
                    failures[pid] = "지원되지 않는 장비 또는 응답 없음"
                    continue

                try:
                    recommendations[pid] = self._select_recommended_release(result)
                except (UnsupportedProductError, RecommendationNotFoundError) as exc:
                    failures[pid] = str(exc)

        return recommendations, failures, debug_payloads

    @staticmethod
    def _index_by_pid(results: list[ProductSuggestionResult]) -> dict[str, ProductSuggestionResult]:
        indexed: dict[str, ProductSuggestionResult] = {}
        grouped: dict[str, list[ProductSuggestionResult]] = defaultdict(list)
        for result in results:
            grouped[result.product.base_pid].append(result)

        for pid, candidates in grouped.items():
            # 동일 PID에 대해 여러 product row가 올 수 있으므로, suggestion 수가 많은 결과를 우선 선택한다.
            indexed[pid] = max(candidates, key=lambda item: len(item.suggestions))
        return indexed

    def _select_recommended_release(self, result: ProductSuggestionResult) -> RecommendedRelease:
        pid = result.product.base_pid
        if not pid:
            raise UnsupportedProductError("지원되지 않는 장비")

        candidates = [item for item in result.suggestions if item.is_suggested == "Y"]
        if not candidates:
            raise RecommendationNotFoundError("추천 OS 없음")

        chosen = max(candidates, key=self._suggestion_sort_key)
        release = (chosen.release_format2 or chosen.release_format1 or "").strip()
        if not release:
            raise RecommendationNotFoundError("추천 OS 파싱 실패")

        software_type = result.product.software_type
        os_type = map_software_type_to_os_type(software_type)
        if software_type and os_type is None:
            LOGGER.info("Unmapped softwareType encountered: %s", software_type)

        return RecommendedRelease(
            pid=pid,
            product_name=result.product.product_name,
            software_type=software_type,
            release=release,
            release_date=self._parse_release_date(chosen.release_date),
            release_label=chosen.release_display_name,
            os_type=os_type,
            raw=result.raw,
        )

    def _suggestion_sort_key(self, suggestion: Suggestion) -> tuple[datetime, str]:
        release_date = self._parse_release_date(suggestion.release_date) or datetime.min
        release_format = suggestion.release_format2 or suggestion.release_format1 or ""
        return release_date, release_format

    @staticmethod
    def _parse_release_date(raw_value: str | None) -> datetime | None:
        if not raw_value:
            return None
        for fmt in ("%d %b %Y", "%d %B %Y"):
            try:
                return datetime.strptime(raw_value.strip(), fmt)
            except ValueError:
                continue
        return None
