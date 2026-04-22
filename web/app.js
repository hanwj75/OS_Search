const form = document.getElementById("search-form");
const releasesInput = document.getElementById("releases");
const osTypeSelect = document.getElementById("os-type");
const resultSummary = document.getElementById("result-summary");
const resultEmpty = document.getElementById("result-empty");
const resultList = document.getElementById("result-list");
const template = document.getElementById("result-card-template");

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
    const fragment = template.content.cloneNode(true);
    const card = fragment.querySelector(".result-card");
    const statusClass = `status-${String(item.status || "").toLowerCase()}`;

    fragment.querySelector(".result-release").textContent = item.release;
    fragment.querySelector(".result-type").textContent = item.osType ? `OS Type: ${item.osType}` : "OS Type: 미지정";
    fragment.querySelector(".result-status").textContent = item.status || "UNKNOWN";
    fragment.querySelector(".result-date").textContent = item.lastDateOfSupport || "날짜 정보 없음";
    fragment.querySelector(".result-message").textContent =
      item.message || "Cisco EoX API 응답을 해석할 수 없습니다.";

    card.querySelector(".result-status").classList.add(statusClass);
    resultList.appendChild(fragment);
  });
}

function renderError(message) {
  resultEmpty.hidden = false;
  resultList.hidden = true;
  resultList.innerHTML = "";
  resultSummary.textContent = message;
}
