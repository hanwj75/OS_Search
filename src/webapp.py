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
from .config import configure_logging, get_settings
from .errors import AppError
from .services.eox_lookup_service import EoxLookupService
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


class AppHandler(BaseHTTPRequestHandler):
    eox_service = build_eox_service()

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
        if self.path != "/api/eox-search":
            self._send_json({"error": "Not found"}, HTTPStatus.NOT_FOUND)
            return

        try:
            payload = self._read_json_body()
            releases = parse_csv_input(str(payload.get("releases", "")))
            os_type_value = payload.get("osType")
            raw_os_type = os_type_value.strip() if isinstance(os_type_value, str) else ""
            explicit_os_types = {release: raw_os_type for release in releases} if raw_os_type else None
            records, _, _ = self.eox_service.lookup_software_releases(
                releases,
                explicit_os_types=explicit_os_types,
                debug=False,
            )
            response = {
                "query": {
                    "releases": releases,
                    "osType": raw_os_type or None,
                },
                "results": [self._serialize_record(release, records.get(release), raw_os_type) for release in releases],
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
    def _serialize_record(release: str, record: Any, fallback_os_type: str | None) -> dict[str, Any]:
        if record is None:
            return {
                "release": release,
                "osType": fallback_os_type,
                "status": "UNKNOWN_ERROR",
                "lastDateOfSupport": None,
                "message": f"{release}: Cisco EoX API 응답을 해석할 수 없거나 매칭된 EOXRecord가 없음",
                "matchedProductId": None,
                "matchedDescription": None,
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
        }


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
