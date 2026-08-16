let rows = [];

let expandedProgram = null;

const $ = (selector) =>
  document.querySelector(selector);

/* =========================================================
   API
========================================================= */

async function api(
  url,
  options = {}
) {
  const response =
    await fetch(url, {
      ...options,

      headers: {
        "Content-Type":
          "application/json",

        ...(options.headers || {}),
      },
    });

  const data =
    await response
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
   BOOT
========================================================= */

async function boot() {
  try {
    await loadMetrics();
  } catch (error) {
    console.error(error);

    showSystemMessage(
      error.message ||
        "Unable to load dashboard."
    );
  }
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
          "Refresh failed:",
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

    updateSyncTime(
      result.fetchedAt
    );

    renderDashboard();

    hideSystemMessage();

  } catch (error) {

    console.error(
      "Metrics error:",
      error
    );

    showSystemMessage(
      error.message ||
        "Unable to read Google Sheets."
    );

  }
}

/* =========================================================
   REFRESH
========================================================= */

const refreshBtn =
  $("#refreshBtn");

if (refreshBtn) {

  refreshBtn.addEventListener(
    "click",
    async () => {

      refreshBtn.classList.add(
        "spinning"
      );

      refreshBtn.disabled =
        true;

      try {

        await loadMetrics(
          true
        );

      } finally {

        refreshBtn.disabled =
          false;

        refreshBtn.classList.remove(
          "spinning"
        );

      }

    }
  );

}

/* =========================================================
   SYNC TIME
========================================================= */

function updateSyncTime(
  timestamp
) {

  const element =
    $("#lastUpdated");

  if (!element) {
    return;
  }

  if (!timestamp) {

    element.textContent =
      "Waiting for data";

    return;

  }

  const date =
    new Date(timestamp);

  element.textContent =
    `Updated ${date.toLocaleTimeString(
      [],
      {
        hour: "2-digit",
        minute: "2-digit",
      }
    )}`;
}

/* =========================================================
   DASHBOARD
========================================================= */

function renderDashboard() {

  const programs =
    getPrograms();

  renderOverallSummary();

  renderPrograms(
    programs
  );

}

/* =========================================================
   PROGRAM LIST
========================================================= */

function getPrograms() {

  return [
    ...new Set(
      rows
        .map(
          (row) =>
            String(
              row.program || ""
            ).trim()
        )
        .filter(Boolean)
    ),
  ];

}

/* =========================================================
   OVERALL SUMMARY
========================================================= */

function renderOverallSummary() {

  const metrics =
    rows.filter(
      (row) =>
        row.actual !== null &&
        row.actual !== undefined &&
        row.target !== null &&
        row.target !== undefined
    );

  let onTrack = 0;

  let atRisk = 0;

  let achievementScores = [];

  metrics.forEach(
    (metric) => {

      const status =
        getMetricStatus(
          metric
        );

      if (
        status.onTrack
      ) {

        onTrack++;

      } else {

        atRisk++;

      }

      const score =
        getAchievementScore(
          metric
        );

      if (
        score !== null
      ) {

        achievementScores.push(
          Math.min(
            score,
            1.25
          )
        );

      }

    }
  );

  const average =
    achievementScores.length
      ? achievementScores.reduce(
          (sum, value) =>
            sum + value,
          0
        ) /
        achievementScores.length
      : null;

  $("#onTrack").textContent =
    onTrack;

  $("#atRisk").textContent =
    atRisk;

  $("#metricCount").textContent =
    rows.length;

  $("#overallScore").textContent =
    average === null
      ? "—"
      : `${Math.round(
          average * 100
        )}%`;
}

/* =========================================================
   PROGRAM ACCORDION
========================================================= */

function renderPrograms(
  programs
) {

  const container =
    $("#programAccordion");

  if (!container) {
    return;
  }

  container.innerHTML =
    "";

  programs.forEach(
    (program) => {

      const programRows =
        rows.filter(
          (row) =>
            String(
              row.program
            ).toLowerCase() ===
            String(
              program
            ).toLowerCase()
        );

      const latestRows =
        programRows;

      const health =
        calculateProgramHealth(
          latestRows
        );

      const isExpanded =
        expandedProgram ===
        program;

      const programBlock =
        document.createElement(
          "div"
        );

      programBlock.className =
        `program-block ${
          isExpanded
            ? "expanded"
            : ""
        }`;

      /* ----------------------------------
         PROGRAM HEADER
      ----------------------------------- */

      const header =
        document.createElement(
          "button"
        );

      header.type =
        "button";

      header.className =
        "program-header";

      header.innerHTML = `

        <div class="program-header-left">

          <div class="program-chevron">
            ${isExpanded
              ? "⌄"
              : "›"}
          </div>

          <div>

            <div class="program-name">
              ${escapeHtml(
                program
              )}
            </div>

            <div class="program-meta">
              ${
                latestRows.length
              }
              metrics tracked
            </div>

          </div>

        </div>


        <div class="program-header-right">

          <div class="program-health">

            <span class="program-health-label">
              ${
                health.label
              }
            </span>

            <span
              class="health-dot ${
                health.status
              }"
            ></span>

          </div>

          <div class="program-score">
            ${
              health.score ===
              null
                ? "—"
                : `${Math.round(
                    health.score *
                      100
                  )}%`
            }
          </div>

        </div>

      `;

      header.addEventListener(
        "click",
        () => {

          if (
            expandedProgram ===
            program
          ) {

            expandedProgram =
              null;

          } else {

            expandedProgram =
              program;

          }

          renderPrograms(
            programs
          );

        }
      );

      programBlock.appendChild(
        header
      );


      /* ----------------------------------
         DETAILS
      ----------------------------------- */

      if (isExpanded) {

        const detail =
          document.createElement(
            "div"
          );

        detail.className =
          "program-details";

        const metricsGrid =
          document.createElement(
            "div"
          );

        metricsGrid.className =
          "metrics-grid";

        latestRows.forEach(
          (metric) => {

            metricsGrid.appendChild(
              createMetricCard(
                metric
              )
            );

          }
        );

        detail.appendChild(
          metricsGrid
        );

        programBlock.appendChild(
          detail
        );

      }

      container.appendChild(
        programBlock
      );

    }
  );

}

/* =========================================================
   PROGRAM HEALTH
========================================================= */

function calculateProgramHealth(
  metrics
) {

  const valid =
    metrics.filter(
      (metric) =>
        metric.actual !==
          null &&
        metric.actual !==
          undefined &&
        metric.target !==
          null &&
        metric.target !==
          undefined
    );

  if (!valid.length) {

    return {
      score: null,
      label: "No data",
      status: "neutral",
    };

  }

  let good = 0;

  let scores = [];

  valid.forEach(
    (metric) => {

      const status =
        getMetricStatus(
          metric
        );

      if (
        status.onTrack
      ) {
        good++;
      }

      const score =
        getAchievementScore(
          metric
        );

      if (
        score !== null
      ) {
        scores.push(
          Math.min(
            score,
            1.25
          )
        );
      }

    }
  );

  const score =
    scores.length
      ? scores.reduce(
          (sum, value) =>
            sum + value,
          0
        ) /
        scores.length
      : null;

  const percentage =
    valid.length
      ? good /
        valid.length
      : 0;

  if (
    percentage >= 0.75
  ) {

    return {
      score,
      label:
        "Strong",
      status:
        "good",
    };

  }

  if (
    percentage >= 0.5
  ) {

    return {
      score,
      label:
        "Mixed",
      status:
        "warning",
    };

  }

  return {
    score,
    label:
      "Needs attention",
    status:
      "bad",
  };

}

/* =========================================================
   METRIC CARD
========================================================= */

function createMetricCard(
  metric
) {

  const card =
    document.createElement(
      "article"
    );

  const status =
    getMetricStatus(
      metric
    );

  const score =
    getAchievementScore(
      metric
    );

  const latest =
    metric.monthly &&
    metric.monthly.length
      ? metric.monthly
      : [];

  const actualDisplay =
    formatValue(
      metric.actual,
      metric.actualRaw,
      metric
    );

  const targetDisplay =
    formatValue(
      metric.target,
      metric.targetRaw,
      metric
    );

  const descriptor =
    getMetricDescriptor(
      metric
    );

  card.className =
    `metric-card ${
      status.onTrack
        ? "metric-good"
        : status.isComparable
        ? "metric-bad"
        : "metric-neutral"
    }`;

  card.innerHTML = `

    <div class="metric-card-top">

      <div>

        <div class="metric-name">
          ${escapeHtml(
            metric.metric
          )}
        </div>

        <div class="metric-description">
          ${escapeHtml(
            descriptor
          )}
        </div>

      </div>

      <div
        class="status-pill ${
          status.className
        }"
      >
        ${status.label}
      </div>

    </div>


    <div class="metric-main">

      <div class="metric-numbers">

        <div class="metric-current">

          <span class="current-number">
            ${escapeHtml(
              actualDisplay
            )}
          </span>

          <span class="current-label">
            current
          </span>

        </div>


        <div class="metric-target">

          <span class="target-number">
            ${escapeHtml(
              targetDisplay
            )}
          </span>

          <span class="target-label">
            target
          </span>

        </div>

      </div>


      <div class="metric-gap">

        ${renderGap(
          metric
        )}

      </div>

    </div>


    <div class="metric-progress">

      ${renderProgress(
        metric
      )}

    </div>


    <div class="trend-heading">

      <span>
        Month-on-month movement
      </span>

      <span>
        ${
          latest.length
            ? `${latest.length} months`
            : ""
        }
      </span>

    </div>


    <div class="sparkline-wrapper">

      ${renderSparkline(
        metric
      )}

    </div>


    <div class="month-values">

      ${renderMonthValues(
        metric
      )}

    </div>

  `;

  return card;

}

/* =========================================================
   METRIC STATUS
========================================================= */

function getMetricStatus(
  metric
) {

  const actual =
    Number(metric.actual);

  const target =
    Number(metric.target);

  if (
    metric.actual === null ||
    metric.actual === undefined ||
    metric.target === null ||
    metric.target === undefined ||
    Number.isNaN(actual) ||
    Number.isNaN(target)
  ) {

    return {
      onTrack: false,
      isComparable: false,
      label: "No target",
      className:
        "status-neutral",
    };

  }

  /*
   * I2H is lower-is-better.
   */

  if (
    metric.lowerBetter
  ) {

    if (
      actual <=
      target
    ) {

      return {
        onTrack: true,
        isComparable: true,
        label: "ON TRACK",
        className:
          "status-good",
      };

    }

    return {
      onTrack: false,
      isComparable: true,
      label: "AT RISK",
      className:
        "status-bad",
    };

  }

  /*
   * Normal KR:
   * higher is better.
   */

  if (
    actual >=
    target
  ) {

    return {
      onTrack: true,
      isComparable: true,
      label:
        "ON TRACK",
      className:
        "status-good",
    };

  }

  return {
    onTrack: false,
    isComparable: true,
    label:
      "AT RISK",
    className:
      "status-bad",
  };

}

/* =========================================================
   ACHIEVEMENT SCORE
========================================================= */

function getAchievementScore(
  metric
) {

  const actual =
    Number(metric.actual);

  const target =
    Number(metric.target);

  if (
    metric.actual ===
      null ||
    metric.actual ===
      undefined ||
    metric.target ===
      null ||
    metric.target ===
      undefined ||
    Number.isNaN(
      actual
    ) ||
    Number.isNaN(
      target
    ) ||
    target === 0
  ) {

    return null;

  }

  if (
    metric.lowerBetter
  ) {

    /*
     * Lower is better.
     *
     * Actual 10
     * Target 12
     *
     * score = 12 / 10 = 120%
     */

    if (
      actual === 0
    ) {
      return 1.25;
    }

    return (
      target /
      actual
    );

  }

  return (
    actual /
    target
  );

}

/* =========================================================
   GAP
========================================================= */

function renderGap(
  metric
) {

  if (
    metric.actual ===
      null ||
    metric.actual ===
      undefined ||
    metric.target ===
      null ||
    metric.target ===
      undefined
  ) {

    return `
      <span class="gap-neutral">
        Target comparison unavailable
      </span>
    `;

  }

  const actual =
    Number(metric.actual);

  const target =
    Number(metric.target);

  if (
    metric.lowerBetter
  ) {

    const gap =
      actual -
      target;

    if (
      gap <= 0
    ) {

      return `
        <span class="gap-good">
          ${formatNumber(
            Math.abs(gap)
          )} pp below limit
        </span>
      `;

    }

    return `
      <span class="gap-bad">
        ${formatNumber(
          gap
        )} pp above limit
      </span>
    `;

  }

  const gap =
    actual -
    target;

  if (
    gap >= 0
  ) {

    return `
      <span class="gap-good">
        +${formatNumber(
          gap
        )} above target
      </span>
    `;

  }

  return `
    <span class="gap-bad">
      ${formatNumber(
        Math.abs(gap)
      )} below target
    </span>
  `;

}

/* =========================================================
   PROGRESS
========================================================= */

function renderProgress(
  metric
) {

  if (
    metric.actual ===
      null ||
    metric.actual ===
      undefined ||
    metric.target ===
      null ||
    metric.target ===
      undefined
  ) {

    return `
      <div class="progress-track">
        <div
          class="progress-fill neutral"
          style="width:0%"
        ></div>
      </div>
    `;

  }

  const actual =
    Number(metric.actual);

  const target =
    Number(metric.target);

  let percentage;

  if (
    metric.lowerBetter
  ) {

    percentage =
      actual <= 0
        ? 100
        : (
            target /
            actual
          ) *
          100;

  } else {

    percentage =
      (
        actual /
        target
      ) *
      100;

  }

  percentage =
    Math.max(
      0,
      Math.min(
        percentage,
        100
      )
    );

  const status =
    getMetricStatus(
      metric
    );

  return `
    <div class="progress-track">

      <div
        class="progress-fill ${
          status.onTrack
            ? "good"
            : "bad"
        }"
        style="width:${percentage}%"
      ></div>

    </div>
  `;

}

/* =========================================================
   SPARKLINE
========================================================= */

function renderSparkline(
  metric
) {

  const monthly =
    (metric.monthly ||
      []).filter(
        (item) =>
          item.actual !==
            null &&
          item.actual !==
            undefined
      );

  /*
   * Numeric trend.
   */

  if (
    monthly.length >= 2
  ) {

    const values =
      monthly.map(
        (item) =>
          Number(
            item.actual
          )
      );

    const width = 560;
    const height = 130;

    const padding = 12;

    let min =
      Math.min(
        ...values
      );

    let max =
      Math.max(
        ...values
      );

    if (
      min === max
    ) {

      min -= 1;
      max += 1;

    }

    const x =
      (index) =>
        padding +
        (
          width -
          padding * 2
        ) *
          (
            index /
            Math.max(
              1,
              values.length -
                1
            )
          );

    const y =
      (value) =>
        height -
        padding -
        (
          height -
          padding * 2
        ) *
          (
            (
              value -
              min
            ) /
            (
              max -
              min
            )
          );

    let path = "";

    values.forEach(
      (
        value,
        index
      ) => {

        path +=
          index === 0
            ? "M "
            : " L ";

        path +=
          `${x(index).toFixed(
            1
          )} ` +
          `${y(
            value
          ).toFixed(1)}`;

      }
    );

    const dots =
      values
        .map(
          (
            value,
            index
          ) =>
            `
            <circle
              cx="${x(
                index
              )}"
              cy="${y(
                value
              )}"
              r="3.5"
              class="spark-dot"
            />
          `
        )
        .join("");

    return `
      <svg
        class="sparkline"
        viewBox="0 0 ${width} ${height}"
        preserveAspectRatio="none"
      >

        <line
          x1="12"
          x2="${width -
            12}"
          y1="${height -
            20}"
          y2="${height -
            20}"
          class="spark-axis"
        />

        <path
          d="${path}"
          class="spark-path"
        />

        ${dots}

      </svg>
    `;

  }

  /*
   * Text / non-numeric timeline.
   */

  return `
    <div class="text-trend">

      ${
        (
          metric.monthly ||
          []
        )
          .map(
            (item) => {

              const value =
                item.actualRaw ||
                "—";

              return `
                <div
                  class="text-trend-item"
                >
                  <span>
                    ${escapeHtml(
                      item.month
                    )}
                  </span>

                  <strong>
                    ${escapeHtml(
                      value
                    )}
                  </strong>
                </div>
              `;

            }
          )
          .join("")
      }

    </div>
  `;

}

/* =========================================================
   MONTH VALUES
========================================================= */

function renderMonthValues(
  metric
) {

  const monthly =
    metric.monthly ||
    [];

  return monthly
    .map(
      (item) =>
        `
        <div class="month-value">

          <span class="month-name">
            ${escapeHtml(
              item.month
            )}
          </span>

          <span class="month-number">
            ${
              item.actual !==
                null &&
              item.actual !==
                undefined
                ? escapeHtml(
                    formatValue(
                      item.actual,
                      item.actualRaw,
                      metric
                    )
                  )
                : "—"
            }
          </span>

        </div>
        `
    )
    .join("");

}

/* =========================================================
   DESCRIPTION
========================================================= */

function getMetricDescriptor(
  metric
) {

  if (
    metric.metric
      .toLowerCase()
      .includes("nps")
  ) {

    return "Customer advocacy score";

  }

  if (
    metric.metric
      .toLowerCase()
      .includes("fixed pay")
  ) {

    return "Fixed-pay placement outcome";

  }

  if (
    metric.metric
      .toLowerCase()
      .includes(
        "uncertain pay"
      )
  ) {

    return "Uncertain-pay placement outcome";

  }

  if (
    metric.metric
      .toLowerCase()
      .includes("i2h")
  ) {

    return "Interview-to-hire ratio · lower is better";

  }

  if (
    metric.metric
      .toLowerCase()
      .includes(
        "aspirational"
      )
  ) {

    return "Aspirational placement outcome";

  }

  if (
    metric.metric
      .toLowerCase()
      .includes(
        "scaler 3.0"
      )
  ) {

    return "Program experience target";

  }

  return "Key result";

}

/* =========================================================
   FORMAT VALUE
========================================================= */

function formatValue(
  numericValue,
  rawValue,
  metric
) {

  if (
    numericValue ===
      null ||
    numericValue ===
      undefined
  ) {

    return (
      rawValue ||
      "—"
    );

  }

  const number =
    formatNumber(
      numericValue
    );

  if (
    metric.metric
      .toLowerCase()
      .includes(
        "i2h"
      )
  ) {

    return `${number}%`;

  }

  return number;

}

/* =========================================================
   NUMBER FORMAT
========================================================= */

function formatNumber(
  value
) {

  if (
    value ===
      null ||
    value ===
      undefined ||
    Number.isNaN(
      Number(value)
    )
  ) {

    return "—";

  }

  const number =
    Number(value);

  if (
    Number.isInteger(
      number
    )
  ) {

    return String(
      number
    );

  }

  return number
    .toFixed(2)
    .replace(
      /\.?0+$/,
      ""
    );

}

/* =========================================================
   SYSTEM MESSAGE
========================================================= */

function showSystemMessage(
  message
) {

  const element =
    $("#systemMessage");

  if (!element) {
    return;
  }

  element.classList.remove(
    "hidden"
  );

  element.textContent =
    message;

}

function hideSystemMessage() {

  const element =
    $("#systemMessage");

  if (!element) {
    return;
  }

  element.classList.add(
    "hidden"
  );

}

/* =========================================================
   ESCAPING
========================================================= */

function escapeHtml(
  value
) {

  return String(
    value
  ).replace(
    /[&<>"']/g,
    (character) => ({
      "&":
        "&amp;",
      "<":
        "&lt;",
      ">":
        "&gt;",
      '"':
        "&quot;",
      "'":
        "&#39;",
    })[
      character
    ]
  );

}

/* =========================================================
   AUTO REFRESH
========================================================= */

setInterval(
  async () => {

    try {

      await loadMetrics();

    } catch (error) {

      console.error(
        "Auto refresh failed:",
        error
      );

    }

  },
  5 * 60 * 1000
);

/* =========================================================
   START
========================================================= */

boot();
