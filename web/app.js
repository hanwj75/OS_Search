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

    fragment.querySelector(".input-release-value").textContent = item.release;
    fragment.querySelector(".input-type-value").textContent = osTypeLabel;
    fragment.querySelector(".input-note-copy").textContent = noteText;
    fragment.querySelector(".result-status").textContent = statusLabel;
    fragment.querySelector(".table-release").textContent = item.release;
    fragment.querySelector(".table-type").textContent = osTypeLabel;
    fragment.querySelector(".table-timestamp").textContent = searchedAt;
    fragment.querySelector(".result-message").textContent =
      item.message || "Cisco EoX API 응답을 해석할 수 없습니다.";
    fragment.querySelector(".all-match-summary").textContent =
      `${item.release}에 대해 Cisco EoX API가 반환한 전체 응답 ${item.allMatches?.length || 0}건`;

    card.querySelector(".result-status").classList.add(statusClass);

    if (hasUsableDate) {
      fragment.querySelector(".table-date").textContent = item.lastDateOfSupport;
      fragment.querySelector(".table-pill").textContent = "지원 종료 예정";
    } else {
      fragment.querySelector(".table-error-state").textContent = item.status || "UNKNOWN_ERROR";
    }

    renderAllMatches(fragment, item.allMatches || []);
    resultList.appendChild(fragment);
  });
}

function renderError(message) {
  resultEmpty.hidden = false;
  resultList.hidden = true;
  resultList.innerHTML = "";
  resultSummary.textContent = message;
}

function renderAllMatches(fragment, matches) {
  const tbody = fragment.querySelector(".all-match-body");
  tbody.innerHTML = "";

  matches.forEach((match, index) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${index + 1}</td>
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
    tbody.appendChild(row);
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
