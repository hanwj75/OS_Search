from __future__ import annotations

import json
import logging
import mimetypes
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import requests

from .auth import CiscoAuthClient
from .clients.eox import EoxClient
from .clients.eox_hardware import EoxHardwareClient
from .clients.software_suggestion import SoftwareSuggestionClient
from .config import configure_logging, get_settings
from .errors import AppError
from .services.eox_lookup_service import EoxLookupService
from .services.hardware_lookup_service import HardwareLookupService
from .services.recommendation_service import RecommendationService
from .utils.hardware_parser import parse_hardware_input
from .utils.parser import parse_csv_input


LOGGER = logging.getLogger(__name__)
BASE_DIR = Path(__file__).resolve().parent.parent
WEB_DIR = BASE_DIR / "web"


def build_eox_service() -> EoxLookupService:
    settings = get_settings()
    configure_logging(settings.log_level)
    session = requests.Session()
    auth_client = CiscoAuthClient(settings, session=session)
    return EoxLookupService(EoxClient(settings, auth_client, session=session))


def build_hardware_service() -> HardwareLookupService:
    settings = get_settings()
    configure_logging(settings.log_level)
    session = requests.Session()
    auth_client = CiscoAuthClient(settings, session=session)
    return HardwareLookupService(EoxHardwareClient(settings, auth_client, session=session))


def build_recommendation_service() -> RecommendationService:
    settings = get_settings()
    configure_logging(settings.log_level)
    session = requests.Session()
    auth_client = CiscoAuthClient(settings, session=session)
    return RecommendationService(SoftwareSuggestionClient(settings, auth_client, session=session))


class AppHandler(BaseHTTPRequestHandler):
    eox_service = build_eox_service()
    hardware_service = build_hardware_service()
    recommendation_service = build_recommendation_service()

    def do_GET(self) -> None:  # noqa: N802
        if self.path in {"/", "/index.html"}:
            self._serve_file(WEB_DIR / "index.html")
            return
        if self.path in {"/app.js", "/styles.css"}:
            self._serve_file(WEB_DIR / self.path.lstrip("/"))
            return
        if self.path.startswith("/static/"):
            relative_path = self.path.removeprefix("/static/")
            self._serve_file(WEB_DIR / relative_path)
            return
        self._send_json({"error": "Not found"}, HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:  # noqa: N802
        if self.path == "/api/hardware-search":
            self._handle_hardware_search()
            return
        if self.path == "/api/os-recommend":
            self._handle_os_recommend()
            return
        if self.path != "/api/eox-search":
            self._send_json({"error": "Not found"}, HTTPStatus.NOT_FOUND)
            return

        try:
            payload = self._read_json_body()
            releases = parse_csv_input(str(payload.get("releases", "")))
            os_type_value = payload.get("osType")
            raw_os_type = os_type_value.strip() if isinstance(os_type_value, str) else ""
            results = []
            for release in releases:
                resolved_record, all_records, _ = self.eox_service.lookup_release_details(
                    release=release,
                    os_type=raw_os_type or None,
                    debug=False,
                )
                results.append(
                    self._serialize_record(
                        release=release,
                        record=resolved_record,
                        fallback_os_type=raw_os_type or None,
                        all_records=all_records,
                    )
                )
            response = {
                "query": {
                    "releases": releases,
                    "osType": raw_os_type or None,
                },
                "results": results,
            }
            self._send_json(response)
        except AppError as exc:
            LOGGER.error("Web lookup failed: %s", exc)
            self._send_json(
                {
                    "error": str(exc),
                    "results": [],
                },
                HTTPStatus.BAD_REQUEST,
            )
        except json.JSONDecodeError:
            self._send_json({"error": "Invalid JSON body"}, HTTPStatus.BAD_REQUEST)

    def _handle_hardware_search(self) -> None:
        try:
            payload = self._read_json_body()
            lookup_type = str(payload.get("lookupType", "")).strip().lower()
            if lookup_type not in {"serial", "pid"}:
                self._send_json(
                    {"error": "lookupType은 serial 또는 pid만 허용됩니다.", "results": []},
                    HTTPStatus.BAD_REQUEST,
                )
                return

            values = parse_hardware_input(str(payload.get("values", "")))
            results = (
                self.hardware_service.lookup_serial_numbers(values)
                if lookup_type == "serial"
                else self.hardware_service.lookup_product_ids(values)
            )
            self._send_json(
                {
                    "queryType": "hardware",
                    "lookupType": lookup_type,
                    "results": results,
                    "errors": [result for result in results if result.get("status") == "error"],
                }
            )
        except AppError as exc:
            self._send_json({"error": str(exc), "results": []}, HTTPStatus.BAD_REQUEST)
        except json.JSONDecodeError:
            self._send_json({"error": "Invalid JSON body"}, HTTPStatus.BAD_REQUEST)

    def _handle_os_recommend(self) -> None:
        try:
            payload = self._read_json_body()
            product_ids = parse_csv_input(str(payload.get("values", "")))
            recommendations, recommendation_failures, _ = self.recommendation_service.get_recommendations(
                product_ids,
                debug=False,
            )

            releases: list[str] = []
            explicit_os_types: dict[str, str | None] = {}
            for item in recommendations.values():
                if item.release not in explicit_os_types:
                    releases.append(item.release)
                    explicit_os_types[item.release] = item.os_type

            eox_records, eox_failures, _ = self.eox_service.lookup_software_releases(
                releases,
                explicit_os_types=explicit_os_types,
                debug=False,
            )

            results = []
            for pid in product_ids:
                recommendation = recommendations.get(pid)
                if recommendation is None:
                    results.append(
                        {
                            "pid": pid,
                            "productName": None,
                            "recommendedRelease": None,
                            "releaseLabel": None,
                            "softwareType": None,
                            "osType": None,
                            "lastDateOfSupport": None,
                            "status": "ERROR",
                            "recommendationStatus": "ERROR",
                            "eoxStatus": None,
                            "note": recommendation_failures.get(pid, "추천 OS 조회 실패"),
                        }
                    )
                    continue

                eox_record = eox_records.get(recommendation.release)
                eox_status = eox_record.status if eox_record else None
                is_success = eox_record is not None and eox_status in {"SUCCESS_WITH_DATES", "PARTIAL_RECORD"}
                results.append(
                    {
                        "pid": pid,
                        "productName": recommendation.product_name,
                        "recommendedRelease": recommendation.release,
                        "releaseLabel": recommendation.release_label,
                        "softwareType": recommendation.software_type,
                        "osType": recommendation.os_type,
                        "lastDateOfSupport": eox_record.last_date_of_support if is_success else None,
                        "status": "OK" if is_success else "ERROR",
                        "recommendationStatus": "OK",
                        "eoxStatus": eox_status,
                        "note": (
                            eox_record.selection_note
                            or eox_record.user_message
                            or recommendation_failures.get(pid)
                            or eox_failures.get(recommendation.release)
                            or "권장 OS 조회 완료"
                        ) if eox_record else (eox_failures.get(recommendation.release) or "EoX 조회 실패"),
                    }
                )

            self._send_json(
                {
                    "queryType": "os-recommendation",
                    "results": results,
                }
            )
        except AppError as exc:
            self._send_json({"error": str(exc), "results": []}, HTTPStatus.BAD_REQUEST)
        except json.JSONDecodeError:
            self._send_json({"error": "Invalid JSON body"}, HTTPStatus.BAD_REQUEST)

    def log_message(self, format: str, *args: Any) -> None:
        LOGGER.info("%s - %s", self.address_string(), format % args)

    def _read_json_body(self) -> dict[str, Any]:
        content_length = int(self.headers.get("Content-Length", "0"))
        raw_body = self.rfile.read(content_length)
        return json.loads(raw_body.decode("utf-8"))

    def _send_json(self, payload: dict[str, Any], status: HTTPStatus = HTTPStatus.OK) -> None:
        encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def _serve_file(self, path: Path) -> None:
        if not path.exists() or not path.is_file():
            self._send_json({"error": "Not found"}, HTTPStatus.NOT_FOUND)
            return

        content = path.read_bytes()
        mime_type, _ = mimetypes.guess_type(path.name)
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", f"{mime_type or 'application/octet-stream'}; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    @staticmethod
    def _serialize_record(
        release: str,
        record: Any,
        fallback_os_type: str | None,
        all_records: list[Any] | None = None,
    ) -> dict[str, Any]:
        if record is None:
            return {
                "release": release,
                "osType": fallback_os_type,
                "status": "UNKNOWN_ERROR",
                "lastDateOfSupport": None,
                "message": f"{release}: Cisco EoX API 응답을 해석할 수 없거나 매칭된 EOXRecord가 없음",
                "matchedProductId": None,
                "matchedDescription": None,
                "allMatches": [],
            }

        return {
            "release": release,
            "osType": record.os_type or fallback_os_type,
            "status": record.status,
            "lastDateOfSupport": record.last_date_of_support,
            "message": record.user_message,
            "matchedProductId": record.eol_product_id,
            "matchedDescription": record.product_description,
            "productBulletinNumber": record.product_bulletin_number,
            "bulletinUrl": record.bulletin_url,
            "errorId": record.error.error_id if record.error else None,
            "errorDescription": record.error.error_description if record.error else None,
            "errorDataType": record.error.error_data_type if record.error else None,
            "errorDataValue": record.error.error_data_value if record.error else None,
            "allMatches": [
                AppHandler._serialize_all_match(item, fallback_os_type)
                for item in (all_records or [])
            ],
        }

    @staticmethod
    def _serialize_all_match(record: Any, fallback_os_type: str | None) -> dict[str, Any]:
        status = "SUCCESS_WITH_DATES" if record.last_date_of_support else "PARTIAL_RECORD"
        if record.error:
            status = AppHandler._map_error_status(record.error.error_id)
        return {
            "osType": record.os_type or fallback_os_type,
            "status": status,
            "eolProductId": record.eol_product_id,
            "productDescription": record.product_description,
            "productBulletinNumber": record.product_bulletin_number,
            "bulletinUrl": record.bulletin_url,
            "lastDateOfSupport": record.last_date_of_support,
            "endOfSaleDate": record.end_of_sale_date,
            "endOfSwMaintenance": record.end_of_sw_maintenance,
            "migrationStrategy": record.raw.get("EOXMigrationDetails", {}).get("MigrationStrategy")
            if isinstance(record.raw, dict)
            else None,
            "migrationInformation": record.raw.get("EOXMigrationDetails", {}).get("MigrationInformation")
            if isinstance(record.raw, dict)
            else None,
            "migrationOption": record.raw.get("EOXMigrationDetails", {}).get("MigrationOption")
            if isinstance(record.raw, dict)
            else None,
            "migrationProductId": record.raw.get("EOXMigrationDetails", {}).get("MigrationProductId")
            if isinstance(record.raw, dict)
            else None,
            "migrationProductName": record.raw.get("EOXMigrationDetails", {}).get("MigrationProductName")
            if isinstance(record.raw, dict)
            else None,
            "migrationProductInfoUrl": record.raw.get("EOXMigrationDetails", {}).get("MigrationProductInfoURL")
            if isinstance(record.raw, dict)
            else None,
            "errorId": record.error.error_id if record.error else None,
            "errorDescription": record.error.error_description if record.error else None,
            "errorDataType": record.error.error_data_type if record.error else None,
            "errorDataValue": record.error.error_data_value if record.error else None,
            "eoxInputValue": record.input_value,
        }

    @staticmethod
    def _map_error_status(error_id: str | None) -> str:
        if error_id == "SSA_ERR_010":
            return "INVALID_OS_TYPE"
        if error_id == "SSA_ERR_024":
            return "NO_SOFTWARE_MATCH"
        if error_id == "SSA_ERR_026":
            return "PRODUCT_ID_NO_EOX"
        if error_id == "SSA_ERR_022":
            return "PRODUCT_BULLETIN_NO_EOX"
        return "UNKNOWN_ERROR"


def main() -> int:
    settings = get_settings()
    configure_logging(settings.log_level)
    server = ThreadingHTTPServer(("127.0.0.1", 8080), AppHandler)
    LOGGER.info("Starting web UI at http://127.0.0.1:8080")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        LOGGER.info("Shutting down web UI")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
