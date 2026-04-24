from __future__ import annotations

from ..clients.eox_hardware import EoxHardwareClient
from ..errors import AppError


class HardwareLookupService:
    def __init__(
        self,
        eox_hardware_client: EoxHardwareClient,
    ) -> None:
        self._eox_hardware_client = eox_hardware_client

    def lookup_serial_numbers(self, serial_numbers: list[str]) -> list[dict[str, object]]:
        try:
            record_map = self._eox_hardware_client.lookup_by_serial_numbers(serial_numbers)
        except AppError as exc:
            return [self._error_result(serial_number, "serial", str(exc)) for serial_number in serial_numbers]

        results: list[dict[str, object]] = []
        for serial_number in serial_numbers:
            matches = record_map.get(serial_number, [])
            primary = self._pick_primary_match(matches)
            if primary is None:
                results.append(
                    {
                        "input": serial_number,
                        "lookupType": "serial",
                        "status": "not_found",
                        "productId": None,
                        "serialNumber": serial_number,
                        "description": None,
                        "lastDateOfSupport": None,
                        "productBulletinNumber": None,
                        "bulletinUrl": None,
                        "migrationProductId": None,
                        "migrationStrategy": None,
                        "message": "조회 결과가 없습니다.",
                        "raw": {},
                    }
                )
                continue

            results.append(
                {
                    "input": serial_number,
                    "lookupType": "serial",
                    "status": "found",
                    "productId": primary.get("eolProductId"),
                    "serialNumber": serial_number,
                    "description": primary.get("productDescription"),
                    "lastDateOfSupport": primary.get("lastDateOfSupport"),
                    "productBulletinNumber": primary.get("productBulletinNumber"),
                    "bulletinUrl": primary.get("bulletinUrl"),
                    "migrationProductId": primary.get("migrationProductId"),
                    "migrationStrategy": primary.get("migrationStrategy") or primary.get("migrationInformation"),
                    "message": self._build_message(serial_number, primary),
                    "raw": {
                        "matches": matches,
                    },
                }
            )
        return results

    def lookup_product_ids(self, product_ids: list[str]) -> list[dict[str, object]]:
        try:
            record_map = self._eox_hardware_client.lookup_by_product_ids(product_ids)
        except AppError as exc:
            return [self._error_result(product_id, "pid", str(exc)) for product_id in product_ids]

        results: list[dict[str, object]] = []
        for product_id in product_ids:
            matches = record_map.get(product_id, [])
            primary = self._pick_primary_match(matches)
            if primary is None:
                results.append(
                    {
                        "input": product_id,
                        "lookupType": "pid",
                        "status": "not_found",
                        "productId": product_id,
                        "serialNumber": None,
                        "description": None,
                        "lastDateOfSupport": None,
                        "productBulletinNumber": None,
                        "bulletinUrl": None,
                        "migrationProductId": None,
                        "migrationStrategy": None,
                        "message": "조회 결과가 없습니다.",
                        "raw": {},
                    }
                )
                continue

            results.append(
                {
                    "input": product_id,
                    "lookupType": "pid",
                    "status": "found",
                    "productId": primary.get("eolProductId") or product_id,
                    "serialNumber": None,
                    "description": primary.get("productDescription"),
                    "lastDateOfSupport": primary.get("lastDateOfSupport"),
                    "productBulletinNumber": primary.get("productBulletinNumber"),
                    "bulletinUrl": primary.get("bulletinUrl"),
                    "migrationProductId": primary.get("migrationProductId"),
                    "migrationStrategy": primary.get("migrationStrategy") or primary.get("migrationInformation"),
                    "message": self._build_message(product_id, primary),
                    "raw": {"matches": matches},
                }
            )
        return results

    @staticmethod
    def _error_result(value: str, lookup_type: str, message: str) -> dict[str, object]:
        return {
            "input": value,
            "lookupType": lookup_type,
            "status": "error",
            "productId": value if lookup_type == "pid" else None,
            "serialNumber": value if lookup_type == "serial" else None,
            "description": None,
            "lastDateOfSupport": None,
            "productBulletinNumber": None,
            "bulletinUrl": None,
            "migrationProductId": None,
            "migrationStrategy": None,
            "message": message,
            "raw": {},
        }

    @staticmethod
    def _pick_primary_match(matches: list[dict[str, object]]) -> dict[str, object] | None:
        if not matches:
            return None
        return next((match for match in matches if match.get("lastDateOfSupport")), matches[0])

    @staticmethod
    def _build_message(input_value: str, match: dict[str, object]) -> str:
        error_id = match.get("errorId")
        error_description = match.get("errorDescription")
        last_date = match.get("lastDateOfSupport")
        if error_id and error_description:
            return f"{input_value}: {error_description} ({error_id})"
        if isinstance(last_date, str) and last_date:
            return f"{input_value}: LastDateOfSupport {last_date}"
        return f"{input_value}: Cisco EoX API 응답이 반환되었지만 LastDateOfSupport가 없습니다."
