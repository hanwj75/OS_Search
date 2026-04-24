from __future__ import annotations

from ..clients.product_information import ProductInformationClient
from ..clients.sn2info import SerialNumberToInformationClient
from ..errors import AppError


class HardwareLookupService:
    def __init__(
        self,
        product_information_client: ProductInformationClient,
        serial_number_client: SerialNumberToInformationClient,
    ) -> None:
        self._product_information_client = product_information_client
        self._serial_number_client = serial_number_client

    def lookup_serial_numbers(self, serial_numbers: list[str]) -> list[dict[str, object]]:
        try:
            coverage_map = self._serial_number_client.lookup_coverage_status(serial_numbers)
            owner_map = self._serial_number_client.lookup_owner_coverage_status(serial_numbers)
            product_info_map = self._product_information_client.lookup_by_serial_numbers(serial_numbers)
        except AppError as exc:
            return [self._error_result(serial_number, "serial", str(exc)) for serial_number in serial_numbers]

        results: list[dict[str, object]] = []
        for serial_number in serial_numbers:
            coverage = coverage_map.get(serial_number)
            owner = owner_map.get(serial_number)
            product_infos = product_info_map.get(serial_number, [])
            product_info = product_infos[0] if product_infos else None

            if not coverage and not owner and not product_info:
                results.append(
                    {
                        "input": serial_number,
                        "lookupType": "serial",
                        "status": "not_found",
                        "productId": None,
                        "serialNumber": serial_number,
                        "description": None,
                        "coverageStatus": None,
                        "ownerCoverageStatus": None,
                        "orderablePid": None,
                        "productName": None,
                        "productFamily": None,
                        "productType": None,
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
                    "productId": product_info.get("base_pid") if product_info else None,
                    "serialNumber": serial_number,
                    "description": product_info.get("product_name") if product_info else None,
                    "coverageStatus": (coverage or owner or {}).get("is_covered"),
                    "ownerCoverageStatus": (owner or {}).get("sr_no_owner"),
                    "orderablePid": product_info.get("orderable_pid") if product_info else None,
                    "productName": product_info.get("product_name") if product_info else None,
                    "productFamily": product_info.get("product_series") if product_info else None,
                    "productType": product_info.get("product_type") if product_info else None,
                    "message": None,
                    "raw": {
                        "coverage": coverage,
                        "ownerCoverage": owner,
                        "productInfo": product_info,
                    },
                }
            )
        return results

    def lookup_product_ids(self, product_ids: list[str]) -> list[dict[str, object]]:
        try:
            product_map = self._product_information_client.lookup_by_product_ids(product_ids)
        except AppError as exc:
            return [self._error_result(product_id, "pid", str(exc)) for product_id in product_ids]

        results: list[dict[str, object]] = []
        for product_id in product_ids:
            product_infos = product_map.get(product_id, [])
            if not product_infos:
                results.append(
                    {
                        "input": product_id,
                        "lookupType": "pid",
                        "status": "not_found",
                        "productId": product_id,
                        "serialNumber": None,
                        "description": None,
                        "productName": None,
                        "productFamily": None,
                        "productType": None,
                        "message": "조회 결과가 없습니다.",
                        "raw": {},
                    }
                )
                continue

            product_info = product_infos[0]
            results.append(
                {
                    "input": product_id,
                    "lookupType": "pid",
                    "status": "found",
                    "productId": product_info.get("product_id"),
                    "serialNumber": None,
                    "description": product_info.get("product_name"),
                    "productName": product_info.get("product_name"),
                    "productFamily": product_info.get("product_series"),
                    "productType": product_info.get("product_type"),
                    "orderableStatus": product_info.get("orderable_status"),
                    "productCategory": product_info.get("product_category"),
                    "productSubcategory": product_info.get("product_subcategory"),
                    "releaseDate": product_info.get("release_date"),
                    "message": None,
                    "raw": {"matches": product_infos},
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
            "coverageStatus": None,
            "ownerCoverageStatus": None,
            "orderablePid": None,
            "productName": None,
            "productFamily": None,
            "productType": None,
            "message": message,
            "raw": {},
        }
