const form = document.getElementById("search-form");
const modeButtons = [...document.querySelectorAll(".mode-button")];
const heroTitle = document.getElementById("hero-title");
const heroCopy = document.getElementById("hero-copy");
const dataSourceCopy = document.getElementById("data-source-copy");
const hardwareLookupField = document.getElementById("hardware-lookup-field");
const hardwareLookupTypeSelect = document.getElementById("hardware-lookup-type");
const searchInputLabel = document.getElementById("search-input-label");
const searchValuesInput = document.getElementById("search-values");
const searchInputHelp = document.getElementById("search-input-help");
const searchPanelCopy = document.getElementById("search-panel-copy");
const osTypeField = document.getElementById("os-type-field");
const osTypeSelect = document.getElementById("os-type");
const submitButton = document.getElementById("submit-button");
const emptyCopy = document.getElementById("empty-copy");
const resultSummary = document.getElementById("result-summary");
const resultEmpty = document.getElementById("result-empty");
const resultShell = document.getElementById("result-shell");
const resultsHead = document.getElementById("results-head");
const resultsBody = document.getElementById("results-body");

let currentQueryTarget = "os";

const QUERY_MODE_CONFIG = {
  os: {
    title: "OS 만료기한 조회",
    copy: "OS 버전과 선택형 OS 타입을 입력해 Cisco End-of-Support 정보를 조회합니다.",
    source: "Cisco End-of-Life and End-of-Life (EoX) API",
    panelCopy: "여러 OS 버전은 쉼표로 구분해서 입력할 수 있습니다.",
    inputLabel: "OS 버전",
    inputPlaceholder: "예) 17.9.5, 17.11.1a, 10.3(6)",
    inputHelp: "CLI와 동일하게 exact software release string 기준으로 조회합니다.",
    submitText: "조회하기",
    loadingText: "조회 중...",
    emptyCopy: "위에서 OS 버전과 선택형 OS 타입을 입력한 뒤 조회 버튼을 눌러주세요.",
  },
  "os-recommend": {
    title: "권장 OS 조회",
    copy: "장비 PID를 입력해 Cisco Software Suggestion API 기반 권장 OS와 지원 종료 정보를 조회합니다.",
    source: "Cisco Software Suggestion API + Cisco End-of-Life and End-of-Life (EoX) API",
    panelCopy: "여러 PID는 쉼표로 구분해서 입력할 수 있습니다.",
    inputLabel: "장비 PID",
    inputPlaceholder: "예) C9200, ASR1001-X, N9K-C93180YC-EX",
    inputHelp: "PID별 권장 OS를 조회한 뒤 해당 릴리스의 Last Date of Support를 함께 확인합니다.",
    submitText: "OS 추천 조회",
    loadingText: "OS 추천 조회 중...",
    emptyCopy: "위에서 장비 PID를 입력한 뒤 OS 추천 조회 버튼을 눌러주세요.",
  },
  hardware: {
    title: "하드웨어 조회",
    copy: "Serial Number 또는 Product ID를 입력해 Cisco EoX 기준 하드웨어 종료 정보를 조회합니다.",
    source: "Cisco End-of-Life and End-of-Life (EoX) API",
    panelCopy: "여러 하드웨어 식별자는 줄바꿈 또는 쉼표로 구분해서 입력할 수 있습니다.",
    inputLabel: "하드웨어 식별자",
    inputHelpSerial: "쉼표 또는 줄바꿈으로 여러 Serial Number를 입력할 수 있습니다.",
    inputHelpPid: "쉼표 또는 줄바꿈으로 여러 Product ID / PID를 입력할 수 있습니다.",
    inputPlaceholderSerial: "예) FOC1234XXXX, FOC5678YYYY",
    inputPlaceholderPid: "예) C9300-48P-A, C9200L-24T-4G",
    submitText: "하드웨어 조회",
    loadingText: "하드웨어 조회 중...",
    emptyCopy: "위에서 하드웨어 식별자와 조회 타입을 입력한 뒤 조회 버튼을 눌러주세요.",
  },
};

modeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const nextTarget = button.dataset.target;
    if (!nextTarget || nextTarget === currentQueryTarget) {
      return;
    }
    currentQueryTarget = nextTarget;
    syncFormByQueryTarget();
  });
});

hardwareLookupTypeSelect.addEventListener("change", syncFormByQueryTarget);
form.addEventListener("submit", handleSubmit);

syncFormByQueryTarget();

async function handleSubmit(event) {
  event.preventDefault();
  const target = currentQueryTarget;
  const endpoint = target === "hardware"
    ? "/api/hardware-search"
    : target === "os-recommend"
      ? "/api/os-recommend"
      : "/api/eox-search";
  const payload = buildPayloadByQueryTarget(target);

  setLoadingState(true);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "조회 중 오류가 발생했습니다.");
    }

    if (target === "hardware") {
      renderHardwareResults(data.results || [], data.lookupType || hardwareLookupTypeSelect.value);
      return;
    }
    if (target === "os-recommend") {
      renderRecommendationResults(data.results || []);
      return;
    }
    renderOsResults(data.results || []);
  } catch (error) {
    renderError(error.message);
  } finally {
    setLoadingState(false);
  }
}

function buildPayloadByQueryTarget(target) {
  if (target === "hardware") {
    return {
      lookupType: hardwareLookupTypeSelect.value,
      values: searchValuesInput.value,
    };
  }
  if (target === "os-recommend") {
    return {
      values: searchValuesInput.value,
    };
  }
  return {
    releases: searchValuesInput.value,
    osType: osTypeSelect.value || null,
  };
}

function syncFormByQueryTarget() {
  const isHardware = currentQueryTarget === "hardware";
  const config = QUERY_MODE_CONFIG[currentQueryTarget];

  modeButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.target === currentQueryTarget);
  });

  hardwareLookupField.hidden = !isHardware;
  osTypeField.hidden = isHardware || currentQueryTarget === "os-recommend";

  heroTitle.textContent = config.title;
  heroCopy.textContent = config.copy;
  dataSourceCopy.textContent = config.source;
  searchPanelCopy.textContent = config.panelCopy;
  searchInputLabel.textContent = config.inputLabel;
  submitButton.textContent = config.submitText;
  emptyCopy.textContent = config.emptyCopy;

  if (isHardware) {
    const lookupType = hardwareLookupTypeSelect.value;
    searchValuesInput.placeholder = lookupType === "serial" ? config.inputPlaceholderSerial : config.inputPlaceholderPid;
    searchInputHelp.textContent = lookupType === "serial" ? config.inputHelpSerial : config.inputHelpPid;
  } else {
    searchValuesInput.placeholder = config.inputPlaceholder;
    searchInputHelp.textContent = config.inputHelp;
  }
}

function setLoadingState(isLoading) {
  submitButton.disabled = isLoading;
  if (isLoading) {
    submitButton.textContent = QUERY_MODE_CONFIG[currentQueryTarget].loadingText;
    return;
  }
  syncFormByQueryTarget();
}

function renderOsResults(results) {
  if (!results.length) {
    renderError("조회 결과가 없습니다.");
    return;
  }

  const searchedAt = formatKoreanTimestamp(new Date());
  showResults(`${results.length}건의 software release 조회 결과입니다.`);

  resultsHead.innerHTML = `
    <tr>
      <th>OS 버전</th>
      <th>OS 타입</th>
      <th>LastDate</th>
      <th>상태</th>
      <th>Description</th>
      <th>Migration Strategy</th>
      <th>조회 일시</th>
      <th>전체 응답</th>
    </tr>
  `;
  resultsBody.innerHTML = "";

  results.forEach((item, index) => {
    const selectedMatch = pickSelectedMatch(item);
    const rowRef = { item, selectedMatch, searchedAt };
    const mainRow = document.createElement("tr");
    mainRow.className = "results-main-row";
    const detailRowId = `os-detail-${index}`;

    mainRow.innerHTML = `
      <td class="results-cell-strong" data-role="release"></td>
      <td data-role="os-type"></td>
      <td data-role="last-date"></td>
      <td data-role="status"></td>
      <td data-role="description"></td>
      <td data-role="migration"></td>
      <td data-role="timestamp"></td>
      <td>
        <button type="button" class="inline-toggle" aria-expanded="false" data-detail-id="${detailRowId}">전체 응답 펼치기</button>
      </td>
    `;

    const detailRow = document.createElement("tr");
    detailRow.id = detailRowId;
    detailRow.className = "results-detail-row";
    detailRow.hidden = true;
    detailRow.innerHTML = `
      <td colspan="8">
        <div class="detail-panel">
          <div class="detail-summary">${escapeHtml(item.release)}에 대해 Cisco EoX API가 반환한 전체 응답 ${item.allMatches?.length || 0}건</div>
          <div class="detail-table-wrap">
            <table class="detail-table">
              <thead>
                <tr>
                  <th>No</th>
                  <th>PID</th>
                  <th>Description</th>
                  <th>LastDate</th>
                  <th>Migration Strategy</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody></tbody>
            </table>
          </div>
        </div>
      </td>
    `;

    const detailBody = detailRow.querySelector("tbody");
    (item.allMatches || []).forEach((match, matchIndex) => {
      const matchRow = document.createElement("tr");
      const selector = document.createElement("button");
      selector.type = "button";
      selector.className = "candidate-select";
      selector.textContent = String(matchIndex + 1);
      selector.addEventListener("click", () => {
        rowRef.selectedMatch = match;
        updateOsSummaryRow(mainRow, rowRef);
        highlightSelectedRow(detailBody, matchRow);
      });

      const selectorCell = document.createElement("td");
      selectorCell.appendChild(selector);
      matchRow.appendChild(selectorCell);
      matchRow.innerHTML += `
        <td>${escapeHtml(match.eolProductId || "-")}</td>
        <td>${escapeHtml(match.productDescription || "-")}</td>
        <td>${escapeHtml(match.lastDateOfSupport || "-")}</td>
        <td>${escapeHtml(match.migrationStrategy || match.migrationInformation || "-")}</td>
        <td>${renderStatusBadge(match.status || "UNKNOWN", false)}</td>
      `;
      detailBody.appendChild(matchRow);

      if (isSameMatch(match, selectedMatch)) {
        highlightSelectedRow(detailBody, matchRow);
      }
    });

    const toggleButton = mainRow.querySelector(".inline-toggle");
    toggleButton.addEventListener("click", () => {
      const expanded = toggleButton.getAttribute("aria-expanded") === "true";
      toggleButton.setAttribute("aria-expanded", String(!expanded));
      toggleButton.textContent = expanded ? "전체 응답 펼치기" : "전체 응답 접기";
      detailRow.hidden = expanded;
    });

    updateOsSummaryRow(mainRow, rowRef);
    resultsBody.appendChild(mainRow);
    resultsBody.appendChild(detailRow);
  });
}

function updateOsSummaryRow(mainRow, rowRef) {
  const { item, selectedMatch, searchedAt } = rowRef;
  const summaryMatch = selectedMatch || {};
  mainRow.querySelector('[data-role="release"]').textContent = item.release;
  mainRow.querySelector('[data-role="os-type"]').textContent = summaryMatch.osType || item.osType || "미지정";
  mainRow.querySelector('[data-role="last-date"]').innerHTML = renderMetric(summaryMatch.lastDateOfSupport || item.lastDateOfSupport || "-");
  mainRow.querySelector('[data-role="status"]').innerHTML = renderStatusBadge(summaryMatch.status || item.status || "UNKNOWN", true);
  mainRow.querySelector('[data-role="description"]').textContent = summaryMatch.productDescription || item.matchedDescription || "-";
  mainRow.querySelector('[data-role="migration"]').textContent = summaryMatch.migrationStrategy || summaryMatch.migrationInformation || "-";
  mainRow.querySelector('[data-role="timestamp"]').textContent = searchedAt;
}

function renderRecommendationResults(results) {
  if (!results.length) {
    renderError("조회 결과가 없습니다.");
    return;
  }

  const searchedAt = formatKoreanTimestamp(new Date());
  showResults(`${results.length}건의 PID 권장 OS 조회 결과입니다.`);

  resultsHead.innerHTML = `
    <tr>
      <th>PID</th>
      <th>Product</th>
      <th>Recommended OS</th>
      <th>OS Type</th>
      <th>LastDate</th>
      <th>Release Label</th>
      <th>상태</th>
      <th>Note</th>
      <th>조회 일시</th>
    </tr>
  `;

  resultsBody.innerHTML = results.map((item) => `
    <tr>
      <td class="results-cell-strong">${escapeHtml(item.pid || "-")}</td>
      <td>${escapeHtml(item.productName || "-")}</td>
      <td>${escapeHtml(item.recommendedRelease || "-")}</td>
      <td>${escapeHtml(item.osType || "미지정")}</td>
      <td>${renderMetric(item.lastDateOfSupport || "-")}</td>
      <td>${escapeHtml(item.releaseLabel || "-")}</td>
      <td>${renderStatusBadge(String(item.status || "UNKNOWN"), true)}</td>
      <td>${escapeHtml(item.note || "-")}</td>
      <td>${escapeHtml(searchedAt)}</td>
    </tr>
  `).join("");
}

function renderHardwareResults(results, lookupType) {
  if (!results.length) {
    renderError("조회 결과가 없습니다.");
    return;
  }

  const searchedAt = formatKoreanTimestamp(new Date());
  showResults(`${results.length}건의 hardware 조회 결과입니다.`);

  resultsHead.innerHTML = `
    <tr>
      <th>입력값</th>
      <th>조회 타입</th>
      <th>Product ID</th>
      <th>Description</th>
      <th>LastDate</th>
      <th>Product Bulletin</th>
      <th>Migration Product ID</th>
      <th>Migration Strategy</th>
      <th>상태</th>
      <th>조회 일시</th>
      <th>메시지</th>
    </tr>
  `;

  const lookupTypeLabel = lookupType === "serial" ? "Serial Number" : "Product ID / PID";
  resultsBody.innerHTML = results.map((item) => `
    <tr>
      <td class="results-cell-strong">${escapeHtml(item.input || "-")}</td>
      <td>${escapeHtml(lookupTypeLabel)}</td>
      <td>${escapeHtml(item.productId || "-")}</td>
      <td>${escapeHtml(item.description || "-")}</td>
      <td>${renderMetric(item.lastDateOfSupport || "-")}</td>
      <td>${escapeHtml(item.productBulletinNumber || "-")}</td>
      <td>${escapeHtml(item.migrationProductId || "-")}</td>
      <td>${escapeHtml(item.migrationStrategy || "-")}</td>
      <td>${renderStatusBadge(mapHardwareStatus(item.status), true)}</td>
      <td>${escapeHtml(searchedAt)}</td>
      <td>${escapeHtml(buildHardwareMessage(item))}</td>
    </tr>
  `).join("");
}

function showResults(summaryText) {
  resultSummary.textContent = summaryText;
  resultEmpty.hidden = true;
  resultShell.hidden = false;
}

function renderError(message) {
  resultSummary.textContent = message;
  resultShell.hidden = true;
  resultsHead.innerHTML = "";
  resultsBody.innerHTML = "";
  resultEmpty.hidden = false;
}

function renderMetric(value) {
  const text = escapeHtml(value || "-");
  return `<span class="metric-value">${text}</span>`;
}

function renderStatusBadge(status, compact) {
  const normalized = String(status || "UNKNOWN").toUpperCase();
  const tone = resolveStatusTone(normalized);
  const label = mapStatusLabel(normalized);
  return `<span class="status-chip status-chip-${tone}${compact ? " status-chip-compact" : ""}">${escapeHtml(label)}</span>`;
}

function resolveStatusTone(status) {
  if (["OK", "SUCCESS_WITH_DATES", "FOUND"].includes(status)) {
    return "ok";
  }
  if (["PARTIAL_RECORD"].includes(status)) {
    return "warn";
  }
  if (["NOT_FOUND", "ERROR", "INVALID_OS_TYPE", "NO_SOFTWARE_MATCH", "PRODUCT_ID_NO_EOX", "PRODUCT_BULLETIN_NO_EOX", "UNKNOWN_ERROR"].includes(status)) {
    return "err";
  }
  return "neutral";
}

function mapStatusLabel(status) {
  const labelMap = {
    OK: "조회 완료",
    FOUND: "조회 완료",
    SUCCESS_WITH_DATES: "지원 종료일 확인",
    PARTIAL_RECORD: "일부 값만 반환",
    INVALID_OS_TYPE: "OS 타입 오류",
    NO_SOFTWARE_MATCH: "매칭 없음",
    PRODUCT_ID_NO_EOX: "EoX 없음",
    PRODUCT_BULLETIN_NO_EOX: "Bulletin만 존재",
    UNKNOWN_ERROR: "확인 필요",
    NOT_FOUND: "조회 결과 없음",
    ERROR: "오류",
  };
  return labelMap[status] || status;
}

function mapHardwareStatus(status) {
  if (status === "found") {
    return "FOUND";
  }
  if (status === "not_found") {
    return "NOT_FOUND";
  }
  return "ERROR";
}

function buildHardwareMessage(item) {
  const parts = [];
  if (item.message) {
    parts.push(item.message);
  }
  if (item.description) {
    parts.push(item.description);
  }
  if (item.lastDateOfSupport) {
    parts.push(`LastDate: ${item.lastDateOfSupport}`);
  }
  if (item.migrationStrategy) {
    parts.push(`Migration: ${item.migrationStrategy}`);
  }
  return parts.join(" | ") || "Cisco API 요청 중 오류가 발생했습니다.";
}

function pickSelectedMatch(item) {
  const matches = item.allMatches || [];
  if (!matches.length) {
    return null;
  }
  return matches.find((match) => isSameMatch(match, {
    eolProductId: item.matchedProductId,
    lastDateOfSupport: item.lastDateOfSupport,
  })) || matches[0];
}

function isSameMatch(left, right) {
  if (!left || !right) {
    return false;
  }
  return left.eolProductId === right.eolProductId && left.lastDateOfSupport === right.lastDateOfSupport;
}

function highlightSelectedRow(tbody, targetRow) {
  [...tbody.querySelectorAll("tr")].forEach((row) => {
    row.classList.toggle("row-selected", row === targetRow);
  });
}

function formatKoreanTimestamp(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  const second = String(date.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
