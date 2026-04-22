from __future__ import annotations

from ..errors import InputValidationError


def parse_csv_input(raw: str) -> list[str]:
    if not raw or not raw.strip():
        raise InputValidationError("입력값이 비어 있습니다.")

    values = [item.strip() for item in raw.split(",")]
    cleaned = [item for item in values if item]
    if not cleaned:
        raise InputValidationError("유효한 입력이 없습니다.")

    # 입력 순서는 유지하면서 중복 제거.
    return list(dict.fromkeys(cleaned))
