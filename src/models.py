from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any


SUCCESS_WITH_DATES = "SUCCESS_WITH_DATES"
PARTIAL_RECORD = "PARTIAL_RECORD"
INVALID_OS_TYPE = "INVALID_OS_TYPE"
NO_SOFTWARE_MATCH = "NO_SOFTWARE_MATCH"
PRODUCT_ID_NO_EOX = "PRODUCT_ID_NO_EOX"
PRODUCT_BULLETIN_NO_EOX = "PRODUCT_BULLETIN_NO_EOX"
UNKNOWN_ERROR = "UNKNOWN_ERROR"


@dataclass(slots=True)
class Suggestion:
    is_suggested: str
    release_format1: str | None
    release_format2: str | None
    release_date: str | None
    release_display_name: str | None
    train_display_name: str | None
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class ProductInfo:
    base_pid: str
    product_name: str | None
    software_type: str | None


@dataclass(slots=True)
class ProductSuggestionResult:
    product: ProductInfo
    suggestions: list[Suggestion]
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class RecommendedRelease:
    pid: str
    product_name: str | None
    software_type: str | None
    release: str
    release_date: datetime | None
    release_label: str | None
    os_type: str | None
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class EoxErrorDetail:
    error_id: str | None
    error_description: str | None
    error_data_type: str | None
    error_data_value: str | None


@dataclass(slots=True)
class EoxRecord:
    query_key: str
    input_value: str | None
    normalized_release: str
    os_type: str | None
    eox_input_type: str | None
    eol_product_id: str | None
    product_description: str | None
    eox_external_announcement_date: str | None
    end_of_sale_date: str | None
    last_date_of_support: str | None
    end_of_sw_maintenance: str | None
    end_of_security_support: str | None
    end_of_routine_failure_analysis: str | None
    end_of_service_contract_renewal: str | None
    end_of_service_attach: str | None
    bulletin_url: str | None
    product_bulletin_number: str | None
    match_count: int = 1
    selection_note: str | None = None
    status: str = UNKNOWN_ERROR
    user_message: str | None = None
    error: EoxErrorDetail | None = None
    raw: dict[str, Any] = field(default_factory=dict)

    def lifecycle_dates(self) -> list[str | None]:
        return [
            self.eox_external_announcement_date,
            self.end_of_sale_date,
            self.end_of_sw_maintenance,
            self.end_of_security_support,
            self.end_of_routine_failure_analysis,
            self.end_of_service_contract_renewal,
            self.last_date_of_support,
            self.end_of_service_attach,
        ]

    def has_any_lifecycle_date(self) -> bool:
        return any(value for value in self.lifecycle_dates())

    def has_all_lifecycle_dates(self) -> bool:
        return all(value for value in self.lifecycle_dates())


@dataclass(slots=True)
class DeviceLookupRow:
    pid: str
    product_name: str | None
    recommended_release: str | None
    os_type: str | None
    last_date_of_support: str | None
    status: str
    note: str | None = None


@dataclass(slots=True)
class SoftwareLookupRow:
    release: str
    os_type: str | None
    last_date_of_support: str | None
    matched_product_id: str | None
    matched_product_description: str | None
    status: str
    note: str | None = None
    error_id: str | None = None
    error_description: str | None = None
    error_data_type: str | None = None
    error_data_value: str | None = None
    product_bulletin_number: str | None = None
    eox_input_value: str | None = None
