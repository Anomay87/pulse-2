let rows = [];
let selectedProgram = "All";
let selectedMetric = "";

const $ = (selector) =>
  document.querySelector(selector);

/* =========================================================
   API
========================================================= */

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const data = await response
    .json()
    .catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data.error ||
        `Request failed (${response.status})`
    );
  }

  return data;
}

/* =========================================================
   LOGIN / DASHBOARD VIEW
========================================================= */

function showLogin() {
  const loginView = $("#loginView");
  const appView = $("#appView");

  if (loginView) {
    loginView.classList.remove("hidden");
  }

  if (appView) {
    appView.classList.add("hidden");
  }
}

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
   INITIAL LOAD
========================================================= */

async function boot() {
  try {
    const result = await api(
      "/api/me"
    );

    if (
      result &&
      result.user
    ) {
      showDashboard();

      /*
       * Metrics load independently.
       * Login is already complete.
       */
      loadMetrics();
    } else {
      showLogin();
    }
  } catch (error) {
    console.error(
      "Boot error:",
      error
    );

    showLogin();
  }
}

/* =========================================================
   LOGIN
========================================================= */

const loginForm =
  $("#loginForm");

if (loginForm) {
  loginForm.addEventListener(
    "submit",
    async (event) => {
      event.preventDefault();

      const username =
        $("#username").value.trim();

      const password =
        $("#password").value;

      const errorBox =
        $("#loginError");

      const button =
        loginForm.querySelector(
          "button[type='submit']"
        );

      errorBox.textContent = "";

      if (!username || !password) {
        errorBox.textContent =
          "Please enter your username and password.";

        return;
      }

      if (button) {
        button.disabled = true;
        button.textContent =
          "Signing in…";
      }

      try {
        /*
         * ONLY authenticate here.
         */
        const result =
          await api(
            "/api/login",
            {
              method: "POST",

              body: JSON.stringify({
                username,
                password,
              }),
            }
          );

        console.log(
          "Login successful:",
          result
        );

        /*
         * IMPORTANT:
         * Show dashboard immediately.
         */
        showDashboard();

        /*
         * Then load Google Sheet data.
         */
        await loadMetrics();

      } catch (error) {
        console.error(
          "Login failed:",
          error
        );

        errorBox.textContent =
          error.message ||
          "Unable to sign in.";

        showLogin();

      } finally {
        if (button) {
          button.disabled = false;

          button.innerHTML =
            `Enter dashboard <span>→</span>`;
        }
      }
    }
  );
}

/* =========================================================
   LOGOUT
========================================================= */

const logoutButton =
  $("#logoutBtn");

if (logoutButton) {
  logoutButton.addEventListener(
    "click",
    async () => {
      try {
        await api(
          "/api/logout",
          {
            method: "POST",
          }
        );
      } catch (error) {
        console.error(
          "Logout error:",
          error
        );
      }

      rows = [];
      selectedProgram = "All";
      selectedMetric = "";

      showLogin();
    }
  );
}

/* =========================================================
   LOAD METRICS
========================================================= */

async function loadMetrics(
  forceRefresh = false
) {
  try {
    if (forceRefresh) {
      try {
        await api(
          "/api/refresh",
          {
            method: "POST",
          }
        );
      } catch (error) {
        console.warn(
          "Manual refresh failed:",
          error
        );
      }
    }

    const result =
      await api(
        "/api/metrics"
      );

    rows =
      Array.isArray(
        result.rows
      )
        ? result.rows
        : [];

    updateLastUpdated(
      result.fetchedAt
    );

    buildPrograms();

    render();

  } catch (error) {
    console.error(
      "Metrics loading failed:",
      error
    );

    /*
     * IMPORTANT:
     * Never send the user back
     * to the login page.
     */

    showMetricsUnavailable(
      error.message
    );
  }
}

/* =========================================================
   REFRESH BUTTON
========================================================= */

const refreshButton =
  $("#refreshBtn");

if (refreshButton) {
  refreshButton.addEventListener(
    "click",
    async () => {
      refreshButton.disabled = true;
      refreshButton.textContent =
        "…";

      try {
        await loadMetrics(true);
      } finally {
        refreshButton.disabled = false;
        refreshButton.textContent =
          "↻";
      }
    }
  );
}

/* =========================================================
   DATA ERROR
========================================================= */

function showMetricsUnavailable(
  message
) {
  const cards =
    $("#cards");

  if (!cards) {
    return;
  }

  cards.innerHTML = `
    <div class="metric-card bad">

      <div class="metric-top">

        <div>

          <div class="metric-name">
            Dashboard connected
          </div>

          <div class="metric-owner">
            Google Sheet data is currently unavailable
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
            "The dashboard could not read the Google Sheet yet."
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

  const retry =
    $("#retryMetricsBtn");

  if (retry) {
    retry.addEventListener(
      "click",
      () => loadMetrics(true)
    );
  }

  $("#overallScore").textContent =
    "—";

  $("#onTrack").textContent =
    "—";

  $("#atRisk").textContent =
    "—";

  $("#metricCount").textContent =
    "—";

  $("#syncAge").textContent =
    "Pending";

  $("#metricSelect").innerHTML =
    `<option>No metric data</option>`;

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

  $("#chartLabels").innerHTML =
    "";
}

/* =========================================================
   LAST UPDATED
========================================================= */

function updateLastUpdated(
  timestamp
) {
  if (!timestamp) {
    $("#lastUpdated").textContent =
      "Waiting for data";

    $("#syncAge").textContent =
      "Pending";

    return;
  }

  const date =
    new Date(timestamp);

  $("#lastUpdated").textContent =
    `Updated ${date.toLocaleTimeString(
      [],
      {
        hour: "2-digit",
        minute: "2-digit",
      }
    )}`;

  const minutesAgo =
    Math.max(
      0,
      Math.round(
        (Date.now() -
          timestamp) /
          60000
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
        .map(
          (row) =>
            row.program
        )
        .filter(Boolean)
        .map(
          (program) =>
            String(
              program
            ).trim()
        )
    ),
  ].filter(
    (program) =>
      program
        .toLowerCase() !==
      "all"
  );

  const container =
    $("#programTabs");

  if (!container) {
    return;
  }

  container.innerHTML = "";

  programs.forEach(
    (program) => {
      const button =
        document.createElement(
          "button"
        );

      button.type =
        "button";

      button.className =
        "program-tab" +
        (
          selectedProgram ===
          program
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

      container.appendChild(
        button
      );
    }
  );

  const allButton =
    document.querySelector(
      ".program-tab[data-program='All']"
    );

  if (allButton) {
    allButton.onclick = () => {
      selectedProgram =
        "All";

      render();
    };
  }
}

/* =========================================================
   FILTER
========================================================= */

function filteredRows() {
  if (
    selectedProgram ===
    "All"
  ) {
    return rows;
  }

  return rows.filter(
    (row) =>
      String(
        row.program || ""
      )
        .toLowerCase() ===
      selectedProgram
        .toLowerCase()
  );
}

/* =========================================================
   LATEST VALUES
========================================================= */

function groupLatest(
  items
) {
  const grouped =
    new Map();

  items.forEach(
    (row) => {
      const key =
        `${row.metric}|||${row.stakeholder}`;

      const existing =
        grouped.get(key);

      if (!existing) {
        grouped.set(
          key,
          row
        );

        return;
      }

      const currentMonth =
        String(
          row.month || ""
        );

      const existingMonth =
        String(
          existing.month ||
            ""
        );

      if (
        currentMonth >=
        existingMonth
      ) {
        grouped.set(
          key,
          row
        );
      }
    }
  );

  return [
    ...grouped.values(),
  ];
}

function metricRows() {
  return groupLatest(
    filteredRows()
  );
}

/* =========================================================
   TARGET RATIO
========================================================= */

function ratio(row) {
  if (
    row.target === null ||
    row.target ===
      undefined ||
    row.actual === null ||
    row.actual ===
      undefined ||
    Number(row.target) ===
      0
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
    .forEach(
      (button) => {
        button.classList.toggle(
          "active",
          button.dataset
            .program ===
            selectedProgram
        );
      }
    );

  $("#sectionTitle").textContent =
    selectedProgram ===
    "All"
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
        ratio(row) !==
        null
    );

  const onTrack =
    validRows.filter(
      (row) =>
        ratio(row) >=
        1
    ).length;

  const atRisk =
    validRows.length -
    onTrack;

  const average =
    validRows.length
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
   CARDS
========================================================= */

function renderCards(
  latestRows
) {
  const container =
    $("#cards");

  container.innerHTML =
    "";

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
          Waiting for readable KR data.
        </div>

      </div>
    `;

    return;
  }

  latestRows.forEach(
    (row) => {
      const percentage =
        ratio(row);

      const isGood =
        percentage !==
          null &&
        percentage >=
          1;

      const progressWidth =
        percentage ===
          null
          ? 0
          : Math.min(
              Math.max(
                percentage *
                  100,
                0
              ),
              100
            );

      const actual =
        row.actualRaw !==
          undefined &&
        row.actualRaw !==
          ""
          ? row.actualRaw
          : row.actual;

      const target =
        row.targetRaw !==
          undefined &&
        row.targetRaw !==
          ""
          ? row.targetRaw
          : row.target;

      const card =
        document.createElement(
          "div"
        );

      card.className =
        `metric-card ${
          isGood
            ? "good"
            : "bad"
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
              String(
                actual
              )
            )}
            ${row.unit || ""}
          </span>

          <span class="target">
            /
            ${escapeHtml(
              String(
                target
              )
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
              percentage ===
              null
                ? "No comparison"
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
    }
  );
}

/* =========================================================
   TREND SELECT
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

  if (!select) {
    return;
  }

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
        (metric) =>
          `
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
            row.program ||
              ""
          )
            .toLowerCase() ===
          selectedProgram
            .toLowerCase()
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
        !byMonth.has(
          month
        )
      ) {
        byMonth.set(
          month,
          row
        );
      }
    }
  );

  return [
    ...byMonth.entries(),
  ].map(
    ([label, row]) => ({
      label,
      value:
        row.actual,
      target:
        row.target,
    })
  );
}

/* =========================================================
   CHART
========================================================= */

function renderTrend() {
  const data =
    trendData();

  const svg =
    $("#chart");

  if (!svg) {
    return;
  }

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

    $("#chartLabels").innerHTML =
      "";

    return;
  }

  const width = 1000;
  const height = 360;

  const left = 28;
  const right = 20;
  const top = 28;
  const bottom = 36;

  const values =
    data
      .map(
        (item) =>
          Number(
            item.value
          )
      )
      .filter(
        (value) =>
          !Number.isNaN(
            value
          )
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
    Math.min(
      ...allValues
    );

  let max =
    Math.max(
      ...allValues
    );

  if (min === max) {
    min -= 1;
    max += 1;
  }

  const x = (index) =>
    left +
    (width -
      left -
      right) *
      (
        index /
        Math.max(
          1,
          data.length - 1
        )
      );

  const y = (value) =>
    top +
    (height -
      top -
      bottom) *
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
        `${x(index).toFixed(
          1
        )} ` +
        `${y(
          Number(
            item.value
          )
        ).toFixed(1)}`;
    }
  );

  const points =
    data
      .map(
        (item, index) => `
          <circle
            cx="${x(index)}"
            cy="${y(
              Number(
                item.value
              )
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
   ESCAPE HTML
========================================================= */

function escapeHtml(
  value
) {
  return String(
    value
  ).replace(
    /[&<>"']/g,
    (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[
      character
    ]
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
   AUTOMATIC REFRESH
========================================================= */

setInterval(
  () => {
    const appView =
      $("#appView");

    if (
      appView &&
      !appView.classList.contains(
        "hidden"
      )
    ) {
      loadMetrics();
    }
  },
  5 * 60 * 1000
);

/* =========================================================
   START
========================================================= */

boot();
