from __future__ import annotations

from ..errors import InputValidationError


def parse_hardware_input(raw: str, max_items: int = 20) -> list[str]:
    if not raw or not raw.strip():
        raise InputValidationError("입력값이 비어 있습니다.")

    values = [item.strip() for item in raw.replace("\r", "\n").replace(",", "\n").split("\n")]
    cleaned = [item for item in values if item]
    if not cleaned:
        raise InputValidationError("유효한 입력이 없습니다.")

    deduplicated = list(dict.fromkeys(cleaned))
    if len(deduplicated) > max_items:
        raise InputValidationError(f"입력값은 최대 {max_items}개까지 조회할 수 있습니다.")
    return deduplicated

