import { getAccessToken, jsonResponse } from "../_shared/cisco.js";
import { parseDelimitedInput } from "../_shared/parsers.js";

const SOFTWARE_BASE_URL = "https://apix.cisco.com/software/suggestion/v2";
const EOX_BASE_URL = "https://apix.cisco.com/supporttools/eox/rest/5";
const SOFTWARE_TYPE_TO_OS_TYPE = {
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
};

export async function onRequestPost(context) {
  try {
    const payload = await context.request.json();
    const productIds = parseDelimitedInput(String(payload?.values ?? ""), 50);
    const results = await lookupRecommendations(context.env, productIds);

    return jsonResponse(
      {
        queryType: "os-recommendation",
        results,
      },
      200,
    );
  } catch (error) {
    return jsonResponse(
      {
        error: error instanceof Error ? error.message : "OS 추천 조회 중 오류가 발생했습니다.",
        results: [],
      },
      400,
    );
  }
}

async function lookupRecommendations(env, productIds) {
  const token = await getAccessToken(env);
  const suggestionMap = new Map();

  for (const batch of chunk(productIds, 10)) {
    const payload = await fetchSuggestions(token, batch);
    for (const item of parseSuggestionPayload(payload)) {
      const existing = suggestionMap.get(item.product.basePid);
      if (!existing || existing.suggestions.length < item.suggestions.length) {
        suggestionMap.set(item.product.basePid, item);
      }
    }
  }

  const intermediate = [];
  const releaseCache = new Map();

  for (const pid of productIds) {
    const result = suggestionMap.get(pid);
    if (!result) {
      intermediate.push({
        pid,
        productName: null,
        recommendedRelease: null,
        releaseLabel: null,
        softwareType: null,
        osType: null,
        lastDateOfSupport: null,
        status: "ERROR",
        recommendationStatus: "ERROR",
        eoxStatus: null,
        note: "지원되지 않는 장비 또는 응답 없음",
      });
      continue;
    }

    const chosen = selectRecommendation(result.suggestions);
    if (!chosen) {
      intermediate.push({
        pid,
        productName: result.product.productName,
        recommendedRelease: null,
        releaseLabel: null,
        softwareType: result.product.softwareType,
        osType: mapSoftwareTypeToOsType(result.product.softwareType),
        lastDateOfSupport: null,
        status: "ERROR",
        recommendationStatus: "ERROR",
        eoxStatus: null,
        note: "추천 OS 없음",
      });
      continue;
    }

    const osType = mapSoftwareTypeToOsType(result.product.softwareType);
    intermediate.push({
      pid,
      productName: result.product.productName,
      recommendedRelease: chosen.release,
      releaseLabel: chosen.releaseLabel,
      softwareType: result.product.softwareType,
      osType,
      recommendationStatus: "OK",
    });

    const cacheKey = `${chosen.release}::${osType || ""}`;
    if (!releaseCache.has(cacheKey)) {
      releaseCache.set(cacheKey, await lookupEoxRelease(token, chosen.release, osType));
    }
  }

  return intermediate.map((item) => {
    if (!item.recommendedRelease) {
      return item;
    }

    const cacheKey = `${item.recommendedRelease}::${item.osType || ""}`;
    const eox = releaseCache.get(cacheKey);
    const isSuccess = eox && ["SUCCESS_WITH_DATES", "PARTIAL_RECORD"].includes(eox.status);

    return {
      pid: item.pid,
      productName: item.productName,
      recommendedRelease: item.recommendedRelease,
      releaseLabel: item.releaseLabel,
      softwareType: item.softwareType,
      osType: item.osType,
      lastDateOfSupport: isSuccess ? eox.lastDateOfSupport : null,
      status: isSuccess ? "OK" : "ERROR",
      recommendationStatus: item.recommendationStatus,
      eoxStatus: eox?.status ?? null,
      note: eox?.selectionNote || eox?.message || "권장 OS 조회 완료",
    };
  });
}

async function fetchSuggestions(token, productIds) {
  const response = await fetch(
    `${SOFTWARE_BASE_URL}/suggestions/releases/productIds/${productIds.join(",")}?pageIndex=1`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    },
  );

  if (response.status === 403) {
    throw new Error("Software Suggestion API 권한이 없습니다.");
  }
  if (!response.ok) {
    throw new Error(`Software Suggestion API HTTP 오류: ${response.status}`);
  }

  try {
    return await response.json();
  } catch {
    throw new Error("Software Suggestion API 응답 JSON 파싱 실패");
  }
}

function parseSuggestionPayload(payload) {
  const productList = Array.isArray(payload?.productList) ? payload.productList : [];
  return productList.map((item) => ({
    product: {
      basePid: String(item?.product?.basePID ?? "").trim(),
      productName: item?.product?.productName ?? null,
      softwareType: item?.product?.softwareType ?? null,
    },
    suggestions: Array.isArray(item?.suggestions)
      ? item.suggestions.map((suggestion) => ({
          isSuggested: String(suggestion?.isSuggested ?? "").trim(),
          releaseFormat1: suggestion?.releaseFormat1 ?? null,
          releaseFormat2: suggestion?.releaseFormat2 ?? null,
          releaseDate: suggestion?.releaseDate ?? null,
          releaseLabel: suggestion?.relDispName ?? null,
        }))
      : [],
  }));
}

function selectRecommendation(suggestions) {
  const candidates = suggestions.filter((item) => item.isSuggested === "Y");
  if (!candidates.length) {
    return null;
  }

  candidates.sort((left, right) => {
    const leftDate = parseReleaseDate(left.releaseDate);
    const rightDate = parseReleaseDate(right.releaseDate);
    if (leftDate !== rightDate) {
      return rightDate - leftDate;
    }
    return String(right.releaseFormat2 || right.releaseFormat1 || "").localeCompare(
      String(left.releaseFormat2 || left.releaseFormat1 || ""),
    );
  });

  const chosen = candidates[0];
  const release = String(chosen.releaseFormat2 || chosen.releaseFormat1 || "").trim();
  if (!release) {
    return null;
  }

  return {
    release,
    releaseLabel: chosen.releaseLabel,
  };
}

function parseReleaseDate(value) {
  if (!value) {
    return Number.NEGATIVE_INFINITY;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

function mapSoftwareTypeToOsType(softwareType) {
  if (!softwareType) {
    return null;
  }
  return SOFTWARE_TYPE_TO_OS_TYPE[String(softwareType).trim()] ?? null;
}

async function lookupEoxRelease(token, release, osType) {
  const url = new URL(`${EOX_BASE_URL}/EOXBySWReleaseString/1`);
  url.searchParams.set("responseencoding", "json");
  url.searchParams.set("input1", osType ? `${release},${osType}` : release);

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  if (response.status === 403) {
    throw new Error("EoX API 권한이 없습니다.");
  }
  if (!response.ok) {
    throw new Error(`EoX API HTTP 오류: ${response.status}`);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("EoX API 응답 JSON 파싱 실패");
  }

  const records = parseEoxPayload(payload);
  const normalizedRelease = normalizeReleaseString(release);
  let releaseRecords = records.filter((record) => record.normalizedRelease === normalizedRelease);
  if (osType) {
    const exactTypeRecords = releaseRecords.filter((record) => record.osType === osType);
    if (exactTypeRecords.length) {
      releaseRecords = exactTypeRecords;
    }
  }
  return resolveEoxRecord(release, osType, releaseRecords);
}

function parseEoxPayload(payload) {
  const rawRecords = Array.isArray(payload?.EOXRecord) ? payload.EOXRecord : [];
  return rawRecords.map((item) => {
    const { normalizedRelease, osType } = extractQueryMetadata(item?.EOXInputValue);
    return {
      normalizedRelease,
      osType,
      eolProductId: item?.EOLProductID || null,
      productDescription: item?.ProductIDDescription || null,
      lastDateOfSupport: extractDate(item?.LastDateOfSupport),
      endOfSaleDate: extractDate(item?.EndOfSaleDate),
      endOfSwMaintenance: extractDate(item?.EndOfSWMaintenanceReleases),
      error: extractError(item?.EOXError),
    };
  });
}

function extractDate(node) {
  if (node && typeof node === "object") {
    const value = typeof node.value === "string" ? node.value.trim() : "";
    return value || null;
  }
  return null;
}

function extractError(node) {
  if (!node || typeof node !== "object") {
    return null;
  }
  return {
    errorId: node.ErrorID ?? null,
    errorDescription: node.ErrorDescription ?? null,
  };
}

function extractQueryMetadata(inputValue) {
  if (!inputValue) {
    return { normalizedRelease: "", osType: null };
  }
  const decoded = decodeURIComponent(String(inputValue).trim());
  const match = decoded.match(/input\d+=(.*?)(?=,input\d+=|$)/);
  const queryKey = match ? match[1].trim() : decoded.split("=").slice(1).join("=").trim() || decoded;
  const [releasePart, ...osTypeParts] = queryKey.split(",");
  const rawOsType = osTypeParts.join(",").trim();
  return {
    normalizedRelease: normalizeReleaseString(releasePart),
    osType: rawOsType && rawOsType.toLowerCase() !== "null" ? rawOsType : null,
  };
}

function normalizeReleaseString(release) {
  return String(release)
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/\(/g, ".")
    .replace(/\)/g, "")
    .replace(/\.+/g, ".")
    .replace(/^\./, "")
    .replace(/\.$/, "");
}

function resolveEoxRecord(release, osType, records) {
  if (!records.length) {
    return {
      status: "UNKNOWN_ERROR",
      lastDateOfSupport: null,
      message: `${release}${formatOsTypeSuffix(osType)}: Cisco EoX API 응답을 해석할 수 없거나 매칭된 EOXRecord가 없음`,
      selectionNote: null,
    };
  }

  const lifecycleRecords = records.filter((record) => record.lastDateOfSupport || record.endOfSaleDate || record.endOfSwMaintenance);
  if (lifecycleRecords.length) {
    const byDate = new Map();
    for (const record of lifecycleRecords) {
      if (!record.lastDateOfSupport) {
        continue;
      }
      const bucket = byDate.get(record.lastDateOfSupport) ?? [];
      bucket.push(record);
      byDate.set(record.lastDateOfSupport, bucket);
    }

    if (byDate.size) {
      const [dominantDate, dominantRecords] = [...byDate.entries()].sort((left, right) => {
        return right[1].length - left[1].length || String(right[0]).localeCompare(String(left[0]));
      })[0];
      return {
        status: "PARTIAL_RECORD",
        lastDateOfSupport: dominantDate,
        message: `${release}${formatOsTypeSuffix(osType)}: Cisco EoX API가 일부 lifecycle 필드만 반환함`,
        selectionNote: lifecycleRecords.length > 1
          ? `${lifecycleRecords.length}건 중 ${dominantRecords.length}건이 LastDateOfSupport ${dominantDate}`
          : null,
      };
    }
  }

  const errorRecord = records.find((record) => record.error);
  if (errorRecord) {
    return {
      status: mapErrorStatus(errorRecord.error.errorId),
      lastDateOfSupport: null,
      message: errorRecord.error.errorDescription || `${release}${formatOsTypeSuffix(osType)}: EoX 조회 실패`,
      selectionNote: null,
    };
  }

  return {
    status: "UNKNOWN_ERROR",
    lastDateOfSupport: null,
    message: `${release}${formatOsTypeSuffix(osType)}: Cisco EoX API가 해석 가능한 lifecycle 데이터를 주지 않았음`,
    selectionNote: null,
  };
}

function mapErrorStatus(errorId) {
  if (errorId === "SSA_ERR_010") {
    return "INVALID_OS_TYPE";
  }
  if (errorId === "SSA_ERR_024") {
    return "NO_SOFTWARE_MATCH";
  }
  if (errorId === "SSA_ERR_026") {
    return "PRODUCT_ID_NO_EOX";
  }
  if (errorId === "SSA_ERR_022") {
    return "PRODUCT_BULLETIN_NO_EOX";
  }
  return "UNKNOWN_ERROR";
}

function formatOsTypeSuffix(osType) {
  return osType ? ` (${osType})` : "";
}

function chunk(values, size) {
  const batches = [];
  for (let index = 0; index < values.length; index += size) {
    batches.push(values.slice(index, index + size));
  }
  return batches;
}
