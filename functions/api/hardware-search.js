import { getAccessToken, jsonResponse } from "../_shared/cisco.js";
import { parseDelimitedInput } from "../_shared/parsers.js";

const EOX_BASE_URL = "https://apix.cisco.com/supporttools/eox/rest/5";

export async function onRequestPost(context) {
  try {
    const payload = await context.request.json();
    const lookupType = String(payload?.lookupType ?? "").trim().toLowerCase();
    if (!lookupType) {
      return jsonResponse({ error: "lookupType이 필요합니다.", results: [] }, 400);
    }
    if (!["serial", "pid"].includes(lookupType)) {
      return jsonResponse({ error: "lookupType은 serial 또는 pid만 허용됩니다.", results: [] }, 400);
    }

    const values = parseDelimitedInput(String(payload?.values ?? ""), 20);
    const token = await getAccessToken(context.env);
    const results = [];

    for (const value of values) {
      try {
        const matches = await lookupHardwareEox(token, lookupType, value);
        const primary = pickPrimaryMatch(matches);
        if (!primary) {
          results.push({
            input: value,
            lookupType,
            status: "not_found",
            productId: lookupType === "pid" ? value : null,
            serialNumber: lookupType === "serial" ? value : null,
            description: null,
            lastDateOfSupport: null,
            productBulletinNumber: null,
            bulletinUrl: null,
            migrationProductId: null,
            migrationStrategy: null,
            message: "조회 결과가 없습니다.",
            raw: {},
          });
          continue;
        }

        results.push({
          input: value,
          lookupType,
          status: "found",
          productId: primary.eolProductId || (lookupType === "pid" ? value : null),
          serialNumber: lookupType === "serial" ? value : null,
          description: primary.productDescription || null,
          lastDateOfSupport: primary.lastDateOfSupport || null,
          productBulletinNumber: primary.productBulletinNumber || null,
          bulletinUrl: primary.bulletinUrl || null,
          migrationProductId: primary.migrationProductId || null,
          migrationStrategy: primary.migrationStrategy || primary.migrationInformation || null,
          message: buildHardwareMessage(value, primary),
          raw: {
            matches,
          },
        });
      } catch (error) {
        results.push(buildErrorResult(value, lookupType, error));
      }
    }

    return jsonResponse({
      queryType: "hardware",
      lookupType,
      results,
      errors: results.filter((result) => result.status === "error"),
    });
  } catch (error) {
    return jsonResponse(
      {
        error: error instanceof Error ? error.message : "하드웨어 조회 중 오류가 발생했습니다.",
        queryType: "hardware",
        results: [],
        errors: [],
      },
      400,
    );
  }
}

async function lookupHardwareEox(token, lookupType, value) {
  const methodName = lookupType === "serial" ? "EOXBySerialNumber" : "EOXByProductID";
  const apiName = lookupType === "serial" ? "EoX Serial Number API" : "EoX Product ID API";
  // Cisco 공식 문서:
  // - /supporttools/eox/rest/5/EOXByProductID/{pageIndex}/{productID}
  // - /supporttools/eox/rest/5/EOXBySerialNumber/{pageIndex}/{serialNumber}
  // - responseencoding=json 사용
  const url = `${EOX_BASE_URL}/${methodName}/1/${encodeURIComponent(value)}?responseencoding=json`;
  const payload = await ciscoGetJson(token, url, apiName);
  const records = Array.isArray(payload?.EOXRecord) ? payload.EOXRecord : [];
  return records.map(parseEoxRecord);
}

async function ciscoGetJson(token, url, apiName) {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  if (response.status === 403) {
    throw new Error(`${apiName} 권한이 없습니다.`);
  }
  if (!response.ok) {
    throw new Error(`${apiName} HTTP 오류: ${response.status}`);
  }

  try {
    return await response.json();
  } catch {
    throw new Error(`${apiName} 응답 JSON 파싱 실패`);
  }
}

function parseEoxRecord(item) {
  const migration = typeof item?.EOXMigrationDetails === "object" && item?.EOXMigrationDetails ? item.EOXMigrationDetails : {};
  const error = typeof item?.EOXError === "object" && item?.EOXError ? item.EOXError : {};
  return {
    eolProductId: clean(item?.EOLProductID),
    productDescription: clean(item?.ProductIDDescription),
    productBulletinNumber: clean(item?.ProductBulletinNumber),
    bulletinUrl: clean(item?.LinkToProductBulletinURL),
    lastDateOfSupport: extractDate(item?.LastDateOfSupport),
    endOfSaleDate: extractDate(item?.EndOfSaleDate),
    updatedTimeStamp: extractDate(item?.UpdatedTimeStamp),
    migrationProductId: clean(migration?.MigrationProductId),
    migrationProductName: clean(migration?.MigrationProductName),
    migrationInformation: clean(migration?.MigrationInformation),
    migrationStrategy: clean(migration?.MigrationStrategy),
    migrationProductInfoUrl: clean(migration?.MigrationProductInfoURL),
    errorId: clean(error?.ErrorID),
    errorDescription: clean(error?.ErrorDescription),
    errorDataType: clean(error?.ErrorDataType),
    errorDataValue: clean(error?.ErrorDataValue),
    inputValue: clean(item?.EOXInputValue),
    inputType: clean(item?.EOXInputType),
    raw: item,
  };
}

function pickPrimaryMatch(matches) {
  if (!matches.length) {
    return null;
  }
  return matches.find((match) => match.lastDateOfSupport) || matches[0];
}

function buildHardwareMessage(input, match) {
  if (match.errorId && match.errorDescription) {
    return `${input}: ${match.errorDescription} (${match.errorId})`;
  }
  if (match.lastDateOfSupport) {
    return `${input}: LastDateOfSupport ${match.lastDateOfSupport}`;
  }
  return `${input}: Cisco EoX API 응답이 반환되었지만 LastDateOfSupport가 없습니다.`;
}

function buildErrorResult(input, lookupType, error) {
  return {
    input,
    lookupType,
    status: "error",
    productId: lookupType === "pid" ? input : null,
    serialNumber: lookupType === "serial" ? input : null,
    description: null,
    lastDateOfSupport: null,
    productBulletinNumber: null,
    bulletinUrl: null,
    migrationProductId: null,
    migrationStrategy: null,
    message: error instanceof Error ? error.message : "Cisco API 요청 중 오류가 발생했습니다.",
    raw: {},
  };
}

function extractDate(node) {
  if (node && typeof node === "object") {
    return clean(node.value);
  }
  return null;
}

function clean(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}
