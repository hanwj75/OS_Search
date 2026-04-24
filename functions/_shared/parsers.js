export function parseDelimitedInput(raw, maxItems) {
  if (!raw || !raw.trim()) {
    throw new Error("입력값이 비어 있습니다.");
  }

  const values = raw
    .split(/[\n,]+/)
    .map((value) => value.trim())
    .filter(Boolean);

  if (!values.length) {
    throw new Error("유효한 입력이 없습니다.");
  }

  const uniqueValues = [...new Set(values)];
  if (uniqueValues.length > maxItems) {
    throw new Error(`입력값은 최대 ${maxItems}개까지 조회할 수 있습니다.`);
  }

  return uniqueValues;
}

