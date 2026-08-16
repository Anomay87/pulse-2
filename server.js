const express = require("express");
const path = require("path");
const { parse } = require("csv-parse/sync");

const app = express();

const PORT = process.env.PORT || 3000;

const KR_CSV_URL =
  process.env.KR_CSV_URL || "";

const REFRESH_MS =
  5 * 60 * 1000;

/* =========================================================
   APP SETUP
========================================================= */

app.use(express.json());

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);

/* =========================================================
   CACHE
========================================================= */

let cachedMetrics = [];
let lastFetchedAt = 0;

/* =========================================================
   MONTHS
========================================================= */

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sept",
  "Oct",
  "Nov",
  "Dec",
];

/*
 * Google Sheet layout:
 *
 * Column 0  = Program
 * Column 1  = Track
 * Column 2  = Main Stakeholder
 * Column 3  = Secondary Stakeholder
 * Column 4  = KR Metric
 * Column 5  = Offers division
 * Column 6  = Base reference
 *
 * Then:
 *
 * Jan target
 * Jan final
 * Feb target
 * Feb final
 * ...
 * Dec target
 * Dec final
 */

const FIRST_MONTH_COLUMN = 7;

/* =========================================================
   HELPERS
========================================================= */

function cleanText(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

function isBlank(value) {
  return (
    value === undefined ||
    value === null ||
    String(value).trim() === ""
  );
}

function parseNumber(value) {
  if (
    value === undefined ||
    value === null
  ) {
    return null;
  }

  let text = String(value)
    .trim()
    .replace(/,/g, "");

  if (!text) {
    return null;
  }

  /*
   * Values such as:
   * NA
   * #VALUE!
   * Will be decided
   * are not numeric.
   */

  if (
    /^NA$/i.test(text) ||
    /^N\/A$/i.test(text) ||
    /^#VALUE!$/i.test(text) ||
    /^Will be decided$/i.test(text)
  ) {
    return null;
  }

  /*
   * Percentages.
   */

  text = text.replace(/%/g, "");

  /*
   * Ranges such as 4.7-4.8.
   * Use midpoint for calculations.
   */

  const range =
    text.match(
      /^(-?\d+(?:\.\d+)?)\s*[-–—]\s*(-?\d+(?:\.\d+)?)$/
    );

  if (range) {
    return (
      (Number(range[1]) +
        Number(range[2])) /
      2
    );
  }

  const match =
    text.match(
      /-?\d+(?:\.\d+)?/
    );

  if (!match) {
    return null;
  }

  return Number(match[0]);
}

function formatNumber(value) {
  if (
    value === null ||
    value === undefined ||
    Number.isNaN(value)
  ) {
    return null;
  }

  if (
    Number.isInteger(value)
  ) {
    return String(value);
  }

  return value
    .toFixed(2)
    .replace(/\.?0+$/, "");
}

/* =========================================================
   METRIC NAME
========================================================= */

function getMetricName(
  metric,
  offersDivision
) {
  const metricText =
    cleanText(metric);

  const division =
    cleanText(
      offersDivision
    );

  /*
   * "No of Offers" is the parent metric.
   *
   * We want:
   * Fixed Pay
   * Uncertain Pay
   *
   * rather than repeatedly displaying
   * "No of Offers".
   */

  if (
    metricText.toLowerCase() ===
      "no of offers" &&
    division
  ) {
    return division;
  }

  if (
    metricText
      .toLowerCase()
      .includes("nps")
  ) {
    return "NPS";
  }

  return metricText;
}

/* =========================================================
   METRIC DIRECTION
========================================================= */

function isLowerBetter(
  metricName
) {
  /*
   * For I2H, lower is better.
   *
   * Example:
   * Target = 12%
   * Actual = 13.98%
   *
   * This is therefore NOT on target.
   */

  return metricName
    .toLowerCase()
    .includes("i2h");
}

/* =========================================================
   FIND HEADER ROW
========================================================= */

function findHeaderRow(
  rows
) {
  for (
    let index = 0;
    index < rows.length;
    index++
  ) {
    const row = rows[index];

    const joined =
      row
        .map((cell) =>
          cleanText(cell)
            .toLowerCase()
        )
        .join("|");

    if (
      joined.includes(
        "program"
      ) &&
      joined.includes(
        "kr metric"
      ) &&
      joined.includes(
        "jan target"
      )
    ) {
      return index;
    }
  }

  return -1;
}

/* =========================================================
   READ MONTHLY DATA FOR ONE ROW
========================================================= */

function readMonthlyData(
  row,
  metricName
) {
  const monthly = [];

  for (
    let monthIndex = 0;
    monthIndex <
    MONTHS.length;
    monthIndex++
  ) {
    const targetIndex =
      FIRST_MONTH_COLUMN +
      monthIndex * 2;

    const finalIndex =
      targetIndex + 1;

    const targetRaw =
      cleanText(
        row[targetIndex]
      );

    const finalRaw =
      cleanText(
        row[finalIndex]
      );

    const target =
      parseNumber(
        targetRaw
      );

    const actual =
      parseNumber(
        finalRaw
      );

    monthly.push({
      month:
        MONTHS[monthIndex],

      target,

      actual,

      targetRaw,

      actualRaw: finalRaw,

      hasActual:
        actual !== null,
    });
  }

  return monthly;
}

/* =========================================================
   PARSE GOOGLE SHEET
========================================================= */

function parseGoogleSheet(
  csvText
) {
  /*
   * IMPORTANT:
   * We intentionally do NOT use
   * columns:true here.
   *
   * The Google Sheet contains:
   * title rows,
   * blank rows,
   * merged cells,
   * and the real header starts later.
   */

  const rows =
    parse(csvText, {
      columns: false,

      skip_empty_lines: false,

      relax_column_count: true,

      relax_quotes: true,

      bom: true,

      trim: false,
    });

  if (!rows.length) {
    return [];
  }

  const headerIndex =
    findHeaderRow(rows);

  if (headerIndex === -1) {
    console.error(
      "Could not locate KR table header."
    );

    return [];
  }

  console.log(
    `KR header found on row ${headerIndex + 1}`
  );

  let currentProgram = "";

  const rawMetrics = [];

  /*
   * Start after the real header.
   */

  for (
    let rowIndex =
      headerIndex + 1;
    rowIndex < rows.length;
    rowIndex++
  ) {
    const row =
      rows[rowIndex];

    if (!row) {
      continue;
    }

    /*
     * Program is only written once
     * and then blank for subsequent
     * stakeholder rows.
     *
     * So we carry it forward.
     */

    const programCell =
      cleanText(row[0]);

    if (programCell) {
      currentProgram =
        programCell;
    }

    /*
     * Ignore completely blank rows.
     */

    const hasAnyValue =
      row.some(
        (cell) =>
          !isBlank(cell)
      );

    if (!hasAnyValue) {
      continue;
    }

    const track =
      cleanText(row[1]);

    const mainStakeholder =
      cleanText(row[2]);

    const secondaryStakeholder =
      cleanText(row[3]);

    const metric =
      cleanText(row[4]);

    const offersDivision =
      cleanText(row[5]);

    /*
     * A metric row must have a KR metric.
     */

    if (!metric) {
      continue;
    }

    if (!currentProgram) {
      continue;
    }

    const metricName =
      getMetricName(
        metric,
        offersDivision
      );

    const monthly =
      readMonthlyData(
        row,
        metricName
      );

    rawMetrics.push({
      program:
        currentProgram,

      track,

      mainStakeholder,

      secondaryStakeholder,

      metric:
        metricName,

      originalMetric:
        metric,

      offersDivision,

      lowerBetter:
        isLowerBetter(
          metricName
        ),

      monthly,
    });
  }

  console.log(
    `Raw KR metric rows: ${rawMetrics.length}`
  );

  return consolidateMetrics(
    rawMetrics
  );
}

/* =========================================================
   CONSOLIDATE TO PROGRAM LEVEL
========================================================= */

function consolidateMetrics(
  rawRows
) {
  const grouped =
    new Map();

  rawRows.forEach(
    (row) => {
      /*
       * We intentionally remove stakeholder
       * from the grouping key.
       *
       * This produces the founder-level:
       *
       * Academy
       * DSML
       * AIML
       * DevOps
       * FDE
       */

      const key =
        `${row.program}|||${row.metric}`;

      if (
        !grouped.has(key)
      ) {
        grouped.set(
          key,
          {
            program:
              row.program,

            metric:
              row.metric,

            lowerBetter:
              row.lowerBetter,

            sourceRows: [],

            monthly: MONTHS.map(
              (month) => ({
                month,

                targets: [],

                actuals: [],

                targetRaws: [],

                actualRaws: [],
              })
            ),
          }
        );
      }

      const group =
        grouped.get(key);

      group.sourceRows.push(
        row
      );

      row.monthly.forEach(
        (monthData, index) => {
          const bucket =
            group.monthly[index];

          if (
            monthData.target !==
              null &&
            monthData.target !==
              undefined
          ) {
            bucket.targets.push(
              monthData.target
            );
          }

          if (
            monthData.actual !==
              null &&
            monthData.actual !==
              undefined
          ) {
            bucket.actuals.push(
              monthData.actual
            );
          }

          if (
            monthData.targetRaw
          ) {
            bucket.targetRaws.push(
              monthData.targetRaw
            );
          }

          if (
            monthData.actualRaw
          ) {
            bucket.actualRaws.push(
              monthData.actualRaw
            );
          }
        }
      );
    }
  );

  const output = [];

  grouped.forEach(
    (group) => {
      /*
       * Consolidate every month.
       *
       * We use the average because the sheet
       * repeats program-level goals across
       * stakeholder blocks.
       */

      const consolidatedMonthly =
        group.monthly.map(
          (bucket) => {
            const target =
              bucket.targets
                .length
                ? average(
                    bucket.targets
                  )
                : null;

            const actual =
              bucket.actuals
                .length
                ? average(
                    bucket.actuals
                  )
                : null;

            return {
              month:
                bucket.month,

              target,

              actual,

              targetRaw:
                bucket.targetRaws.length
                  ? bucket.targetRaws[0]
                  : target !== null
                  ? formatNumber(
                      target
                    )
                  : "",

              actualRaw:
                bucket.actualRaws.length
                  ? bucket.actualRaws[
                      bucket.actualRaws
                        .length -
                        1
                    ]
                  : actual !== null
                  ? formatNumber(
                      actual
                    )
                  : "",
            };
          }
        );

      /*
       * Find the latest month that
       * has an actual/final number.
       */

      let latestIndex =
        -1;

      for (
        let i = 0;
        i <
        consolidatedMonthly.length;
        i++
      ) {
        if (
          consolidatedMonthly[i]
            .actual !== null
        ) {
          latestIndex = i;
        }
      }

      let latest =
        latestIndex >= 0
          ? consolidatedMonthly[
              latestIndex
            ]
          : null;

      /*
       * If there is no numerical actual,
       * still publish the metric, but mark
       * it as unavailable.
       */

      output.push({
        id:
          `${group.program}-${group.metric}`,

        program:
          group.program,

        stakeholder:
          "Program Total",

        metric:
          group.metric,

        target:
          latest
            ? latest.target
            : null,

        actual:
          latest
            ? latest.actual
            : null,

        targetRaw:
          latest
            ? latest.targetRaw
            : "",

        actualRaw:
          latest
            ? latest.actualRaw
            : "",

        month:
          latest
            ? latest.month
            : "",

        unit:
          inferUnit(
            group.metric
          ),

        lowerBetter:
          group.lowerBetter,

        monthly:
          consolidatedMonthly,
      });
    }
  );

  return output;
}

/* =========================================================
   AVERAGE
========================================================= */

function average(values) {
  if (!values.length) {
    return null;
  }

  return (
    values.reduce(
      (sum, value) =>
        sum + value,
      0
    ) /
    values.length
  );
}

/* =========================================================
   UNIT
========================================================= */

function inferUnit(
  metric
) {
  if (
    metric
      .toLowerCase()
      .includes("i2h")
  ) {
    return "%";
  }

  return "";
}

/* =========================================================
   GOOGLE SHEETS LOADER
========================================================= */

async function loadMetrics(
  force = false
) {
  const cacheIsFresh =
    lastFetchedAt > 0 &&
    Date.now() -
      lastFetchedAt <
      REFRESH_MS;

  if (
    !force &&
    cacheIsFresh
  ) {
    return cachedMetrics;
  }

  if (!KR_CSV_URL) {
    console.error(
      "KR_CSV_URL is missing."
    );

    return cachedMetrics;
  }

  try {
    const response =
      await fetch(
        KR_CSV_URL,
        {
          redirect:
            "follow",
        }
      );

    if (!response.ok) {
      throw new Error(
        `Google Sheets returned HTTP ${response.status}`
      );
    }

    const csv =
      await response.text();

    cachedMetrics =
      parseGoogleSheet(
        csv
      );

    lastFetchedAt =
      Date.now();

    console.log(
      `Final dashboard metrics: ${cachedMetrics.length}`
    );

    cachedMetrics.forEach(
      (metric) => {
        console.log(
          `${metric.program} | ${metric.metric} | ${metric.actual} / ${metric.target} | ${metric.month}`
        );
      }
    );
  } catch (error) {
    console.error(
      "Google Sheet error:",
      error.message
    );
  }

  return cachedMetrics;
}

/* =========================================================
   METRICS API
========================================================= */

app.get(
  "/api/metrics",
  async (req, res) => {
    const metrics =
      await loadMetrics();

    res.json({
      rows:
        metrics,

      fetchedAt:
        lastFetchedAt,

      refreshEveryMs:
        REFRESH_MS,
    });
  }
);

/* =========================================================
   MANUAL REFRESH
========================================================= */

app.post(
  "/api/refresh",
  async (req, res) => {
    const metrics =
      await loadMetrics(
        true
      );

    res.json({
      ok: true,

      count:
        metrics.length,

      fetchedAt:
        lastFetchedAt,
    });
  }
);

/* =========================================================
   HEALTH
========================================================= */

app.get(
  "/health",
  (req, res) => {
    res.json({
      status: "ok",

      service:
        "KR Pulse",

      time:
        new Date().toISOString(),
    });
  }
);

/* =========================================================
   FRONTEND
========================================================= */

app.get(
  "*",
  (req, res) => {
    res.sendFile(
      path.join(
        __dirname,
        "public",
        "index.html"
      )
    );
  }
);

/* =========================================================
   SERVER
========================================================= */

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `KR Pulse running on port ${PORT}`
    );

    console.log(
      `KR CSV configured: ${Boolean(
        KR_CSV_URL
      )}`
    );
  }
);
