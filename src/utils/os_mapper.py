from __future__ import annotations

from typing import Final


# Cisco EoX 문서의 허용 OSType 값 일부를 운영 목적에 맞게 정리했다.
# TODO: 실제 환경에서 장비군별 softwareType 문자열을 추가 검증해 매핑을 보강할 것.
SOFTWARE_TYPE_TO_OS_TYPE: Final[dict[str, str]] = {
    "IOS Software": "IOS",
    "Cisco IOS Software": "IOS",
    "IOS XE Software": "IOS-XE",
    "Cisco IOS XE Software": "IOS-XE",
    "IOS XR Software": "IOS XR",
    "Cisco IOS XR Software": "IOS XR",
    "NX-OS Software": "NX-OS",
    "Cisco NX-OS Software": "NX-OS",
    "UCS NX-OS Software": "UCS NX-OS",
    "ASA Software": "ASA",
    "Adaptive Security Appliance Software": "ASA",
}


def map_software_type_to_os_type(software_type: str | None) -> str | None:
    if not software_type:
        return None
    normalized = software_type.strip()
    return SOFTWARE_TYPE_TO_OS_TYPE.get(normalized)


def infer_os_type_from_release(release: str) -> str | None:
    normalized = release.strip().upper()

    # TODO: 릴리스 문자열만으로는 IOS / IOS-XE / NX-OS를 완전히 구분할 수 없다.
    # 필요 시 사용자 옵션으로 OSType override를 받도록 확장할 수 있다.
    if "(" in normalized and ")" in normalized:
        return "IOS"
    if normalized.startswith(("16.", "17.", "3.")):
        return "IOS-XE"
    if normalized.startswith(("9.", "10.")):
        return "NX-OS"
    return None
