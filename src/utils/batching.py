from __future__ import annotations

from collections.abc import Iterable


def chunked(values: Iterable[str], size: int) -> list[list[str]]:
    chunk: list[str] = []
    output: list[list[str]] = []
    for value in values:
        chunk.append(value)
        if len(chunk) == size:
            output.append(chunk)
            chunk = []
    if chunk:
        output.append(chunk)
    return output
