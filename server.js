let rows = [];
let selectedProgram = "All";
let selectedMetric = "";

const $ = (selector) => document.querySelector(selector);

/* =========================================================
   API HELPER
========================================================= */

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
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
   INITIAL BOOT
========================================================= */

async function boot() {
  try {
    const me = await api("/api/me");

    if (me.user) {
      showDashboard();
      await loadMetrics();
    } else {
      showLogin();
    }
  } catch (error) {
    showLogin();
  }
}

/* =========================================================
   VIEW SWITCHING
========================================================= */

function showLogin() {
  $("#loginView").classList.remove("hidden");
  $("#appView").classList.add("hidden");
}

function showDashboard() {
  /*
   * IMPORTANT:
   * Dashboard becomes visible immediately after
   * successful authentication.
   *
   * Google Sheet loading happens separately.
   */
  $("#loginView").classList.add("hidden");
  $("#appView").classList.remove("hidden");
}

/* =========================================================
   LOGIN
========================================================= */

$("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  const loginButton = event.submitter;

  $("#loginError").textContent = "";

  if (loginButton) {
    loginButton.disabled = true;
    loginButton.style.opacity = "0.7";
  }

  try {
    /*
     * Authenticate ONLY.
     * Do not wait for Google Sheets here.
     */
    await api("/api/login", {
      method: "POST",
      body: JSON.stringify({
        username: $("#username").value.trim(),
        password: $("#password").value,
      }),
    });

    /*
     * Open dashboard immediately.
     */
    showDashboard();

    /*
     * Load metrics separately.
     * If Google Sheets fails, the dashboard still opens.
     */
    await loadMetrics();
  } catch (error) {
    console.error("Login error:", error);

    $("#loginError").textContent =
      error.message || "Unable to sign in.";
  } finally {
    if (loginButton) {
      loginButton.disabled = false;
      loginButton.style.opacity = "1";
    }
  }
});

/* =========================================================
   LOGOUT
========================================================= */

$("#logoutBtn").addEventListener("click", async () => {
  try {
    await api("/api/logout", {
      method: "POST",
    });
  } catch (error) {
    console.error("Logout error:", error);
  }

  rows = [];
  selectedProgram = "All";
  selectedMetric = "";

  showLogin();
});

/* =========================================================
   MANUAL REFRESH
========================================================= */

$("#refreshBtn").addEventListener("click", async () => {
  const button = $("#refreshBtn");

  button.disabled = true;
  button.textContent = "…";

  try {
    await loadMetrics(true);
  } catch (error) {
    console.error("Refresh error:", error);
  } finally {
    button.disabled = false;
    button.textContent = "↻";
  }
});

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
      } catch (refreshError) {
        console.warn(
          "Manual refresh endpoint failed:",
          refreshError
        );
      }
    }

    const data = await api("/api/metrics");

    rows = Array.isArray(data.rows)
      ? data.rows
      : [];

    updateLastUpdated(data.fetchedAt);

    buildPrograms();

    render();

    hideDataError();
  } catch (error) {
    console.error(
      "Could not load metrics:",
      error
    );

    /*
     * IMPORTANT:
     * We do NOT kick the user back to login.
     *
     * Dashboard remains visible even if Google Sheet
     * data is temporarily unavailable.
     */
    showDataError(error.message);
  }
}

/* =========================================================
   DATA ERROR STATE
========================================================= */

function showDataError(message) {
  const cards = $("#cards");

  if (!cards) {
    return;
  }

  cards.innerHTML = `
    <div class="metric-card bad">
      <div class="metric-top">
        <div>
          <div class="metric-name">
            Metrics temporarily unavailable
          </div>

          <div class="metric-owner">
            Dashboard is connected, but the Google Sheet
            data could not be read.
          </div>
        </div>

        <div class="status bad">
          DATA ISSUE
        </div>
      </div>

      <div style="margin-top:22px;color:#8b98a8;line-height:1.6;font-size:13px;">
        ${escapeHtml(
          message ||
            "Please check the Google Sheet connection."
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

  const retryButton =
    $("#retryMetricsBtn");

  if (retryButton) {
    retryButton.addEventListener(
      "click",
      () => loadMetrics(true)
    );
  }

  $("#overallScore").textContent = "—";
  $("#onTrack").textContent = "—";
  $("#atRisk").textContent = "—";
  $("#metricCount").textContent = "—";

  $("#metricSelect").innerHTML =
    `<option value="">No data available</option>`;

  $("#chart").innerHTML = `
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

  $("#chartLabels").innerHTML = "";
}

function hideDataError() {
  // Normal rendering replaces the error state automatically.
}

/* =========================================================
   LAST UPDATED
========================================================= */

function updateLastUpdated(timestamp) {
  if (!timestamp) {
    $("#lastUpdated").textContent =
      "Waiting for data";

    $("#syncAge").textContent =
      "Not synced";

    return;
  }

  const date = new Date(timestamp);

  $("#lastUpdated").textContent =
    `Updated ${date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    })}`;

  const minutesAgo = Math.max(
    0,
    Math.round(
      (Date.now() - timestamp) / 60000
    )
  );

  $("#syncAge").textContent =
    minutesAgo <= 0
      ? "just now"
      : `${minutesAgo}m ago`;
}

/* =========================================================
   PROGRAMS
========================================================= */

function buildPrograms() {
  const programs = [
    ...new Set(
      rows
        .map((row) => row.program)
        .filter(Boolean)
        .map((program) => String(program).trim())
    ),
  ].filter(
    (program) =>
      program.toLowerCase() !== "all"
  );

  const container =
    $("#programTabs");

  container.innerHTML = "";

  programs.forEach((program) => {
    const button =
      document.createElement("button");

    button.type = "button";

    button.className =
      "program-tab" +
      (
        selectedProgram === program
          ? " active"
          : ""
      );

    button.dataset.program =
      program;

    button.textContent =
      program;

    button.addEventListener(
      "click",
      () => {
        selectedProgram =
          program;

        render();
      }
    );

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
   FILTERING
========================================================= */

function filteredRows() {
  if (selectedProgram === "All") {
    return rows;
  }

  return rows.filter(
    (row) =>
      String(
        row.program || ""
      ).toLowerCase() ===
      selectedProgram.toLowerCase()
  );
}

/* =========================================================
   LATEST METRIC GROUPING
========================================================= */

function groupLatest(items) {
  const grouped = new Map();

  items.forEach((row) => {
    const key =
      `${row.metric}|||${row.stakeholder}`;

    const existing =
      grouped.get(key);

    if (!existing) {
      grouped.set(key, row);
      return;
    }

    const currentMonth =
      String(row.month || "");

    const existingMonth =
      String(existing.month || "");

    if (
      currentMonth >= existingMonth
    ) {
      grouped.set(key, row);
    }
  });

  return [...grouped.values()];
}

function metricRows() {
  return groupLatest(
    filteredRows()
  );
}

/* =========================================================
   RATIO
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
   MAIN RENDER
========================================================= */

function render() {
  const latestRows =
    metricRows();

  renderSummary(
    latestRows
  );

  renderCards(
    latestRows
  );

  renderTrendOptions(
    latestRows
  );

  renderTrend();

  document
    .querySelectorAll(
      ".program-tab"
    )
    .forEach((button) => {
      button.classList.toggle(
        "active",
        button.dataset.program ===
          selectedProgram
      );
    });

  $("#sectionTitle").textContent =
    selectedProgram === "All"
      ? "All programs"
      : selectedProgram;
}

/* =========================================================
   SUMMARY
========================================================= */

function renderSummary(
  latestRows
) {
  const validRows =
    latestRows.filter(
      (row) =>
        ratio(row) !== null
    );

  const onTrack =
    validRows.filter(
      (row) =>
        ratio(row) >= 1
    ).length;

  const atRisk =
    validRows.length -
    onTrack;

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
        ) /
        validRows.length
      : null;

  $("#onTrack").textContent =
    onTrack;

  $("#atRisk").textContent =
    atRisk;

  $("#metricCount").textContent =
    latestRows.length;

  $("#overallScore").textContent =
    average === null
      ? "—"
      : `${Math.round(
          average * 100
        )}%`;
}

/* =========================================================
   METRIC CARDS
========================================================= */

function renderCards(
  latestRows
) {
  const container =
    $("#cards");

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
          Your dashboard is connected.
          Waiting for readable KR data
          from Google Sheets.
        </div>
      </div>
    `;

    return;
  }

  latestRows.forEach((row) => {
    const percentage =
      ratio(row);

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
      document.createElement(
        "div"
      );

    card.className =
      `metric-card ${
        isGood ? "good" : "bad"
      }`;

    card.innerHTML = `
      <div class="metric-top">

        <div>

          <div class="metric-name">
            ${escapeHtml(
              row.metric
            )}
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
              ? "No target comparison"
              : `${Math.round(
                  percentage *
                    100
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

    container.appendChild(
      card
    );
  });
}

/* =========================================================
   TREND SELECT
========================================================= */

$("#metricSelect").addEventListener(
  "change",
  (event) => {
    selectedMetric =
      event.target.value;

    renderTrend();
  }
);

function renderTrendOptions(
  latestRows
) {
  const metrics = [
    ...new Set(
      latestRows
        .map(
          (row) =>
            row.metric
        )
        .filter(Boolean)
    ),
  ];

  const select =
    $("#metricSelect");

  if (
    !metrics.includes(
      selectedMetric
    )
  ) {
    selectedMetric =
      metrics[0] || "";
  }

  select.innerHTML =
    metrics
      .map(
        (metric) => `
          <option
            value="${escapeAttr(
              metric
            )}"
          >
            ${escapeHtml(
              metric
            )}
          </option>
        `
      )
      .join("");

  if (selectedMetric) {
    select.value =
      selectedMetric;
  }
}

/* =========================================================
   TREND DATA
========================================================= */

function trendData() {
  let sourceRows =
    rows;

  if (
    selectedProgram !==
    "All"
  ) {
    sourceRows =
      rows.filter(
        (row) =>
          String(
            row.program || ""
          ).toLowerCase() ===
          selectedProgram.toLowerCase()
      );
  }

  const matchingRows =
    sourceRows.filter(
      (row) =>
        row.metric ===
          selectedMetric &&
        row.actual !==
          null &&
        row.actual !==
          undefined
    );

  const byMonth =
    new Map();

  matchingRows.forEach(
    (row) => {
      const month =
        row.month ||
        "Current";

      if (
        !byMonth.has(month)
      ) {
        byMonth.set(
          month,
          row
        );
      }
    }
  );

  const labels = [
    ...byMonth.keys(),
  ];

  return labels.map(
    (label) => ({
      label,

      value:
        byMonth.get(label)
          .actual,

      target:
        byMonth.get(label)
          .target,
    })
  );
}

/* =========================================================
   TREND CHART
========================================================= */

function renderTrend() {
  const data =
    trendData();

  const svg =
    $("#chart");

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
        for this metric.
      </text>
    `;

    $("#chartLabels").innerHTML =
      "";

    return;
  }

  const width = 1000;
  const height = 360;

  const paddingLeft = 28;
  const paddingRight = 20;
  const paddingTop = 28;
  const paddingBottom = 36;

  const values =
    data
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
        item.target !==
          null &&
        item.target !==
          undefined
    )?.target;

  const allValues =
    target !== undefined
      ? [
          ...values,
          Number(target),
        ]
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
    paddingLeft +
    (width -
      paddingLeft -
      paddingRight) *
      (
        index /
        Math.max(
          1,
          data.length - 1
        )
      );

  const y = (value) =>
    paddingTop +
    (height -
      paddingTop -
      paddingBottom) *
      (
        1 -
        (value - min) /
          (max - min)
      );

  let path = "";

  data.forEach(
    (item, index) => {
      path +=
        (index === 0
          ? "M "
          : " L ") +
        `${x(index).toFixed(
          1
        )} ` +
        `${y(
          Number(item.value)
        ).toFixed(1)}`;
    }
  );

  let targetLine = "";

  if (
    target !== undefined &&
    target !== null &&
    !Number.isNaN(
      Number(target)
    )
  ) {
    const targetY =
      y(Number(target));

    targetLine = `
      <line
        x1="${paddingLeft}"
        x2="${width -
        paddingRight}"
        y1="${targetY}"
        y2="${targetY}"
        stroke="#607080"
        stroke-dasharray="5 7"
      />

      <text
        x="${width -
          paddingRight}"
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

  const gridLines = [
    0,
    0.25,
    0.5,
    0.75,
    1,
  ]
    .map(
      (position) => {
        const yPosition =
          paddingTop +
          (height -
            paddingTop -
            paddingBottom) *
            position;

        return `
          <line
            x1="${paddingLeft}"
            x2="${width -
              paddingRight}"
            y1="${yPosition}"
            y2="${yPosition}"
            stroke="#18212c"
          />
        `;
      }
    )
    .join("");

  const points =
    data
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

  svg.innerHTML = `
    ${gridLines}

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

  $("#chartLabels").innerHTML =
    data
      .map(
        (item) =>
          `<span>
            ${escapeHtml(
              String(
                item.label
              ).slice(
                0,
                12
              )
            )}
          </span>`
      )
      .join("");
}

/* =========================================================
   ESCAPING
========================================================= */

function escapeHtml(
  value
) {
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

function escapeAttr(
  value
) {
  return escapeHtml(
    value
  ).replace(
    /`/g,
    "&#96;"
  );
}

/* =========================================================
   AUTO REFRESH
========================================================= */

setInterval(
  async () => {
    const appView =
      $("#appView");

    if (
      !appView.classList.contains(
        "hidden"
      )
    ) {
      await loadMetrics();
    }
  },
  5 * 60 * 1000
);

/* =========================================================
   START
========================================================= */

boot();
