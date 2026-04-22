from __future__ import annotations

import argparse
import logging
import sys
from typing import Any

import requests

from .auth import CiscoAuthClient
from .clients.eox import EoxClient
from .clients.software_suggestion import SoftwareSuggestionClient
from .config import configure_logging, get_settings
from .errors import AppError
from .models import DeviceLookupRow, SoftwareLookupRow
from .services.eox_lookup_service import EoxLookupService
from .services.recommendation_service import RecommendationService
from .utils.formatter import (
    device_rows_to_table,
    dump_debug_payload,
    software_rows_to_summary,
    software_rows_to_table,
    write_csv,
)
from .utils.parser import parse_csv_input


LOGGER = logging.getLogger(__name__)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Cisco Support API based OS/EoX lookup CLI")
    subparsers = parser.add_subparsers(dest="command", required=True)

    pid_parser = subparsers.add_parser("pid", help="PID 기준 권장 OS 및 EoX 조회")
    pid_parser.add_argument("values", help="쉼표 구분 PID 목록")
    pid_parser.add_argument("--csv", dest="csv_path", help="CSV 저장 경로")
    pid_parser.add_argument("--debug", action="store_true", help="API 원문 응답 출력")

    os_parser = subparsers.add_parser("os", help="OS 버전 기준 product 기반 EoX 조회")
    os_parser.add_argument("values", help="쉼표 구분 OS 버전 목록")
    os_parser.add_argument(
        "--os-type",
        dest="os_type",
        help="선택 사항: 모든 입력 release에 공통 적용할 Cisco OSType (예: IOS-XE, NX-OS, IOS)",
    )
    os_parser.add_argument("--csv", dest="csv_path", help="CSV 저장 경로")
    os_parser.add_argument("--debug", action="store_true", help="API 원문 응답 출력")

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    settings = get_settings()
    configure_logging(settings.log_level)

    session = requests.Session()
    auth_client = CiscoAuthClient(settings, session=session)
    recommendation_service = RecommendationService(
        SoftwareSuggestionClient(settings, auth_client, session=session)
    )
    eox_service = EoxLookupService(EoxClient(settings, auth_client, session=session))

    try:
        if args.command == "pid":
            return _run_pid_lookup(args, recommendation_service, eox_service)
        if args.command == "os":
            return _run_os_lookup(args, eox_service)
    except AppError as exc:
        LOGGER.error(str(exc))
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    parser.print_help()
    return 1


def _run_pid_lookup(
    args: argparse.Namespace,
    recommendation_service: RecommendationService,
    eox_service: EoxLookupService,
) -> int:
    product_ids = parse_csv_input(args.values)
    recommendations, recommendation_failures, recommendation_debug = recommendation_service.get_recommendations(
        product_ids,
        debug=args.debug,
    )

    releases = [item.release for item in recommendations.values()]
    os_types = {item.release: item.os_type for item in recommendations.values()}
    eox_records, eox_failures, eox_debug = eox_service.lookup_software_releases(
        releases,
        explicit_os_types=os_types,
        debug=args.debug,
    )

    rows: list[DeviceLookupRow] = []
    for pid in product_ids:
        recommendation = recommendations.get(pid)
        if recommendation is None:
            rows.append(
                DeviceLookupRow(
                    pid=pid,
                    product_name=None,
                    recommended_release=None,
                    os_type=None,
                    last_date_of_support=None,
                    status="ERROR",
                    note=recommendation_failures.get(pid, "조회 실패"),
                )
            )
            continue

        eox_record = eox_records.get(recommendation.release)
        if eox_record is None or eox_record.status not in {"SUCCESS_WITH_DATES", "PARTIAL_RECORD"}:
            rows.append(
                DeviceLookupRow(
                    pid=pid,
                    product_name=recommendation.product_name,
                    recommended_release=recommendation.release,
                    os_type=recommendation.os_type,
                    last_date_of_support=None,
                    status="ERROR",
                    note=(eox_record.user_message if eox_record else None)
                    or eox_failures.get(recommendation.release, "EoX 조회 실패"),
                )
            )
            continue

        rows.append(
            DeviceLookupRow(
                pid=pid,
                product_name=recommendation.product_name,
                recommended_release=recommendation.release,
                os_type=recommendation.os_type,
                last_date_of_support=eox_record.last_date_of_support,
                status="OK",
            )
        )

    print(device_rows_to_table(rows))
    if args.csv_path:
        write_csv(
            args.csv_path,
            ["PID", "Product", "Recommended OS", "OS Type", "LastDateOfSupport", "Status", "Note"],
            [
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
            ],
        )
        LOGGER.info("CSV saved: %s", args.csv_path)

    _print_debug_if_needed(args.debug, recommendation_debug + eox_debug)
    return 0


def _run_os_lookup(args: argparse.Namespace, eox_service: EoxLookupService) -> int:
    releases = parse_csv_input(args.values)
    explicit_os_types = {release: args.os_type for release in releases} if args.os_type else None
    records, failures, debug_payloads = eox_service.lookup_software_releases(
        releases,
        explicit_os_types=explicit_os_types,
        debug=args.debug,
    )

    rows: list[SoftwareLookupRow] = []
    for release in releases:
        record = records.get(release)
        if record is None:
            rows.append(
                SoftwareLookupRow(
                    release=release,
                    os_type=None,
                    last_date_of_support=None,
                    matched_product_id=None,
                    matched_product_description=None,
                    status="ERROR",
                    note=failures.get(release, "조회 실패"),
                )
            )
            continue

        os_type = None
        if "," in record.query_key:
            _, _, os_type = record.query_key.partition(",")

        rows.append(
            SoftwareLookupRow(
                release=release,
                os_type=record.os_type or os_type or None,
                last_date_of_support=record.last_date_of_support,
                matched_product_id=record.eol_product_id,
                matched_product_description=record.product_description,
                status=record.status,
                note=record.user_message or record.selection_note,
                error_id=record.error.error_id if record.error else None,
                error_description=record.error.error_description if record.error else None,
                error_data_type=record.error.error_data_type if record.error else None,
                error_data_value=record.error.error_data_value if record.error else None,
                product_bulletin_number=record.product_bulletin_number,
                eox_input_value=record.input_value,
            )
        )

    print(f"os검색 (product 기반 EoX 조회) : {','.join(releases)}")
    print(software_rows_to_summary(rows))
    if args.debug:
        print("\n[DEBUG OS SUMMARY TABLE]")
        print(software_rows_to_table(rows))
        print("\n[DEBUG EOX DETAILS]")
        for row in rows:
            print(f"Release: {row.release}")
            print(f"Status: {row.status}")
            print(f"ErrorID: {row.error_id or '-'}")
            print(f"ErrorDescription: {row.error_description or '-'}")
            print(f"ErrorDataType: {row.error_data_type or '-'}")
            print(f"ErrorDataValue: {row.error_data_value or '-'}")
            print(f"ProductBulletinNumber: {row.product_bulletin_number or '-'}")
            print(f"EOXInputValue: {row.eox_input_value or '-'}")
            print("")

    if args.csv_path:
        write_csv(
            args.csv_path,
            ["Release", "OS Type", "LastDateOfSupport", "Matched PID", "Description", "Status", "Note"],
            [
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
            ],
        )
        LOGGER.info("CSV saved: %s", args.csv_path)

    _print_debug_if_needed(args.debug, debug_payloads)
    return 0


def _print_debug_if_needed(enabled: bool, payloads: list[dict[str, Any]]) -> None:
    if not enabled:
        return
    print("\n[DEBUG RAW RESPONSES]")
    for payload in payloads:
        print(dump_debug_payload(payload))


if __name__ == "__main__":
    raise SystemExit(main())
