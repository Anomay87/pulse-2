const express = require("express");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 3000;

const KR_CSV_URL =
  process.env.KR_CSV_URL || "";

const REFRESH_MS = 5 * 60 * 1000;

app.use(express.json());

/* =========================================================
   SERVE FRONTEND
========================================================= */

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
   CSV PARSER
========================================================= */

function parseCSV(text) {
  const lines = text
    .split(/\r?\n/)
    .filter(
      (line) =>
        line.trim() !== ""
    );

  if (!lines.length) {
    return [];
  }

  const headers =
    lines[0]
      .split(",")
      .map((value) =>
        value
          .trim()
          .replace(/^"|"$/g, "")
      );

  const rows = [];

  for (
    let i = 1;
    i < lines.length;
    i++
  ) {
    const values =
      lines[i]
        .split(",")
        .map((value) =>
          value
            .trim()
            .replace(/^"|"$/g, "")
        );

    const row = {};

    headers.forEach(
      (header, index) => {
        row[header] =
          values[index] || "";
      }
    );

    rows.push(row);
  }

  return rows;
}

/* =========================================================
   HELPERS
========================================================= */

function number(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const text =
    String(value)
      .trim()
      .replace(/,/g, "")
      .replace(/%/g, "");

  const match =
    text.match(
      /-?\d+(?:\.\d+)?/
    );

  return match
    ? Number(match[0])
    : null;
}

function findColumn(
  headers,
  names
) {
  return headers.find(
    (header) => {
      const key =
        header
          .toLowerCase()
          .replace(
            /[^a-z0-9]/g,
            ""
          );

      return names.some(
        (name) =>
          key.includes(name)
      );
    }
  );
}

/* =========================================================
   NORMALIZE DATA
========================================================= */

function normalizeMetrics(rows) {
  if (!rows.length) {
    return [];
  }

  const headers =
    Object.keys(rows[0]);

  const programColumn =
    findColumn(headers, [
      "program",
      "course",
      "vertical"
    ]);

  const metricColumn =
    findColumn(headers, [
      "metric",
      "kr",
      "kpi",
      "keyresult"
    ]);

  const targetColumn =
    findColumn(headers, [
      "target",
      "goal"
    ]);

  const actualColumn =
    findColumn(headers, [
      "actual",
      "current",
      "achieved",
      "value"
    ]);

  const stakeholderColumn =
    findColumn(headers, [
      "stakeholder",
      "owner",
      "instructor"
    ]);

  const monthColumn =
    findColumn(headers, [
      "month",
      "period",
      "date"
    ]);

  /*
   * Expected format:
   *
   * Program
   * Stakeholder
   * Metric
   * Target
   * Actual
   * Month
   */

  if (
    !metricColumn ||
    !targetColumn ||
    !actualColumn
  ) {
    console.log(
      "Could not identify metric/target/actual columns."
    );

    console.log(
      "Available columns:",
      headers
    );

    return [];
  }

  return rows
    .map(
      (row, index) => ({
        id: index,

        program:
          programColumn
            ? String(
                row[
                  programColumn
                ] || "All"
              ).trim()
            : "All",

        stakeholder:
          stakeholderColumn
            ? String(
                row[
                  stakeholderColumn
                ] || "Team"
              ).trim()
            : "Team",

        metric:
          String(
            row[
              metricColumn
            ] || ""
          ).trim(),

        target:
          number(
            row[
              targetColumn
            ]
          ),

        actual:
          number(
            row[
              actualColumn
            ]
          ),

        targetRaw:
          row[
            targetColumn
          ] || "",

        actualRaw:
          row[
            actualColumn
          ] || "",

        month:
          monthColumn
            ? String(
                row[
                  monthColumn
                ] || ""
              ).trim()
            : ""
      })
    )
    .filter(
      (row) =>
        row.metric
    );
}

/* =========================================================
   GOOGLE SHEET
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
        KR_CSV_URL
      );

    if (!response.ok) {
      throw new Error(
        `Google Sheets returned ${response.status}`
      );
    }

    const csv =
      await response.text();

    const rawRows =
      parseCSV(csv);

    console.log(
      `Google Sheet rows: ${rawRows.length}`
    );

    cachedMetrics =
      normalizeMetrics(
        rawRows
      );

    lastFetchedAt =
      Date.now();

    console.log(
      `Normalized metrics: ${cachedMetrics.length}`
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
   PUBLIC METRICS API
========================================================= */

app.get(
  "/api/metrics",
  async (req, res) => {
    const metrics =
      await loadMetrics();

    res.json({
      rows: metrics,

      fetchedAt:
        lastFetchedAt,

      refreshEveryMs:
        REFRESH_MS
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
        lastFetchedAt
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
        new Date().toISOString()
    });
  }
);

/* =========================================================
   FRONTEND FALLBACK
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
   START
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
