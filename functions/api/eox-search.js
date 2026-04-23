const TOKEN_MARGIN_SECONDS = 60;
const EOX_BASE_URL = "https://apix.cisco.com/supporttools/eox/rest/5";
const AUTH_URL = "https://id.cisco.com/oauth2/default/v1/token";
const SUCCESS_WITH_DATES = "SUCCESS_WITH_DATES";
const PARTIAL_RECORD = "PARTIAL_RECORD";
const INVALID_OS_TYPE = "INVALID_OS_TYPE";
const NO_SOFTWARE_MATCH = "NO_SOFTWARE_MATCH";
const PRODUCT_ID_NO_EOX = "PRODUCT_ID_NO_EOX";
const PRODUCT_BULLETIN_NO_EOX = "PRODUCT_BULLETIN_NO_EOX";
const UNKNOWN_ERROR = "UNKNOWN_ERROR";

let tokenCache = {
  accessToken: null,
  expiresAt: 0,
};

export async function onRequestPost(context) {
  try {
    const payload = await context.request.json();
    const releases = parseCsvInput(String(payload?.releases ?? ""));
    const rawOsType = typeof payload?.osType === "string" ? payload.osType.trim() : "";
    const results = [];

    for (const release of releases) {
      const record = await lookupRelease(context.env, release, rawOsType || null);
      results.push(record);
    }

    return jsonResponse(
      {
        query: {
          releases,
          osType: rawOsType || null,
        },
        results,
      },
      200,
    );
  } catch (error) {
    return jsonResponse(
      {
        error: error instanceof Error ? error.message : "조회 중 오류가 발생했습니다.",
        results: [],
      },
      400,
    );
  }
}

function parseCsvInput(raw) {
  if (!raw || !raw.trim()) {
    throw new Error("입력값이 비어 있습니다.");
  }

  const values = raw.split(",").map((value) => value.trim()).filter(Boolean);
  if (!values.length) {
    throw new Error("유효한 입력이 없습니다.");
  }

  return [...new Set(values)];
}

async function lookupRelease(env, release, explicitOsType) {
  const payload = await fetchEoxPayload(env, release, explicitOsType);
  const records = parsePayload(payload);
  const normalizedRelease = normalizeReleaseString(release);
  let releaseRecords = records.filter((record) => record.normalizedRelease === normalizedRelease);

  if (explicitOsType) {
    const exactTypeRecords = releaseRecords.filter((record) => record.osType === explicitOsType);
    if (exactTypeRecords.length) {
      releaseRecords = exactTypeRecords;
    }
  }

  const resolved = resolveReleaseRecord(release, explicitOsType, releaseRecords);
  return serializeRecord(release, explicitOsType, resolved);
}

async function fetchEoxPayload(env, release, osType) {
  const token = await getAccessToken(env);
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

  return payload;
}

async function getAccessToken(env) {
  const now = Date.now() / 1000;
  if (tokenCache.accessToken && now < tokenCache.expiresAt) {
    return tokenCache.accessToken;
  }

  const clientId = String(env.CLIENT_ID ?? "").trim();
  const clientSecret = String(env.CLIENT_SECRET ?? "").trim();
  if (!clientId || !clientSecret) {
    throw new Error("Cloudflare Pages 환경 변수 CLIENT_ID 또는 CLIENT_SECRET 이 설정되지 않았습니다.");
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });

  const response = await fetch(AUTH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (response.status === 400 || response.status === 401) {
    throw new Error("인증 실패: CLIENT_ID/CLIENT_SECRET 또는 앱 권한을 확인하세요.");
  }
  if (response.status === 403) {
    throw new Error("권한 없음: Cisco Support API 접근 권한을 확인하세요.");
  }
  if (!response.ok) {
    throw new Error(`토큰 발급 HTTP 오류: ${response.status}`);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("토큰 응답 JSON 파싱 실패");
  }

  const accessToken = payload?.access_token;
  const expiresIn = Number(payload?.expires_in ?? 3600);
  if (!accessToken) {
    throw new Error("토큰 응답에 access_token 필드가 없습니다.");
  }

  tokenCache = {
    accessToken,
    expiresAt: now + Math.max(expiresIn - TOKEN_MARGIN_SECONDS, 0),
  };
  return accessToken;
}

function parsePayload(payload) {
  const rawRecords = payload?.EOXRecord;
  if (!Array.isArray(rawRecords)) {
    return [];
  }

  return rawRecords.map((item) => {
    const { queryKey, normalizedRelease, osType } = extractQueryMetadata(item?.EOXInputValue);
    return {
      queryKey,
      inputValue: item?.EOXInputValue ?? null,
      normalizedRelease,
      osType,
      eoxInputType: item?.EOXInputType ?? null,
      eolProductId: item?.EOLProductID || null,
      productDescription: item?.ProductIDDescription || null,
      eoxExternalAnnouncementDate: extractDate(item?.EOXExternalAnnouncementDate),
      endOfSaleDate: extractDate(item?.EndOfSaleDate),
      lastDateOfSupport: extractDate(item?.LastDateOfSupport),
      endOfSwMaintenance: extractDate(item?.EndOfSWMaintenanceReleases),
      endOfSecuritySupport: extractDate(item?.EndOfSecurityVulSupportDate),
      endOfRoutineFailureAnalysis: extractDate(item?.EndOfRoutineFailureAnalysisDate),
      endOfServiceContractRenewal: extractDate(item?.EndOfServiceContractRenewal),
      endOfServiceAttach: extractDate(item?.EndOfSvcAttachDate),
      bulletinUrl: item?.LinkToProductBulletinURL || item?.["LinkToProductBullet-let-inURL"] || null,
      productBulletinNumber: item?.ProductBulletinNumber || null,
      error: extractError(item?.EOXError),
      raw: item,
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
    errorDataType: node.ErrorDataType ?? null,
    errorDataValue: node.ErrorDataValue ?? null,
  };
}

function extractQueryMetadata(inputValue) {
  if (!inputValue) {
    return { queryKey: "", normalizedRelease: "", osType: null };
  }

  const decoded = decodeURIComponent(String(inputValue).trim());
  const match = decoded.match(/input\d+=(.*?)(?=,input\d+=|$)/);
  const queryKey = match ? match[1].trim() : decoded.split("=").slice(1).join("=").trim() || decoded;
  const [releasePart, osType] = splitReleaseAndOsType(queryKey);

  return {
    queryKey,
    normalizedRelease: normalizeReleaseString(releasePart),
    osType,
  };
}

function splitReleaseAndOsType(queryKey) {
  if (!queryKey.includes(",")) {
    return [queryKey.trim(), null];
  }
  const [releasePart, ...osTypeParts] = queryKey.split(",");
  const rawOsType = osTypeParts.join(",").trim();
  const normalizedOsType = rawOsType && rawOsType.toLowerCase() !== "null" ? rawOsType : null;
  return [releasePart.trim(), normalizedOsType];
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

function resolveReleaseRecord(release, osType, records) {
  if (!records.length) {
    return buildErrorRecord(release, osType, UNKNOWN_ERROR, formatUnknownMessage(release, osType));
  }

  const lifecycleRecords = records.filter(hasAnyLifecycleDate);
  if (lifecycleRecords.length) {
    return selectLifecycleRecord(release, osType, lifecycleRecords);
  }

  const errorRecord = records.find((record) => record.error);
  if (errorRecord) {
    return classifyErrorRecord(release, osType, errorRecord);
  }

  const representative = { ...records[0] };
  representative.status = PARTIAL_RECORD;
  representative.userMessage = formatPartialMessage(release, osType);
  return representative;
}

function selectLifecycleRecord(release, osType, records) {
  const byDate = new Map();
  const undatedRecords = [];

  for (const record of records) {
    if (record.lastDateOfSupport) {
      const bucket = byDate.get(record.lastDateOfSupport) ?? [];
      bucket.push(record);
      byDate.set(record.lastDateOfSupport, bucket);
    } else {
      undatedRecords.push(record);
    }
  }

  if (byDate.size) {
    const [dominantDate, dominantRecords] = [...byDate.entries()].sort((left, right) => {
      return right[1].length - left[1].length || String(right[0]).localeCompare(String(left[0]));
    })[0];

    const representative = { ...dominantRecords[0] };
    representative.lastDateOfSupport = dominantDate;
    representative.matchCount = records.length;
    representative.status = hasAllLifecycleDates(representative)
      ? SUCCESS_WITH_DATES
      : PARTIAL_RECORD;
    representative.userMessage = representative.status === SUCCESS_WITH_DATES
      ? `${release}${formatOsTypeSuffix(osType)}: ${dominantDate}`
      : formatPartialMessage(release, osType);
    representative.selectionNote = records.length > 1
      ? `${records.length}건 중 ${dominantRecords.length}건이 LastDateOfSupport ${dominantDate}`
      : null;
    return representative;
  }

  const representative = { ...undatedRecords[0] };
  representative.status = PARTIAL_RECORD;
  representative.userMessage = formatPartialMessage(release, osType);
  representative.matchCount = records.length;
  return representative;
}

function classifyErrorRecord(release, osType, record) {
  const resolved = { ...record };
  const errorId = record.error?.errorId;

  if (errorId === "SSA_ERR_010") {
    resolved.status = INVALID_OS_TYPE;
    resolved.userMessage =
      `${release}${formatOsTypeSuffix(osType)}: Cisco EoX API가 OSType 값을 유효하지 않은 값으로 해석함 (${errorId})`;
  } else if (errorId === "SSA_ERR_024") {
    resolved.status = NO_SOFTWARE_MATCH;
    resolved.userMessage =
      `${release}${formatOsTypeSuffix(osType)}: Cisco EoX API에서 software release에 대한 EoX 정보를 찾지 못함 (${errorId})`;
  } else if (errorId === "SSA_ERR_026") {
    resolved.status = PRODUCT_ID_NO_EOX;
    resolved.userMessage =
      `${release}${formatOsTypeSuffix(osType)}: Cisco EoX API에서 software release가 product ID로 매핑되었지만, 해당 product ID에 대한 EoX lifecycle 데이터가 존재하지 않음 (${errorId})`;
  } else if (errorId === "SSA_ERR_022") {
    resolved.status = PRODUCT_BULLETIN_NO_EOX;
    resolved.userMessage =
      `${release}${formatOsTypeSuffix(osType)}: Cisco EoX API에서 software release가 product bulletin으로 매핑되었지만, 해당 bulletin에 대한 EoX lifecycle 데이터가 존재하지 않음 (${errorId})`;
  } else {
    resolved.status = UNKNOWN_ERROR;
    resolved.userMessage =
      `${release}${formatOsTypeSuffix(osType)}: Cisco EoX API가 해석 가능한 lifecycle 데이터를 주지 않았음${errorId ? ` (${errorId})` : ""}`;
  }

  return resolved;
}

function buildErrorRecord(release, osType, status, userMessage) {
  return {
    queryKey: release,
    inputValue: release,
    normalizedRelease: normalizeReleaseString(release),
    osType,
    eoxInputType: "ShowEOXBySoftware",
    eolProductId: null,
    productDescription: null,
    eoxExternalAnnouncementDate: null,
    endOfSaleDate: null,
    lastDateOfSupport: null,
    endOfSwMaintenance: null,
    endOfSecuritySupport: null,
    endOfRoutineFailureAnalysis: null,
    endOfServiceContractRenewal: null,
    endOfServiceAttach: null,
    bulletinUrl: null,
    productBulletinNumber: null,
    matchCount: 1,
    selectionNote: null,
    status,
    userMessage,
    error: null,
    raw: {},
  };
}

function hasAnyLifecycleDate(record) {
  return lifecycleDates(record).some(Boolean);
}

function hasAllLifecycleDates(record) {
  return lifecycleDates(record).every(Boolean);
}

function lifecycleDates(record) {
  return [
    record.eoxExternalAnnouncementDate,
    record.endOfSaleDate,
    record.endOfSwMaintenance,
    record.endOfSecuritySupport,
    record.endOfRoutineFailureAnalysis,
    record.endOfServiceContractRenewal,
    record.lastDateOfSupport,
    record.endOfServiceAttach,
  ];
}

function formatOsTypeSuffix(osType) {
  return osType ? ` (${osType})` : "";
}

function formatPartialMessage(release, osType) {
  return `${release}${formatOsTypeSuffix(osType)}: Cisco EoX API가 일부 lifecycle 필드만 반환함`;
}

function formatUnknownMessage(release, osType) {
  return `${release}${formatOsTypeSuffix(osType)}: Cisco EoX API 응답을 해석할 수 없거나 매칭된 EOXRecord가 없음`;
}

function serializeRecord(release, fallbackOsType, record) {
  return {
    release,
    osType: record?.osType ?? fallbackOsType ?? null,
    status: record?.status ?? UNKNOWN_ERROR,
    lastDateOfSupport: record?.lastDateOfSupport ?? null,
    message: record?.userMessage ?? formatUnknownMessage(release, fallbackOsType),
    matchedProductId: record?.eolProductId ?? null,
    matchedDescription: record?.productDescription ?? null,
    productBulletinNumber: record?.productBulletinNumber ?? null,
    bulletinUrl: record?.bulletinUrl ?? null,
    errorId: record?.error?.errorId ?? null,
    errorDescription: record?.error?.errorDescription ?? null,
    errorDataType: record?.error?.errorDataType ?? null,
    errorDataValue: record?.error?.errorDataValue ?? null,
  };
}

function jsonResponse(payload, status) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}
