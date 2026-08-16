let rows = [];
let selectedProgram = "All";
let selectedMetric = "";

const $ = (selector) => document.querySelector(selector);

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
    },
    ...options,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }

  return data;
}

async function boot() {
  try {
    const me = await api("/api/me");

    if (me.user) {
      showDashboard();
    } else {
      showLogin();
    }
  } catch (error) {
    showLogin();
  }
}

function showLogin() {
  $("#loginView").classList.remove("hidden");
  $("#appView").classList.add("hidden");
}

async function showDashboard() {
  $("#loginView").classList.add("hidden");
  $("#appView").classList.remove("hidden");

  await loadMetrics();
}

$("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  $("#loginError").textContent = "";

  try {
    await api("/api/login", {
      method: "POST",
      body: JSON.stringify({
        username: $("#username").value,
        password: $("#password").value,
      }),
    });

    await showDashboard();
  } catch (error) {
    $("#loginError").textContent = error.message;
  }
});

$("#logoutBtn").addEventListener("click", async () => {
  try {
    await api("/api/logout", {
      method: "POST",
    });
  } finally {
    showLogin();
  }
});

$("#refreshBtn").addEventListener("click", async () => {
  const button = $("#refreshBtn");

  button.textContent = "…";
  button.disabled = true;

  try {
    await api("/api/refresh", {
      method: "POST",
    });

    await loadMetrics();
  } catch (error) {
    console.error(error);
  } finally {
    button.textContent = "↻";
    button.disabled = false;
  }
});

async function loadMetrics() {
  const data = await api("/api/metrics");

  rows = Array.isArray(data.rows) ? data.rows : [];

  $("#footerUser").textContent =
    `Signed in as ${data.user?.username || "user"}`;

  updateLastUpdated(data.fetchedAt);

  buildPrograms();
  render();
}

function updateLastUpdated(timestamp) {
  const date = new Date(timestamp);

  $("#lastUpdated").textContent =
    `Updated ${date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    })}`;

  const minutesAgo = Math.max(
    0,
    Math.round((Date.now() - timestamp) / 60000)
  );

  $("#syncAge").textContent =
    minutesAgo <= 0
      ? "just now"
      : `${minutesAgo}m ago`;
}

function buildPrograms() {
  const programs = [
    ...new Set(
      rows
        .map((row) => row.program)
        .filter(Boolean)
        .map((program) => String(program).trim())
    ),
  ].filter(
    (program) => program.toLowerCase() !== "all"
  );

  const container = $("#programTabs");

  container.innerHTML = "";

  programs.forEach((program) => {
    const button = document.createElement("button");

    button.className =
      "program-tab" +
      (selectedProgram === program ? " active" : "");

    button.dataset.program = program;
    button.textContent = program;

    button.addEventListener("click", () => {
      selectedProgram = program;
      render();
    });

    container.appendChild(button);
  });

  document
    .querySelectorAll(".program-tab[data-program='All']")
    .forEach((button) => {
      button.onclick = () => {
        selectedProgram = "All";
        render();
      };
    });
}

function filteredRows() {
  if (selectedProgram === "All") {
    return rows;
  }

  return rows.filter(
    (row) =>
      String(row.program).toLowerCase() ===
      selectedProgram.toLowerCase()
  );
}

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

    const existingMonth =
      String(existing.month || "");

    if (currentMonth >= existingMonth) {
      grouped.set(key, row);
    }
  });

  return [...grouped.values()];
}

function metricRows() {
  return groupLatest(filteredRows());
}

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

  return Number(row.actual) / Number(row.target);
}

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
        button.dataset.program === selectedProgram
      );
    });

  $("#sectionTitle").textContent =
    selectedProgram === "All"
      ? "All programs"
      : selectedProgram;
}

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
            sum + Math.min(ratio(row), 1.25),
          0
        ) / validRows.length
      : null;

  $("#onTrack").textContent = onTrack;
  $("#atRisk").textContent = atRisk;
  $("#metricCount").textContent = latestRows.length;

  $("#overallScore").textContent =
    average === null
      ? "—"
      : `${Math.round(average * 100)}%`;
}

function renderCards(latestRows) {
  const container = $("#cards");

  container.innerHTML = "";

  if (!latestRows.length) {
    container.innerHTML = `
      <div class="metric-card">
        <div class="metric-name">
          No metrics found
        </div>

        <p class="muted">
          Check the Google Sheet headers and
          Railway CSV configuration.
        </p>
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
            Math.max(percentage * 100, 0),
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
      `metric-card ${isGood ? "good" : "bad"}`;

    const statusText =
      isGood ? "ON TRACK" : "AT RISK";

    const progressText =
      percentage === null
        ? "—"
        : `${Math.round(percentage * 100)}% of target`;

    card.innerHTML = `
      <div class="metric-top">
        <div>
          <div class="metric-name">
            ${escapeHtml(row.metric)}
          </div>

          <div class="metric-owner">
            ${escapeHtml(
              row.stakeholder || "Team"
            )}
          </div>
        </div>

        <div class="status ${
          isGood ? "good" : "bad"
        }">
          ${statusText}
        </div>
      </div>

      <div class="metric-value">
        <span class="actual">
          ${escapeHtml(String(actual))}
          ${row.unit || ""}
        </span>

        <span class="target">
          / ${escapeHtml(String(target))}
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
        <span>${progressText}</span>

        <span>
          ${
            row.month
              ? escapeHtml(row.month)
              : "Latest"
          }
        </span>
      </div>
    `;

    container.appendChild(card);
  });
}

$("#metricSelect").addEventListener(
  "change",
  (event) => {
    selectedMetric = event.target.value;
    renderTrend();
  }
);

function renderTrendOptions(latestRows) {
  const metrics = [
    ...new Set(
      latestRows
        .map((row) => row.metric)
        .filter(Boolean)
    ),
  ];

  const select = $("#metricSelect");

  if (!metrics.includes(selectedMetric)) {
    selectedMetric = metrics[0] || "";
  }

  select.innerHTML = metrics
    .map(
      (metric) =>
        `<option value="${escapeAttr(metric)}">
          ${escapeHtml(metric)}
        </option>`
    )
    .join("");

  select.value = selectedMetric;
}

function trendData() {
  let sourceRows = rows;

  if (selectedProgram !== "All") {
    sourceRows = rows.filter(
      (row) =>
        String(row.program).toLowerCase() ===
        selectedProgram.toLowerCase()
    );
  }

  const matchingRows = sourceRows.filter(
    (row) =>
      row.metric === selectedMetric &&
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

  const labels = [...byMonth.keys()];

  return labels.map((label) => ({
    label,
    value: byMonth.get(label).actual,
    target: byMonth.get(label).target,
  }));
}

function renderTrend() {
  const data = trendData();

  const svg = $("#chart");

  if (!data.length) {
    svg.innerHTML = `
      <text
        x="50%"
        y="50%"
        text-anchor="middle"
        fill="#5d6a79"
        font-size="14"
      >
        No monthly data available for this metric.
      </text>
    `;

    $("#chartLabels").innerHTML = "";

    return;
  }

  const width = 1000;
  const height = 360;

  const paddingLeft = 28;
  const paddingRight = 20;
  const paddingTop = 28;
  const paddingBottom = 36;

  const values = data
    .map((item) => Number(item.value))
    .filter((value) => !Number.isNaN(value));

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

  let min = Math.min(...allValues);
  let max = Math.max(...allValues);

  if (min === max) {
    min -= 1;
    max += 1;
  }

  const x = (index) =>
    paddingLeft +
    (width -
      paddingLeft -
      paddingRight) *
      (index /
        Math.max(1, data.length - 1));

  const y = (value) =>
    paddingTop +
    (height -
      paddingTop -
      paddingBottom) *
      (1 - (value - min) / (max - min));

  let linePath = "";

  data.forEach((item, index) => {
    linePath +=
      (index === 0 ? "M " : " L ") +
      `${x(index).toFixed(1)} ` +
      `${y(Number(item.value)).toFixed(1)}`;
  });

  let targetLine = "";

  if (
    target !== undefined &&
    target !== null &&
    !Number.isNaN(Number(target))
  ) {
    const targetY = y(Number(target));

    targetLine = `
      <line
        x1="${paddingLeft}"
        x2="${width - paddingRight}"
        y1="${targetY}"
        y2="${targetY}"
        stroke="#607080"
        stroke-dasharray="5 7"
      />

      <text
        x="${width - paddingRight}"
        y="${targetY - 8}"
        text-anchor="end"
        fill="#708090"
        font-size="11"
      >
        Target ${escapeHtml(String(target))}
      </text>
    `;
  }

  const gridLines = [
    0,
    0.25,
    0.5,
    0.75,
    1,
  ]
    .map((position) => {
      const yPosition =
        paddingTop +
        (height -
          paddingTop -
          paddingBottom) *
          position;

      return `
        <line
          x1="${paddingLeft}"
          x2="${width - paddingRight}"
          y1="${yPosition}"
          y2="${yPosition}"
          stroke="#18212c"
        />
      `;
    })
    .join("");

  const points = data
    .map((item, index) => {
      return `
        <circle
          cx="${x(index)}"
          cy="${y(Number(item.value))}"
          r="4.5"
          fill="#0b1017"
          stroke="#a89cff"
          stroke-width="3"
        />
      `;
    })
    .join("");

  svg.innerHTML = `
    ${gridLines}

    ${targetLine}

    <path
      d="${linePath}"
      fill="none"
      stroke="#a89cff"
      stroke-width="4"
      stroke-linecap="round"
      stroke-linejoin="round"
    />

    ${points}
  `;

  $("#chartLabels").innerHTML = data
    .map(
      (item) =>
        `<span>
          ${escapeHtml(
            String(item.label).slice(0, 12)
          )}
        </span>`
    )
    .join("");
}

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

/*
 * Automatic refresh every 5 minutes.
 * The browser stays connected to the live dashboard
 * while the backend re-fetches the Google Sheet data.
 */
setInterval(async () => {
  const appView = $("#appView");

  if (
    !appView.classList.contains("hidden")
  ) {
    try {
      await loadMetrics();
    } catch (error) {
      console.error(
        "Automatic refresh failed:",
        error
      );
    }
  }
}, 5 * 60 * 1000);

boot();
