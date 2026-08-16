const express = require("express");
const session = require("express-session");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 3000;

const KR_CSV_URL = process.env.KR_CSV_URL || "";
const ACCESS_CSV_URL = process.env.ACCESS_CSV_URL || "";
const DASHBOARD_PASSWORD =
  process.env.DASHBOARD_PASSWORD || "";

const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  "kr-pulse-session-secret";

const REFRESH_MS = 5 * 60 * 1000;

/* =========================================================
   APP CONFIG
========================================================= */

app.use(express.json());

app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      maxAge: 8 * 60 * 60 * 1000
    }
  })
);

/*
 * FRONTEND FILES
 *
 * These must exist here:
 *
 * public/
 *   index.html
 *   app.js
 *   styles.css
 */
app.use(
  express.static(
    path.join(__dirname, "public")
  )
);

/* =========================================================
   DATA CACHE
========================================================= */

let cachedMetrics = [];
let lastFetchedAt = 0;

/* =========================================================
   GOOGLE SHEET FETCH
========================================================= */

async function fetchGoogleSheet(url) {
  if (!url) {
    throw new Error(
      "Google Sheet URL is not configured."
    );
  }

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Google Sheet returned HTTP ${response.status}`
    );
  }

  return await response.text();
}

/* =========================================================
   CSV PARSER
========================================================= */

function parseCSV(text) {
  const lines = text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "");

  if (!lines.length) {
    return [];
  }

  const headers =
    lines[0]
      .split(",")
      .map((header) =>
        header.trim()
          .replace(/^"|"$/g, "")
      );

  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const values =
      lines[i]
        .split(",")
        .map((value) =>
          value.trim()
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
   BASIC NUMBER PARSER
========================================================= */

function parseNumber(value) {
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

  if (!text) {
    return null;
  }

  const match =
    text.match(
      /-?\d+(\.\d+)?/
    );

  if (!match) {
    return null;
  }

  return Number(match[0]);
}

/* =========================================================
   NORMALIZE KR DATA
========================================================= */

function normalizeMetrics(rows) {
  if (!rows.length) {
    return [];
  }

  const headers =
    Object.keys(rows[0]);

  const findHeader = (
    possibleNames
  ) => {
    return headers.find(
      (header) => {
        const normalized =
          header
            .toLowerCase()
            .replace(
              /[^a-z0-9]/g,
              ""
            );

        return possibleNames.some(
          (name) =>
            normalized.includes(
              name
            )
        );
      }
    );
  };

  const programColumn =
    findHeader([
      "program",
      "course",
      "vertical"
    ]);

  const metricColumn =
    findHeader([
      "metric",
      "kr",
      "kpi",
      "keyresult"
    ]);

  const targetColumn =
    findHeader([
      "target",
      "goal"
    ]);

  const actualColumn =
    findHeader([
      "actual",
      "current",
      "achieved",
      "value"
    ]);

  const stakeholderColumn =
    findHeader([
      "stakeholder",
      "owner",
      "instructor"
    ]);

  const monthColumn =
    findHeader([
      "month",
      "period",
      "date"
    ]);

  /*
   * If the sheet doesn't have the expected
   * long-format columns, return the raw
   * rows rather than crashing the app.
   */
  if (
    !metricColumn ||
    !targetColumn ||
    !actualColumn
  ) {
    console.log(
      "KR sheet uses a different structure."
    );

    return [];
  }

  return rows
    .map((row, index) => ({
      id: index,

      program:
        programColumn
          ? String(
              row[programColumn] ||
                "All"
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
          row[metricColumn] ||
            ""
        ).trim(),

      target:
        parseNumber(
          row[targetColumn]
        ),

      actual:
        parseNumber(
          row[actualColumn]
        ),

      targetRaw:
        row[targetColumn] || "",

      actualRaw:
        row[actualColumn] || "",

      month:
        monthColumn
          ? String(
              row[monthColumn] ||
                ""
            ).trim()
          : ""
    }))
    .filter(
      (row) =>
        row.metric
    );
}

/* =========================================================
   LOAD METRICS
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

  try {
    const csv =
      await fetchGoogleSheet(
        KR_CSV_URL
      );

    const rawRows =
      parseCSV(csv);

    cachedMetrics =
      normalizeMetrics(
        rawRows
      );

    lastFetchedAt =
      Date.now();

    console.log(
      `Loaded ${cachedMetrics.length} metrics`
    );

    return cachedMetrics;

  } catch (error) {
    console.error(
      "Failed to load KR data:",
      error.message
    );

    /*
     * Don't crash the server.
     */
    return cachedMetrics;
  }
}

/* =========================================================
   AUTH MIDDLEWARE
========================================================= */

function requireAuth(
  req,
  res,
  next
) {
  if (
    req.session &&
    req.session.user
  ) {
    return next();
  }

  return res.status(401).json({
    error:
      "Unauthorized"
  });
}

/* =========================================================
   LOGIN
========================================================= */

app.post(
  "/api/login",
  (req, res) => {
    const {
      username,
      password
    } = req.body || {};

    if (
      !username ||
      !password
    ) {
      return res.status(400).json({
        error:
          "Username and password are required."
      });
    }

    /*
     * Founder login.
     *
     * USERNAME:
     * founder
     *
     * PASSWORD:
     * DASHBOARD_PASSWORD
     * Railway variable
     */

    if (
      String(username)
        .trim()
        .toLowerCase() !==
      "founder"
    ) {
      return res.status(401).json({
        error:
          "Invalid credentials."
      });
    }

    if (
      !DASHBOARD_PASSWORD
    ) {
      return res.status(500).json({
        error:
          "DASHBOARD_PASSWORD is missing in Railway."
      });
    }

    if (
      String(password).trim() !==
      String(
        DASHBOARD_PASSWORD
      ).trim()
    ) {
      return res.status(401).json({
        error:
          "Invalid credentials."
      });
    }

    /*
     * Login successful.
     */
    req.session.user = {
      username: "founder",
      program: "All"
    };

    return res.json({
      ok: true,
      user: req.session.user
    });
  }
);

/* =========================================================
   CURRENT USER
========================================================= */

app.get(
  "/api/me",
  (req, res) => {
    res.json({
      user:
        req.session &&
        req.session.user
          ? req.session.user
          : null
    });
  }
);

/* =========================================================
   LOGOUT
========================================================= */

app.post(
  "/api/logout",
  (req, res) => {
    req.session.destroy(
      () => {
        res.json({
          ok: true
        });
      }
    );
  }
);

/* =========================================================
   METRICS API
========================================================= */

app.get(
  "/api/metrics",
  requireAuth,
  async (req, res) => {
    const metrics =
      await loadMetrics();

    res.json({
      rows: metrics,

      fetchedAt:
        lastFetchedAt,

      refreshEveryMs:
        REFRESH_MS,

      user:
        req.session.user
    });
  }
);

/* =========================================================
   FORCE REFRESH
========================================================= */

app.post(
  "/api/refresh",
  requireAuth,
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
   HEALTH CHECK
========================================================= */

app.get(
  "/health",
  (req, res) => {
    res.json({
      status: "ok",
      service:
        "KR Pulse",
      timestamp:
        new Date().toISOString()
    });
  }
);

/* =========================================================
   FALLBACK
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
   START SERVER
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

    console.log(
      `Access CSV configured: ${Boolean(
        ACCESS_CSV_URL
      )}`
    );

    console.log(
      `Dashboard password configured: ${Boolean(
        DASHBOARD_PASSWORD
      )}`
    );
  }
);
