import { getAccessToken, jsonResponse } from "../_shared/cisco.js";
import { parseDelimitedInput } from "../_shared/parsers.js";

const PRODUCT_INFO_BASE_URL = "https://apix.cisco.com/product/v1/information";
const SN2INFO_BASE_URL = "https://apix.cisco.com/sn2info/v2";

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

    let results;
    try {
      results = lookupType === "serial"
        ? await lookupSerials(token, values)
        : await lookupProductIds(token, values);
    } catch (error) {
      results = values.map((input) => buildErrorResult(input, lookupType, error));
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

async function lookupSerials(token, values) {
  const coverageMap = await fetchSerialCoverage(token, values);
  const ownerMap = await fetchSerialOwnerStatus(token, values);
  const infoMap = await fetchProductInfoBySerials(token, values);

  return values.map((input) => {
    const coverage = coverageMap.get(input);
    const owner = ownerMap.get(input);
    const info = infoMap.get(input);

    if (!coverage && !owner && !info) {
      return {
        input,
        lookupType: "serial",
        status: "not_found",
        serialNumber: input,
        productId: null,
        orderablePid: null,
        description: null,
        coverageStatus: null,
        ownerCoverageStatus: null,
        productFamily: null,
        productName: null,
        message: "조회 결과가 없습니다.",
        raw: {},
      };
    }

    return {
      input,
      lookupType: "serial",
      status: "found",
      serialNumber: input,
      productId: info?.base_pid ?? null,
      orderablePid: info?.orderable_pid ?? null,
      description: info?.product_name ?? null,
      productName: info?.product_name ?? null,
      productFamily: info?.product_series ?? null,
      coverageStatus: coverage?.is_covered ?? owner?.is_covered ?? null,
      coverageEndDate: coverage?.coverage_end_date ?? owner?.coverage_end_date ?? null,
      ownerCoverageStatus: owner?.sr_no_owner ?? null,
      productType: info?.product_type ?? null,
      message: null,
      raw: {
        coverage,
        ownerCoverage: owner,
        productInfo: info,
      },
    };
  });
}

async function lookupProductIds(token, values) {
  const results = [];
  for (const batch of chunk(values, 5)) {
    const url = new URL(`${PRODUCT_INFO_BASE_URL}/product_ids/${batch.join(",")}`);
    url.searchParams.set("page_index", "1");
    const payload = await ciscoGetJson(token, url.toString(), "Product Information API");
    const productList = Array.isArray(payload?.product_list) ? payload.product_list : [];

    for (const value of batch) {
      const matches = productList.filter((item) => String(item?.product_id ?? "").trim() === value);
      if (!matches.length) {
        results.push({
          input: value,
          lookupType: "pid",
          status: "not_found",
          serialNumber: null,
          productId: value,
          orderablePid: null,
          description: null,
          productName: null,
          productFamily: null,
          productType: null,
          message: "조회 결과가 없습니다.",
          raw: {},
        });
        continue;
      }

      const primary = matches[0];
      results.push({
        input: value,
        lookupType: "pid",
        status: "found",
        serialNumber: null,
        productId: primary?.product_id ?? value,
        orderablePid: null,
        description: primary?.product_name ?? null,
        productName: primary?.product_name ?? null,
        productFamily: primary?.product_series ?? null,
        productType: primary?.product_type ?? null,
        orderableStatus: primary?.orderable_status ?? null,
        productCategory: primary?.product_category ?? null,
        productSubcategory: primary?.product_subcategory ?? null,
        releaseDate: primary?.release_date ?? null,
        message: null,
        raw: {
          matches,
        },
      });
    }
  }

  return results;
}

async function fetchSerialCoverage(token, values) {
  const results = new Map();
  for (const batch of chunk(values, 75)) {
    const url = `${SN2INFO_BASE_URL}/coverage/status/serial_numbers/${batch.join(",")}`;
    const payload = await ciscoGetJson(token, url, "Serial Number to Information API");
    for (const item of payload?.serial_numbers ?? []) {
      const key = String(item?.sr_no ?? "").trim();
      if (key) {
        results.set(key, item);
      }
    }
  }
  return results;
}

async function fetchSerialOwnerStatus(token, values) {
  const results = new Map();
  for (const batch of chunk(values, 75)) {
    const url = `${SN2INFO_BASE_URL}/coverage/owner_status/serial_numbers/${batch.join(",")}`;
    const payload = await ciscoGetJson(token, url, "Serial Number to Information API");
    for (const item of payload?.serial_numbers ?? []) {
      const key = String(item?.sr_no ?? "").trim();
      if (key) {
        results.set(key, item);
      }
    }
  }
  return results;
}

async function fetchProductInfoBySerials(token, values) {
  const results = new Map();
  for (const batch of chunk(values, 5)) {
    const url = new URL(`${PRODUCT_INFO_BASE_URL}/serial_numbers/${batch.join(",")}`);
    url.searchParams.set("page_index", "1");
    const payload = await ciscoGetJson(token, url.toString(), "Product Information API");
    for (const item of payload?.product_list ?? []) {
      const key = String(item?.sr_no ?? "").trim();
      if (key && !results.has(key)) {
        results.set(key, item);
      }
    }
  }
  return results;
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

function chunk(values, size) {
  const buckets = [];
  for (let index = 0; index < values.length; index += size) {
    buckets.push(values.slice(index, index + size));
  }
  return buckets;
}

function buildErrorResult(input, lookupType, error) {
  return {
    input,
    lookupType,
    status: "error",
    productId: lookupType === "pid" ? input : null,
    serialNumber: lookupType === "serial" ? input : null,
    orderablePid: null,
    description: null,
    coverageStatus: null,
    ownerCoverageStatus: null,
    productFamily: null,
    productName: null,
    productType: null,
    message: error instanceof Error ? error.message : "Cisco API 요청 중 오류가 발생했습니다.",
    raw: {},
  };
}
