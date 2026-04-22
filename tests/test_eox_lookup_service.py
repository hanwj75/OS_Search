from __future__ import annotations

import unittest

from src.models import (
    EoxErrorDetail,
    EoxRecord,
    INVALID_OS_TYPE,
    NO_SOFTWARE_MATCH,
    PARTIAL_RECORD,
    PRODUCT_BULLETIN_NO_EOX,
    PRODUCT_ID_NO_EOX,
    SUCCESS_WITH_DATES,
)
from src.services.eox_lookup_service import EoxLookupService


class FakeEoxClient:
    def __init__(self, responses: dict[str, list[EoxRecord]]) -> None:
        self.responses = responses

    def lookup_by_software_releases(self, release_queries, debug=False):
        release, _ = release_queries[0]
        return self.responses.get(release, []), [{"release": release}] if debug else []

    @staticmethod
    def normalize_release_string(release: str) -> str:
        return release.strip().upper().replace("(", ".").replace(")", "")


def build_record(
    release: str,
    *,
    os_type: str | None = None,
    last_date_of_support: str | None = None,
    all_dates: bool = False,
    error: EoxErrorDetail | None = None,
    product_bulletin_number: str | None = "EOL1234",
) -> EoxRecord:
    full_date = "2027-03-31" if all_dates else None
    return EoxRecord(
        query_key=f"{release},{os_type}" if os_type else release,
        input_value=f"input1={release},{os_type or 'null'}",
        normalized_release=FakeEoxClient.normalize_release_string(release),
        os_type=os_type,
        eox_input_type="ShowEOXBySoftware",
        eol_product_id="PID-1",
        product_description="Sample product",
        eox_external_announcement_date=full_date,
        end_of_sale_date=full_date,
        last_date_of_support=last_date_of_support,
        end_of_sw_maintenance=full_date,
        end_of_security_support=full_date,
        end_of_routine_failure_analysis=full_date,
        end_of_service_contract_renewal=full_date,
        end_of_service_attach=full_date,
        bulletin_url="https://www.cisco.com/example",
        product_bulletin_number=product_bulletin_number,
        error=error,
        raw={},
    )


class EoxLookupServiceTests(unittest.TestCase):
    def test_success_with_dates(self) -> None:
        service = EoxLookupService(
            FakeEoxClient(
                {
                    "17.9.5": [
                        build_record("17.9.5", os_type="IOS-XE", last_date_of_support="2027-03-31", all_dates=True)
                    ]
                }
            )
        )

        records, failures, _ = service.lookup_software_releases(["17.9.5"], {"17.9.5": "IOS-XE"})

        self.assertEqual(records["17.9.5"].status, SUCCESS_WITH_DATES)
        self.assertEqual(records["17.9.5"].last_date_of_support, "2027-03-31")
        self.assertEqual(failures["17.9.5"] if "17.9.5" in failures else None, None)

    def test_invalid_os_type_maps_to_invalid_os_type_status(self) -> None:
        service = EoxLookupService(
            FakeEoxClient(
                {
                    "17.9.5": [
                        build_record(
                            "17.9.5",
                            os_type="BAD-OS",
                            error=EoxErrorDetail("SSA_ERR_010", "invalid OSType", None, None),
                            product_bulletin_number=None,
                        )
                    ]
                }
            )
        )

        records, _, _ = service.lookup_software_releases(["17.9.5"], {"17.9.5": "BAD-OS"})
        self.assertEqual(records["17.9.5"].status, INVALID_OS_TYPE)

    def test_product_bulletin_no_eox_maps_to_ssa_err_022(self) -> None:
        service = EoxLookupService(
            FakeEoxClient(
                {
                    "10.3(6)": [
                        build_record(
                            "10.3(6)",
                            os_type="NX-OS",
                            error=EoxErrorDetail(
                                "SSA_ERR_022",
                                "EOX information does not exist for the following product bulletin(s): https://www.cisco.com/x",
                                "PRODUCT_BULLETIN",
                                "https://www.cisco.com/x",
                            ),
                            product_bulletin_number="c07-658595-4",
                        )
                    ]
                }
            )
        )

        records, _, _ = service.lookup_software_releases(["10.3(6)"], {"10.3(6)": "NX-OS"})
        self.assertEqual(records["10.3(6)"].status, PRODUCT_BULLETIN_NO_EOX)

    def test_no_software_match_maps_to_ssa_err_024(self) -> None:
        service = EoxLookupService(
            FakeEoxClient(
                {
                    "99.99": [
                        build_record(
                            "99.99",
                            error=EoxErrorDetail("SSA_ERR_024", "software string not found", None, None),
                            product_bulletin_number=None,
                        )
                    ]
                }
            )
        )

        records, _, _ = service.lookup_software_releases(["99.99"])
        self.assertEqual(records["99.99"].status, NO_SOFTWARE_MATCH)

    def test_product_id_no_eox_maps_to_ssa_err_026(self) -> None:
        service = EoxLookupService(
            FakeEoxClient(
                {
                    "12.4(15)T": [
                        build_record(
                            "12.4(15)T",
                            os_type="IOS",
                            error=EoxErrorDetail("SSA_ERR_026", "no eox for pid", "PRODUCT_ID", "ILPM-8="),
                            product_bulletin_number=None,
                        )
                    ]
                }
            )
        )

        records, _, _ = service.lookup_software_releases(["12.4(15)T"], {"12.4(15)T": "IOS"})
        self.assertEqual(records["12.4(15)T"].status, PRODUCT_ID_NO_EOX)

    def test_partial_record_when_some_lifecycle_dates_exist(self) -> None:
        service = EoxLookupService(
            FakeEoxClient(
                {
                    "10.4(5)": [
                        build_record(
                            "10.4(5)",
                            os_type="NX-OS",
                            last_date_of_support="2026-08-31",
                            all_dates=False,
                        )
                    ]
                }
            )
        )

        records, _, _ = service.lookup_software_releases(["10.4(5)"], {"10.4(5)": "NX-OS"})
        self.assertEqual(records["10.4(5)"].status, PARTIAL_RECORD)


if __name__ == "__main__":
    unittest.main()
