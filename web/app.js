const form = document.getElementById("search-form");
const releasesInput = document.getElementById("releases");
const osTypeSelect = document.getElementById("os-type");
const resultSummary = document.getElementById("result-summary");
const resultEmpty = document.getElementById("result-empty");
const resultList = document.getElementById("result-list");
const successTemplate = document.getElementById("result-card-template");
const errorTemplate = document.getElementById("result-error-template");

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const payload = {
    releases: releasesInput.value,
    osType: osTypeSelect.value || null,
  };

  setLoadingState(true);

  try {
    const response = await fetch("/api/eox-search", {
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

    renderResults(data.results || []);
  } catch (error) {
    renderError(error.message);
  } finally {
    setLoadingState(false);
  }
});

function setLoadingState(isLoading) {
  const button = form.querySelector("button[type='submit']");
  button.disabled = isLoading;
  button.textContent = isLoading ? "조회 중..." : "조회하기";
}

function renderResults(results) {
  resultList.innerHTML = "";

  if (!results.length) {
    renderError("조회 결과가 없습니다.");
    return;
  }

  resultEmpty.hidden = true;
  resultList.hidden = false;
  resultSummary.textContent = `${results.length}건의 software release 조회 결과입니다.`;

  results.forEach((item) => {
    const hasUsableDate = Boolean(item.lastDateOfSupport);
    const template = hasUsableDate ? successTemplate : errorTemplate;
    const fragment = template.content.cloneNode(true);
    const card = fragment.querySelector(".result-card");
    const normalizedStatus = String(item.status || "").toLowerCase();
    const statusClass = hasUsableDate ? "status-usable" : `status-${normalizedStatus}`;
    const statusLabel = hasUsableDate ? "조회 완료" : "확인 필요";
    const osTypeLabel = item.osType || "미지정";
    const searchedAt = formatKoreanTimestamp(new Date());
    const noteText = hasUsableDate
      ? `입력하신 OS 버전은 ${item.release} 입니다.`
      : `입력하신 OS 버전 ${item.release} 는 추가 확인이 필요합니다.`;
    const selectedMatch = pickSelectedMatch(item);

    card.querySelector(".input-release-value").textContent = item.release;
    card.querySelector(".input-type-value").textContent = osTypeLabel;
    card.querySelector(".input-note-copy").textContent = noteText;
    card.querySelector(".result-status").textContent = statusLabel;
    card.querySelector(".table-timestamp").textContent = searchedAt;
    card.querySelector(".all-match-summary").textContent =
      `${item.release}에 대해 Cisco EoX API가 반환한 전체 응답 ${item.allMatches?.length || 0}건`;

    card.querySelector(".result-status").classList.add(statusClass);
    bindMatchesToggle(card);
    updateSelectedMatch(card, item, selectedMatch, searchedAt);
    renderAllMatches(card, item, item.allMatches || [], selectedMatch, searchedAt);
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
  const description = selectedMatch?.productDescription || item.matchedDescription || "-";
  const migrationStrategy = selectedMatch?.migrationStrategy || selectedMatch?.migrationInformation || "-";
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
    dateNode.textContent = selectedMatch?.lastDateOfSupport || "날짜 정보 없음";
    pillNode.textContent = hasUsableDate ? "선택된 응답" : "날짜 없음";
  }
  if (errorNode) {
    errorNode.textContent = selectedMatch?.status || item.status || "UNKNOWN_ERROR";
  }
}

function buildSelectedMessage(item, selectedMatch) {
  if (!selectedMatch) {
    return item.message || "Cisco EoX API 응답을 해석할 수 없습니다.";
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

function pickSelectedMatch(item) {
  const matches = item.allMatches || [];
  if (!matches.length) {
    return null;
  }
  const exactMatch = matches.find((match) => {
    return (
      match.lastDateOfSupport === item.lastDateOfSupport &&
      (match.eolProductId === item.matchedProductId || item.matchedProductId == null)
    );
  });
  return exactMatch || matches[0];
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
