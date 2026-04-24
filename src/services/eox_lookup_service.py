from __future__ import annotations

from collections import defaultdict
from typing import Any

from ..clients.eox import EoxClient
from ..models import (
    EoxErrorDetail,
    EoxRecord,
    INVALID_OS_TYPE,
    NO_SOFTWARE_MATCH,
    PARTIAL_RECORD,
    PRODUCT_BULLETIN_NO_EOX,
    PRODUCT_ID_NO_EOX,
    SUCCESS_WITH_DATES,
    UNKNOWN_ERROR,
)


class EoxLookupService:
    def __init__(self, client: EoxClient) -> None:
        self._client = client

    def lookup_software_releases(
        self,
        releases: list[str],
        explicit_os_types: dict[str, str | None] | None = None,
        debug: bool = False,
    ) -> tuple[dict[str, EoxRecord], dict[str, str], list[dict[str, Any]]]:
        explicit_os_types = explicit_os_types or {}
        failures: dict[str, str] = {}
        debug_payloads: list[dict[str, Any]] = []
        resolved: dict[str, EoxRecord] = {}

        for release in releases:
            os_type = explicit_os_types.get(release)
            resolved_record, _, payloads = self.lookup_release_details(
                release=release,
                os_type=os_type,
                debug=debug,
            )
            debug_payloads.extend(payloads)
            resolved[release] = resolved_record
            if resolved_record.status != SUCCESS_WITH_DATES:
                failures[release] = resolved_record.user_message or "조회 실패"

        return resolved, failures, debug_payloads

    def lookup_release_details(
        self,
        release: str,
        os_type: str | None = None,
        debug: bool = False,
    ) -> tuple[EoxRecord, list[EoxRecord], list[dict[str, Any]]]:
        records, payloads = self._client.lookup_by_software_releases(
            [(release, os_type)],
            debug=debug,
        )

        normalized_release = self._client.normalize_release_string(release)
        release_records = [
            record for record in records if record.normalized_release == normalized_release
        ]

        if os_type:
            filtered_records = [record for record in release_records if record.os_type == os_type]
            if filtered_records:
                release_records = filtered_records

        resolved_record = self._resolve_release_record(
            release=release,
            os_type=os_type,
            records=release_records,
        )
        return resolved_record, release_records, payloads

    def _resolve_release_record(
        self,
        release: str,
        os_type: str | None,
        records: list[EoxRecord],
    ) -> EoxRecord:
        if not records:
            return self._build_error_record(
                release=release,
                os_type=os_type,
                status=UNKNOWN_ERROR,
                user_message=self._format_unknown_message(release, os_type),
            )

        lifecycle_records = [record for record in records if record.has_any_lifecycle_date()]
        if lifecycle_records:
            return self._select_lifecycle_record(release, os_type, lifecycle_records)

        error_record = next((record for record in records if record.error), None)
        if error_record is not None:
            return self._classify_error_record(release, os_type, error_record)

        representative = records[0]
        representative.status = PARTIAL_RECORD
        representative.user_message = self._format_partial_message(release, os_type)
        return representative

    def _select_lifecycle_record(
        self,
        release: str,
        os_type: str | None,
        records: list[EoxRecord],
    ) -> EoxRecord:
        by_date: dict[str, list[EoxRecord]] = defaultdict(list)
        undated_records: list[EoxRecord] = []
        for record in records:
            if record.last_date_of_support:
                by_date[record.last_date_of_support].append(record)
            else:
                undated_records.append(record)

        if by_date:
            dominant_date, dominant_records = max(
                by_date.items(),
                key=lambda item: (len(item[1]), item[0]),
            )
            representative = dominant_records[0]
            representative.last_date_of_support = dominant_date
            representative.match_count = len(records)
            representative.status = (
                SUCCESS_WITH_DATES if representative.has_all_lifecycle_dates() else PARTIAL_RECORD
            )
            representative.user_message = (
                f"{release}{self._format_os_type_suffix(os_type)}: {dominant_date}"
                if representative.status == SUCCESS_WITH_DATES
                else self._format_partial_message(release, os_type)
            )
            if len(records) > 1:
                representative.selection_note = (
                    f"{len(records)}건 중 {len(dominant_records)}건이 LastDateOfSupport {dominant_date}"
                )
            return representative

        representative = undated_records[0]
        representative.status = PARTIAL_RECORD
        representative.user_message = self._format_partial_message(release, os_type)
        representative.match_count = len(records)
        return representative

    def _classify_error_record(
        self,
        release: str,
        os_type: str | None,
        record: EoxRecord,
    ) -> EoxRecord:
        error = record.error
        if error is None:
            record.status = UNKNOWN_ERROR
            record.user_message = self._format_unknown_message(release, os_type)
            return record

        if error.error_id == "SSA_ERR_010":
            record.status = INVALID_OS_TYPE
            record.user_message = (
                f"{release}{self._format_os_type_suffix(os_type)}: "
                f"Cisco EoX API가 OSType 값을 유효하지 않은 값으로 해석함 ({error.error_id})"
            )
        elif error.error_id == "SSA_ERR_024":
            record.status = NO_SOFTWARE_MATCH
            record.user_message = (
                f"{release}{self._format_os_type_suffix(os_type)}: "
                f"Cisco EoX API에서 software release에 대한 EoX 정보를 찾지 못함 ({error.error_id})"
            )
        elif error.error_id == "SSA_ERR_026":
            record.status = PRODUCT_ID_NO_EOX
            record.user_message = (
                f"{release}{self._format_os_type_suffix(os_type)}: "
                f"Cisco EoX API에서 software release가 product ID로 매핑되었지만, "
                f"해당 product ID에 대한 EoX lifecycle 데이터가 존재하지 않음 ({error.error_id})"
            )
        elif error.error_id == "SSA_ERR_022":
            record.status = PRODUCT_BULLETIN_NO_EOX
            record.user_message = (
                f"{release}{self._format_os_type_suffix(os_type)}: "
                f"Cisco EoX API에서 software release가 product bulletin으로 매핑되었지만, "
                f"해당 bulletin에 대한 EoX lifecycle 데이터가 존재하지 않음 ({error.error_id})"
            )
        else:
            record.status = UNKNOWN_ERROR
            record.user_message = (
                f"{release}{self._format_os_type_suffix(os_type)}: "
                f"Cisco EoX API가 해석 가능한 lifecycle 데이터를 주지 않았음"
                f"{f' ({error.error_id})' if error.error_id else ''}"
            )
        return record

    def _build_error_record(
        self,
        release: str,
        os_type: str | None,
        status: str,
        user_message: str,
        error: EoxErrorDetail | None = None,
    ) -> EoxRecord:
        return EoxRecord(
            query_key=release,
            input_value=release,
            normalized_release=self._client.normalize_release_string(release),
            os_type=os_type,
            eox_input_type="ShowEOXBySoftware",
            eol_product_id=None,
            product_description=None,
            eox_external_announcement_date=None,
            end_of_sale_date=None,
            last_date_of_support=None,
            end_of_sw_maintenance=None,
            end_of_security_support=None,
            end_of_routine_failure_analysis=None,
            end_of_service_contract_renewal=None,
            end_of_service_attach=None,
            bulletin_url=None,
            product_bulletin_number=None,
            status=status,
            user_message=user_message,
            error=error,
        )

    @staticmethod
    def _format_os_type_suffix(os_type: str | None) -> str:
        return f" ({os_type})" if os_type else ""

    def _format_partial_message(self, release: str, os_type: str | None) -> str:
        return (
            f"{release}{self._format_os_type_suffix(os_type)}: "
            "Cisco EoX API가 일부 lifecycle 필드만 반환함"
        )

    def _format_unknown_message(self, release: str, os_type: str | None) -> str:
        return (
            f"{release}{self._format_os_type_suffix(os_type)}: "
            "Cisco EoX API 응답을 해석할 수 없거나 매칭된 EOXRecord가 없음"
        )
