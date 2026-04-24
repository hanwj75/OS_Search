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
const resultList = document.getElementById("result-list");
const successTemplate = document.getElementById("result-card-template");
const errorTemplate = document.getElementById("result-error-template");
const hardwareTemplate = document.getElementById("hardware-card-template");
const HIDDEN_OS_MATCH_STATUS = "PRODUCT_BULLETIN_NO_EOX";
const UNAVAILABLE_TEXT = "조회되지 않는 값";
let currentQueryTarget = "os";

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
  const isHardware = target === "hardware";
  const endpoint = isHardware ? "/api/hardware-search" : "/api/eox-search";
  const payload = isHardware
    ? {
        lookupType: hardwareLookupTypeSelect.value,
        values: searchValuesInput.value,
      }
    : {
        releases: searchValuesInput.value,
        osType: osTypeSelect.value || null,
      };

  setLoadingState(true);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "조회 중 오류가 발생했습니다.");
    }

    if (isHardware) {
      renderHardwareResults(data.results || [], data.lookupType || hardwareLookupTypeSelect.value);
    } else {
      renderOsResults(data.results || []);
    }
  } catch (error) {
    renderError(error.message);
  } finally {
    setLoadingState(false);
  }
}

function syncFormByQueryTarget() {
  const isHardware = currentQueryTarget === "hardware";
  modeButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.target === currentQueryTarget);
  });
  hardwareLookupField.hidden = !isHardware;
  osTypeField.hidden = isHardware;

  if (isHardware) {
    const lookupType = hardwareLookupTypeSelect.value;
    heroTitle.textContent = "하드웨어 조회";
    heroCopy.textContent = "Serial Number 또는 Product ID를 입력해 Cisco EoX 기준 하드웨어 종료 정보를 조회합니다.";
    dataSourceCopy.textContent = "Cisco End-of-Life and End-of-Life (EoX) API";
    searchPanelCopy.textContent = "여러 하드웨어 식별자는 줄바꿈 또는 쉼표로 구분해서 입력할 수 있습니다.";
    searchInputLabel.textContent = "하드웨어 식별자";
    searchValuesInput.placeholder = lookupType === "serial"
      ? "예) FOC1234XXXX, FOC5678YYYY"
      : "예) C9300-48P-A, C9200L-24T-4G";
    searchInputHelp.textContent = lookupType === "serial"
      ? "쉼표 또는 줄바꿈으로 여러 Serial Number를 입력할 수 있습니다."
      : "쉼표 또는 줄바꿈으로 여러 Product ID / PID를 입력할 수 있습니다.";
    submitButton.textContent = "하드웨어 조회";
    emptyCopy.textContent = "위에서 하드웨어 식별자와 조회 타입을 입력한 뒤 조회 버튼을 눌러주세요.";
  } else {
    heroTitle.textContent = "OS 만료기한 조회";
    heroCopy.textContent = "OS 버전과 선택형 OS 타입을 입력해 Cisco End-of-Support 정보를 조회합니다.";
    dataSourceCopy.textContent = "Cisco End-of-Life and End-of-Life (EoX) API";
    searchPanelCopy.textContent = "여러 OS 버전은 쉼표로 구분해서 입력할 수 있습니다.";
    searchInputLabel.textContent = "OS 버전";
    searchValuesInput.placeholder = "예) 17.9.5, 17.11.1a, 10.3(6)";
    searchInputHelp.textContent = "CLI와 동일하게 exact software release string 기준으로 조회합니다.";
    submitButton.textContent = "조회하기";
    emptyCopy.textContent = "위에서 OS 버전과 선택형 OS 타입을 입력한 뒤 조회 버튼을 눌러주세요.";
  }
}

function setLoadingState(isLoading) {
  submitButton.disabled = isLoading;
  if (isLoading) {
    submitButton.textContent = currentQueryTarget === "hardware" ? "하드웨어 조회 중..." : "조회 중...";
  } else {
    syncFormByQueryTarget();
  }
}

function renderOsResults(results) {
  resultList.innerHTML = "";

  if (!results.length) {
    renderError("조회 결과가 없습니다.");
    return;
  }

  resultEmpty.hidden = true;
  resultList.hidden = false;
  resultSummary.textContent = `${results.length}건의 software release 조회 결과입니다.`;

  results.forEach((item) => {
    const visibleMatches = getVisibleOsMatches(item);
    const hasUsableDate = Boolean(item.lastDateOfSupport);
    const hasVisibleMatches = visibleMatches.length > 0;
    const template = hasUsableDate ? successTemplate : errorTemplate;
    const fragment = template.content.cloneNode(true);
    const card = fragment.querySelector(".result-card");
    const normalizedStatus = String(item.status || "").toLowerCase();
    const statusClass = hasUsableDate ? "status-usable" : `status-${normalizedStatus}`;
    const statusLabel = hasUsableDate ? "조회 완료" : hasVisibleMatches ? "확인 필요" : "조회 결과 없음";
    const osTypeLabel = item.osType || "미지정";
    const searchedAt = formatKoreanTimestamp(new Date());
    const noteText = hasVisibleMatches
      ? (hasUsableDate
      ? `입력하신 OS 버전은 ${item.release} 입니다.`
      : `입력하신 OS 버전 ${item.release} 는 추가 확인이 필요합니다.`)
      : `입력하신 OS 버전 ${item.release} 는 조회되지 않는 값입니다.`;
    const selectedMatch = pickSelectedMatch(item, visibleMatches);

    card.querySelector(".input-release-value").textContent = item.release;
    card.querySelector(".input-type-value").textContent = osTypeLabel;
    card.querySelector(".input-note-copy").textContent = noteText;
    card.querySelector(".result-status").textContent = statusLabel;
    card.querySelector(".table-timestamp").textContent = searchedAt;
    card.querySelector(".all-match-summary").textContent =
      visibleMatches.length
        ? `${item.release}에 대해 Cisco EoX API가 반환한 표시 가능 응답 ${visibleMatches.length}건`
        : `${item.release}에 대해 표시할 수 있는 EoX 응답이 없습니다.`;

    card.querySelector(".result-status").classList.add(statusClass);
    bindMatchesToggle(card);
    updateSelectedMatch(card, item, selectedMatch, searchedAt);
    renderAllMatches(card, item, visibleMatches, selectedMatch, searchedAt);
    resultList.appendChild(fragment);
  });
}

function renderHardwareResults(results, lookupType) {
  resultList.innerHTML = "";

  if (!results.length) {
    renderError("조회 결과가 없습니다.");
    return;
  }

  resultEmpty.hidden = true;
  resultList.hidden = false;
  resultSummary.textContent = `${results.length}건의 hardware 조회 결과입니다.`;

  results.forEach((item) => {
    const fragment = hardwareTemplate.content.cloneNode(true);
    const card = fragment.querySelector(".result-card");
    const searchedAt = formatKoreanTimestamp(new Date());
    const statusNode = card.querySelector(".hardware-status");
    const statusKey = String(item.status || "error").toLowerCase();
    const statusLabel = item.status === "found" ? "조회 완료" : item.status === "not_found" ? "조회 결과 없음" : "오류";

    statusNode.textContent = statusLabel;
    statusNode.classList.add(statusKey === "found" ? "status-usable" : "status-unknown_error");

    card.querySelector(".hardware-input-value").textContent = item.input || "-";
    card.querySelector(".hardware-lookup-value").textContent = lookupType === "serial" ? "Serial Number" : "Product ID / PID";
    card.querySelector(".hardware-note-copy").textContent = item.status === "found"
      ? `${item.input}에 대한 EoX 하드웨어 조회 결과입니다.`
      : item.message || "조회 결과가 없습니다.";
    card.querySelector(".hardware-product-id").textContent = item.productId || "-";
    card.querySelector(".hardware-input-display").textContent = item.serialNumber || item.input || "-";
    card.querySelector(".hardware-description").textContent = item.description || "-";
    card.querySelector(".hardware-last-date").textContent = item.lastDateOfSupport || "-";
    card.querySelector(".hardware-product-bulletin").textContent = item.productBulletinNumber || "-";
    card.querySelector(".hardware-migration-product-id").textContent = item.migrationProductId || "-";
    card.querySelector(".hardware-migration-strategy").textContent = item.migrationStrategy || "-";
    card.querySelector(".hardware-bulletin-url").textContent = item.bulletinUrl || "-";
    card.querySelector(".hardware-timestamp").textContent = searchedAt;
    card.querySelector(".hardware-message").textContent = buildHardwareMessage(item);

    resultList.appendChild(fragment);
  });
}

function renderError(message) {
  resultEmpty.hidden = false;
  resultList.hidden = true;
  resultList.innerHTML = "";
  resultSummary.textContent = message;
}

function renderAllMatches(card, item, matches, selectedMatch, searchedAt) {
  const tbody = card.querySelector(".all-match-body");
  tbody.innerHTML = "";
  let selectedRow = null;

  if (!matches.length) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td colspan="6">${escapeHtml(`${item.release}: ${UNAVAILABLE_TEXT}`)}</td>
    `;
    tbody.appendChild(row);
    return;
  }

  matches.forEach((match, index) => {
    const row = document.createElement("tr");
    const noButton = document.createElement("button");
    noButton.type = "button";
    noButton.className = "candidate-select";
    noButton.textContent = String(index + 1);
    noButton.addEventListener("click", () => {
      updateSelectedMatch(card, item, match, searchedAt);
      highlightSelectedRow(tbody, row);
    });

    const firstCell = document.createElement("td");
    firstCell.appendChild(noButton);

    row.innerHTML = `
      <td>${escapeHtml(match.eolProductId || "-")}</td>
      <td>
        <div class="candidate-description">${escapeHtml(match.productDescription || "-")}</div>
      </td>
      <td>${escapeHtml(match.lastDateOfSupport || "-")}</td>
      <td>
        <div class="candidate-migration">${escapeHtml(match.migrationStrategy || match.migrationInformation || "-")}</div>
      </td>
      <td><span class="candidate-status candidate-status-${String(match.status || "unknown").toLowerCase()}">${escapeHtml(match.status || "UNKNOWN")}</span></td>
    `;
    row.prepend(firstCell);
    tbody.appendChild(row);

    if (
      selectedMatch &&
      match.eolProductId === selectedMatch.eolProductId &&
      match.lastDateOfSupport === selectedMatch.lastDateOfSupport
    ) {
      selectedRow = row;
    }
  });

  if (selectedRow) {
    highlightSelectedRow(tbody, selectedRow);
  } else if (tbody.firstElementChild) {
    highlightSelectedRow(tbody, tbody.firstElementChild);
  }
}

function updateSelectedMatch(card, item, selectedMatch, searchedAt) {
  const hasUsableDate = Boolean(selectedMatch?.lastDateOfSupport);
  const osTypeLabel = selectedMatch?.osType || item.osType || "미지정";
  const description = selectedMatch?.productDescription || item.matchedDescription || UNAVAILABLE_TEXT;
  const migrationStrategy = selectedMatch?.migrationStrategy || selectedMatch?.migrationInformation || UNAVAILABLE_TEXT;
  const message = buildSelectedMessage(item, selectedMatch);

  card.querySelector(".table-release").textContent = item.release;
  card.querySelector(".table-type").textContent = osTypeLabel;
  card.querySelector(".table-description").textContent = description;
  card.querySelector(".table-migration-strategy").textContent = migrationStrategy;
  card.querySelector(".table-timestamp").textContent = searchedAt;
  card.querySelector(".result-message").textContent = message;

  const dateNode = card.querySelector(".table-date");
  const pillNode = card.querySelector(".table-pill");
  const errorNode = card.querySelector(".table-error-state");
  if (dateNode && pillNode) {
    dateNode.textContent = selectedMatch?.lastDateOfSupport || UNAVAILABLE_TEXT;
    pillNode.textContent = hasUsableDate ? "선택된 응답" : "날짜 없음";
  }
  if (errorNode) {
    errorNode.textContent = selectedMatch?.status || item.status || "UNKNOWN_ERROR";
  }
}

function buildSelectedMessage(item, selectedMatch) {
  if (!selectedMatch) {
    return `${item.release}: ${UNAVAILABLE_TEXT}`;
  }
  const parts = [];
  if (selectedMatch.productDescription) {
    parts.push(selectedMatch.productDescription);
  }
  if (selectedMatch.migrationStrategy) {
    parts.push(`Migration: ${selectedMatch.migrationStrategy}`);
  } else if (selectedMatch.migrationInformation) {
    parts.push(`Migration: ${selectedMatch.migrationInformation}`);
  }
  if (selectedMatch.errorDescription) {
    parts.push(selectedMatch.errorDescription);
  }
  return parts.join(" | ") || item.message || "Cisco EoX API 응답을 해석할 수 없습니다.";
}

function buildHardwareMessage(item) {
  const parts = [];
  if (item.description) {
    parts.push(item.description);
  }
  if (item.lastDateOfSupport) {
    parts.push(`LastDate: ${item.lastDateOfSupport}`);
  }
  if (item.migrationStrategy) {
    parts.push(`Migration: ${item.migrationStrategy}`);
  }
  return parts.join(" | ") || item.message || "Cisco API 요청 중 오류가 발생했습니다.";
}

function pickSelectedMatch(item, matches = null) {
  const sourceMatches = matches || getVisibleOsMatches(item);
  if (!sourceMatches.length) {
    return null;
  }
  const exactMatch = sourceMatches.find((match) => {
    return (
      match.lastDateOfSupport === item.lastDateOfSupport &&
      (match.eolProductId === item.matchedProductId || item.matchedProductId == null)
    );
  });
  return exactMatch || sourceMatches[0];
}

function getVisibleOsMatches(item) {
  const matches = item.allMatches || [];
  const visibleMatches = matches.filter((match) => !isHiddenBulletinOnlyMatch(match));
  if (visibleMatches.length) {
    return visibleMatches;
  }

  const representativeMatch = buildRepresentativeOsMatch(item);
  return representativeMatch && !isHiddenBulletinOnlyMatch(representativeMatch)
    ? [representativeMatch]
    : [];
}

function isHiddenBulletinOnlyMatch(match) {
  return (
    String(match?.status || "").toUpperCase() === HIDDEN_OS_MATCH_STATUS &&
    !match?.eolProductId &&
    !match?.productDescription &&
    !match?.lastDateOfSupport
  );
}

function buildRepresentativeOsMatch(item) {
  if (!item) {
    return null;
  }
  return {
    osType: item.osType || null,
    status: item.status || "UNKNOWN_ERROR",
    eolProductId: item.matchedProductId || null,
    productDescription: item.matchedDescription || null,
    lastDateOfSupport: item.lastDateOfSupport || null,
    migrationStrategy: null,
    migrationInformation: null,
  };
}

function bindMatchesToggle(card) {
  const button = card.querySelector(".toggle-matches");
  const wrap = card.querySelector(".matches-wrap");
  if (!button || !wrap) {
    return;
  }
  button.addEventListener("click", () => {
    const expanded = button.getAttribute("aria-expanded") === "true";
    button.setAttribute("aria-expanded", String(!expanded));
    button.textContent = expanded ? "전체 응답 펼치기" : "전체 응답 접기";
    wrap.hidden = expanded;
  });
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
