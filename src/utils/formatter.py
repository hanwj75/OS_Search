from __future__ import annotations

import csv
import json
from pathlib import Path
from typing import Any

from ..models import DeviceLookupRow, SoftwareLookupRow


def _stringify(value: Any) -> str:
    if value is None:
        return "-"
    if isinstance(value, str) and not value.strip():
        return "-"
    return str(value)


def render_table(headers: list[str], rows: list[list[Any]]) -> str:
    widths = [len(header) for header in headers]
    rendered_rows = [[_stringify(cell) for cell in row] for row in rows]
    for row in rendered_rows:
        for index, cell in enumerate(row):
            widths[index] = max(widths[index], len(cell))

    def render_row(row: list[str]) -> str:
        return " | ".join(cell.ljust(widths[index]) for index, cell in enumerate(row))

    separator = "-+-".join("-" * width for width in widths)
    lines = [render_row(headers), separator]
    lines.extend(render_row(row) for row in rendered_rows)
    return "\n".join(lines)


def device_rows_to_table(rows: list[DeviceLookupRow]) -> str:
    headers = ["PID", "Product", "Recommended OS", "OS Type", "LastDateOfSupport", "Status", "Note"]
    values = [
        [
            row.pid,
            row.product_name,
            row.recommended_release,
            row.os_type,
            row.last_date_of_support,
            row.status,
            row.note,
        ]
        for row in rows
    ]
    return render_table(headers, values)


def software_rows_to_table(rows: list[SoftwareLookupRow]) -> str:
    headers = ["Release", "OS Type", "LastDateOfSupport", "Matched PID", "Description", "Status", "Note"]
    values = [
        [
            row.release,
            row.os_type,
            row.last_date_of_support,
            row.matched_product_id,
            row.matched_product_description,
            row.status,
            row.note,
        ]
        for row in rows
    ]
    return render_table(headers, values)


def software_rows_to_summary(rows: list[SoftwareLookupRow]) -> str:
    summary_parts: list[str] = []
    for row in rows:
        if row.status in {"SUCCESS_WITH_DATES", "PARTIAL_RECORD"} and row.last_date_of_support:
            summary_parts.append(f"{row.release}:{row.last_date_of_support}")
            continue
        if row.note:
            summary_parts.append(row.note)
            continue
        summary_parts.append(f"{row.release}:조회 실패")
    summary = ", ".join(summary_parts)
    return f"결과: {summary}"


def write_csv(path: str, headers: list[str], rows: list[list[Any]]) -> None:
    target = Path(path)
    with target.open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.writer(handle)
        writer.writerow(headers)
        writer.writerows(rows)


def dump_debug_payload(payload: Any) -> str:
    return json.dumps(payload, ensure_ascii=False, indent=2)
