let rows = [];
let selectedProgram = "All";
let selectedMetric = "";

const $ = (selector) => document.querySelector(selector);

/* =========================================================
   API HELPER
========================================================= */

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data.error || `Request failed (${response.status})`
    );
  }

  return data;
}

/* =========================================================
   SHOW DASHBOARD
========================================================= */

function showDashboard() {
  const loginView = $("#loginView");
  const appView = $("#appView");

  if (loginView) {
    loginView.classList.add("hidden");
  }

  if (appView) {
    appView.classList.remove("hidden");
  }
}

/* =========================================================
   START
========================================================= */

async function boot() {
  // Emergency demo mode:
  // Open dashboard directly without blocking on login.

  showDashboard();

  try {
    await loadMetrics();
  } catch (error) {
    console.error("Initial load failed:", error);
    showMetricsError(error.message);
  }
}

/* =========================================================
   LOAD METRICS
========================================================= */

async function loadMetrics(forceRefresh = false) {
  try {
    if (forceRefresh) {
      try {
        await api("/api/refresh", {
          method: "POST",
        });
      } catch (error) {
        console.warn("Refresh request failed:", error);
      }
    }

    const result = await api("/api/metrics");

    rows = Array.isArray(result.rows)
      ? result.rows
      : [];

    updateLastUpdated(result.fetchedAt);

    buildPrograms();
    render();

    if (!rows.length) {
      showMetricsError(
        "The dashboard is live, but no readable KR rows were returned from Google Sheets."
      );
    }
  } catch (error) {
    console.error("Metrics load failed:", error);

    showMetricsError(
      error.message ||
        "Unable to load Google Sheet data."
    );
  }
}

/* =========================================================
   REFRESH BUTTON
========================================================= */

const refreshButton = $("#refreshBtn");

if (refreshButton) {
  refreshButton.addEventListener("click", async () => {
    refreshButton.disabled = true;
    refreshButton.textContent = "…";

    try {
      await loadMetrics(true);
    } finally {
      refreshButton.disabled = false;
      refreshButton.textContent = "↻";
    }
  });
}

/* =========================================================
   METRICS ERROR
========================================================= */

function showMetricsError(message) {
  const cards = $("#cards");

  if (!cards) {
    return;
  }

  cards.innerHTML = `
    <div class="metric-card bad">

      <div class="metric-top">

        <div>

          <div class="metric-name">
            Dashboard is live
          </div>

          <div class="metric-owner">
            Waiting for readable Google Sheets data
          </div>

        </div>

        <div class="status bad">
          DATA PENDING
        </div>

      </div>

      <div
        style="
          margin-top:20px;
          color:#8b98a8;
          line-height:1.6;
          font-size:13px;
        "
      >
        ${escapeHtml(
          message ||
            "Unable to read the KR data."
        )}
      </div>

      <div style="margin-top:18px;">

        <button
          id="retryMetricsBtn"
          class="ghost-btn"
          type="button"
        >
          Retry
        </button>

      </div>

    </div>
  `;

  const retryButton = $("#retryMetricsBtn");

  if (retryButton) {
    retryButton.addEventListener("click", () => {
      loadMetrics(true);
    });
  }

  $("#overallScore").textContent = "—";
  $("#onTrack").textContent = "—";
  $("#atRisk").textContent = "—";
  $("#metricCount").textContent = "—";
  $("#syncAge").textContent = "Pending";

  const metricSelect = $("#metricSelect");

  if (metricSelect) {
    metricSelect.innerHTML =
      `<option>No metric data</option>`;
  }

  const chart = $("#chart");

  if (chart) {
    chart.innerHTML = `
      <text
        x="50%"
        y="50%"
        text-anchor="middle"
        fill="#5d6a79"
        font-size="14"
      >
        Waiting for Google Sheets data
      </text>
    `;
  }

  const chartLabels = $("#chartLabels");

  if (chartLabels) {
    chartLabels.innerHTML = "";
  }
}

/* =========================================================
   LAST UPDATED
========================================================= */

function updateLastUpdated(timestamp) {
  const lastUpdated = $("#lastUpdated");
  const syncAge = $("#syncAge");

  if (!timestamp) {
    if (lastUpdated) {
      lastUpdated.textContent = "Waiting for data";
    }

    if (syncAge) {
      syncAge.textContent = "Pending";
    }

    return;
  }

  const date = new Date(timestamp);

  if (lastUpdated) {
    lastUpdated.textContent =
      `Updated ${date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })}`;
  }

  const minutesAgo = Math.max(
    0,
    Math.round(
      (Date.now() - timestamp) / 60000
    )
  );

  if (syncAge) {
    syncAge.textContent =
      minutesAgo <= 0
        ? "just now"
        : `${minutesAgo}m ago`;
  }
}

/* =========================================================
   PROGRAM TABS
========================================================= */

function buildPrograms() {
  const container = $("#programTabs");

  if (!container) {
    return;
  }

  const programs = [
    ...new Set(
      rows
        .map((row) => row.program)
        .filter(Boolean)
        .map((program) =>
          String(program).trim()
        )
    ),
  ].filter(
    (program) =>
      program.toLowerCase() !== "all"
  );

  container.innerHTML = "";

  programs.forEach((program) => {
    const button =
      document.createElement("button");

    button.type = "button";

    button.className =
      "program-tab" +
      (selectedProgram === program
        ? " active"
        : "");

    button.dataset.program = program;

    button.textContent = program;

    button.addEventListener("click", () => {
      selectedProgram = program;
      render();
    });

    container.appendChild(button);
  });

  const allButton =
    document.querySelector(
      ".program-tab[data-program='All']"
    );

  if (allButton) {
    allButton.onclick = () => {
      selectedProgram = "All";
      render();
    };
  }
}

/* =========================================================
   FILTER
========================================================= */

function filteredRows() {
  if (selectedProgram === "All") {
    return rows;
  }

  return rows.filter(
    (row) =>
      String(row.program || "")
        .toLowerCase() ===
      selectedProgram.toLowerCase()
  );
}

/* =========================================================
   GROUP LATEST
========================================================= */

function groupLatest(items) {
  const grouped = new Map();

  items.forEach((row) => {
    const key =
      `${row.metric}|||${row.stakeholder}`;

    const existing = grouped.get(key);

    if (!existing) {
      grouped.set(key, row);
      return;
    }

    const currentMonth =
      String(row.month || "");

    const previousMonth =
      String(existing.month || "");

    if (currentMonth >= previousMonth) {
      grouped.set(key, row);
    }
  });

  return [...grouped.values()];
}

function metricRows() {
  return groupLatest(filteredRows());
}

/* =========================================================
   TARGET RATIO
========================================================= */

function ratio(row) {
  if (
    row.target === null ||
    row.target === undefined ||
    row.actual === null ||
    row.actual === undefined ||
    Number(row.target) === 0
  ) {
    return null;
  }

  return (
    Number(row.actual) /
    Number(row.target)
  );
}

/* =========================================================
   RENDER
========================================================= */

function render() {
  const latestRows = metricRows();

  renderSummary(latestRows);
  renderCards(latestRows);
  renderTrendOptions(latestRows);
  renderTrend();

  document
    .querySelectorAll(".program-tab")
    .forEach((button) => {
      button.classList.toggle(
        "active",
        button.dataset.program ===
          selectedProgram
      );
    });

  const sectionTitle =
    $("#sectionTitle");

  if (sectionTitle) {
    sectionTitle.textContent =
      selectedProgram === "All"
        ? "All programs"
        : selectedProgram;
  }
}

/* =========================================================
   SUMMARY
========================================================= */

function renderSummary(latestRows) {
  const validRows = latestRows.filter(
    (row) => ratio(row) !== null
  );

  const onTrack = validRows.filter(
    (row) => ratio(row) >= 1
  ).length;

  const atRisk =
    validRows.length - onTrack;

  const average =
    validRows.length > 0
      ? validRows.reduce(
          (sum, row) =>
            sum +
            Math.min(
              ratio(row),
              1.25
            ),
          0
        ) / validRows.length
      : null;

  const onTrackEl = $("#onTrack");
  const atRiskEl = $("#atRisk");
  const metricCountEl =
    $("#metricCount");
  const overallEl =
    $("#overallScore");

  if (onTrackEl) {
    onTrackEl.textContent = onTrack;
  }

  if (atRiskEl) {
    atRiskEl.textContent = atRisk;
  }

  if (metricCountEl) {
    metricCountEl.textContent =
      latestRows.length;
  }

  if (overallEl) {
    overallEl.textContent =
      average === null
        ? "—"
        : `${Math.round(
            average * 100
          )}%`;
  }
}

/* =========================================================
   METRIC CARDS
========================================================= */

function renderCards(latestRows) {
  const container = $("#cards");

  if (!container) {
    return;
  }

  container.innerHTML = "";

  if (!latestRows.length) {
    container.innerHTML = `
      <div class="metric-card">

        <div class="metric-name">
          No metrics available yet
        </div>

        <div
          class="muted"
          style="margin-top:12px;"
        >
          The dashboard is connected.
          Waiting for readable KR data
          from Google Sheets.
        </div>

      </div>
    `;

    return;
  }

  latestRows.forEach((row) => {
    const percentage = ratio(row);

    const isGood =
      percentage !== null &&
      percentage >= 1;

    const progressWidth =
      percentage === null
        ? 0
        : Math.min(
            Math.max(
              percentage * 100,
              0
            ),
            100
          );

    const actual =
      row.actualRaw !== undefined &&
      row.actualRaw !== ""
        ? row.actualRaw
        : row.actual;

    const target =
      row.targetRaw !== undefined &&
      row.targetRaw !== ""
        ? row.targetRaw
        : row.target;

    const card =
      document.createElement("div");

    card.className =
      `metric-card ${
        isGood ? "good" : "bad"
      }`;

    card.innerHTML = `
      <div class="metric-top">

        <div>

          <div class="metric-name">
            ${escapeHtml(row.metric)}
          </div>

          <div class="metric-owner">
            ${escapeHtml(
              row.stakeholder ||
                "Team"
            )}
          </div>

        </div>

        <div
          class="status ${
            isGood
              ? "good"
              : "bad"
          }"
        >
          ${
            isGood
              ? "ON TRACK"
              : "AT RISK"
          }
        </div>

      </div>

      <div class="metric-value">

        <span class="actual">
          ${escapeHtml(
            String(actual)
          )}
          ${row.unit || ""}
        </span>

        <span class="target">
          /
          ${escapeHtml(
            String(target)
          )}
          ${row.unit || ""}
        </span>

      </div>

      <div class="bar">

        <div
          class="bar-fill"
          style="width:${progressWidth}%"
        ></div>

      </div>

      <div class="meta-row">

        <span>
          ${
            percentage === null
              ? "No comparison"
              : `${Math.round(
                  percentage * 100
                )}% of target`
          }
        </span>

        <span>
          ${
            row.month
              ? escapeHtml(
                  row.month
                )
              : "Latest"
          }
        </span>

      </div>
    `;

    container.appendChild(card);
  });
}

/* =========================================================
   METRIC SELECT
========================================================= */

const metricSelect =
  $("#metricSelect");

if (metricSelect) {
  metricSelect.addEventListener(
    "change",
    (event) => {
      selectedMetric =
        event.target.value;

      renderTrend();
    }
  );
}

function renderTrendOptions(latestRows) {
  const select =
    $("#metricSelect");

  if (!select) {
    return;
  }

  const metrics = [
    ...new Set(
      latestRows
        .map((row) => row.metric)
        .filter(Boolean)
    ),
  ];

  if (!metrics.includes(selectedMetric)) {
    selectedMetric =
      metrics[0] || "";
  }

  select.innerHTML =
    metrics.length > 0
      ? metrics
          .map(
            (metric) =>
              `
              <option value="${escapeAttr(
                metric
              )}">
                ${escapeHtml(
                  metric
                )}
              </option>
              `
          )
          .join("")
      : `<option>No metric data</option>`;

  if (selectedMetric) {
    select.value = selectedMetric;
  }
}

/* =========================================================
   TREND DATA
========================================================= */

function trendData() {
  let sourceRows = rows;

  if (selectedProgram !== "All") {
    sourceRows = rows.filter(
      (row) =>
        String(row.program || "")
          .toLowerCase() ===
        selectedProgram.toLowerCase()
    );
  }

  const matchingRows =
    sourceRows.filter(
      (row) =>
        row.metric ===
          selectedMetric &&
        row.actual !== null &&
        row.actual !== undefined
    );

  const byMonth = new Map();

  matchingRows.forEach((row) => {
    const month =
      row.month || "Current";

    if (!byMonth.has(month)) {
      byMonth.set(month, row);
    }
  });

  return [...byMonth.entries()].map(
    ([label, row]) => ({
      label,
      value: row.actual,
      target: row.target,
    })
  );
}

/* =========================================================
   TREND CHART
========================================================= */

function renderTrend() {
  const svg = $("#chart");
  const labels = $("#chartLabels");

  if (!svg) {
    return;
  }

  const data = trendData();

  if (!data.length) {
    svg.innerHTML = `
      <text
        x="50%"
        y="50%"
        text-anchor="middle"
        fill="#5d6a79"
        font-size="14"
      >
        No monthly data available
      </text>
    `;

    if (labels) {
      labels.innerHTML = "";
    }

    return;
  }

  const width = 1000;
  const height = 360;

  const left = 28;
  const right = 20;
  const top = 28;
  const bottom = 36;

  const values = data
    .map((item) =>
      Number(item.value)
    )
    .filter(
      (value) =>
        !Number.isNaN(value)
    );

  const target =
    data.find(
      (item) =>
        item.target !== null &&
        item.target !== undefined
    )?.target;

  const allValues =
    target !== undefined
      ? [...values, Number(target)]
      : values;

  let min =
    Math.min(...allValues);

  let max =
    Math.max(...allValues);

  if (min === max) {
    min -= 1;
    max += 1;
  }

  const x = (index) =>
    left +
    (width - left - right) *
      (
        index /
        Math.max(
          1,
          data.length - 1
        )
      );

  const y = (value) =>
    top +
    (height - top - bottom) *
      (
        1 -
        (value - min) /
          (max - min)
      );

  let path = "";

  data.forEach(
    (item, index) => {
      path +=
        index === 0
          ? "M "
          : " L ";

      path +=
        `${x(index).toFixed(1)} ` +
        `${y(
          Number(item.value)
        ).toFixed(1)}`;
    }
  );

  const points = data
    .map(
      (item, index) => `
        <circle
          cx="${x(index)}"
          cy="${y(
            Number(item.value)
          )}"
          r="4.5"
          fill="#0b1017"
          stroke="#a89cff"
          stroke-width="3"
        />
      `
    )
    .join("");

  let targetLine = "";

  if (
    target !== undefined &&
    target !== null
  ) {
    const targetY =
      y(Number(target));

    targetLine = `
      <line
        x1="${left}"
        x2="${width - right}"
        y1="${targetY}"
        y2="${targetY}"
        stroke="#607080"
        stroke-dasharray="5 7"
      />

      <text
        x="${width - right}"
        y="${targetY - 8}"
        text-anchor="end"
        fill="#708090"
        font-size="11"
      >
        Target ${escapeHtml(
          String(target)
        )}
      </text>
    `;
  }

  svg.innerHTML = `
    <line
      x1="${left}"
      x2="${width - right}"
      y1="${top}"
      y2="${top}"
      stroke="#18212c"
    />

    <line
      x1="${left}"
      x2="${width - right}"
      y1="${height / 2}"
      y2="${height / 2}"
      stroke="#18212c"
    />

    <line
      x1="${left}"
      x2="${width - right}"
      y1="${height - bottom}"
      y2="${height - bottom}"
      stroke="#18212c"
    />

    ${targetLine}

    <path
      d="${path}"
      fill="none"
      stroke="#a89cff"
      stroke-width="4"
      stroke-linecap="round"
      stroke-linejoin="round"
    />

    ${points}
  `;

  if (labels) {
    labels.innerHTML =
      data
        .map(
          (item) =>
            `<span>
              ${escapeHtml(
                String(
                  item.label
                ).slice(0, 12)
              )}
            </span>`
        )
        .join("");
  }
}

/* =========================================================
   ESCAPE HTML
========================================================= */

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[character]
  );
}

function escapeAttr(value) {
  return escapeHtml(value).replace(
    /`/g,
    "&#96;"
  );
}

/* =========================================================
   AUTO REFRESH
========================================================= */

setInterval(
  async () => {
    await loadMetrics();
  },
  5 * 60 * 1000
);

/* =========================================================
   START APP
========================================================= */

boot();
