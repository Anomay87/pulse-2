const express = require("express");
const session = require("express-session");
const path = require("path");
const { parse } = require("csv-parse/sync");

const app = express();

const PORT = process.env.PORT || 3000;

const KR_CSV_URL = process.env.KR_CSV_URL;
const ACCESS_CSV_URL = process.env.ACCESS_CSV_URL;
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD;

const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  "kr-pulse-development-secret-change-this";

const REFRESH_MS = 5 * 60 * 1000;

app.use(express.json({ limit: "100kb" }));

app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      maxAge: 8 * 60 * 60 * 1000,
    },
  })
);

/*
|--------------------------------------------------------------------------
| STATIC FILES
|--------------------------------------------------------------------------
*/

app.use(express.static(path.join(__dirname, "public")));

/*
|--------------------------------------------------------------------------
| CACHE
|--------------------------------------------------------------------------
*/

let cache = {
  metrics: null,
  access: null,
  fetchedAt: 0,
};

/*
|--------------------------------------------------------------------------
| HELPERS
|--------------------------------------------------------------------------
*/

function cleanKey(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[%()₹$]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normText(value) {
  return String(value ?? "").trim();
}

function num(value) {
  if (value === null || value === undefined) {
    return null;
  }

  let text = String(value).trim();

  if (!text) {
    return null;
  }

  if (
    /^n\/?a$/i.test(text) ||
    /^na$/i.test(text) ||
    /^-+$/.test(text)
  ) {
    return null;
  }

  text = text
    .replace(/,/g, "")
    .replace(/₹/g, "")
    .trim();

  /*
   * Handle ranges such as:
   * 4.7-4.8
   * 80-90
   */
  const range = text.match(
    /(-?\d+(?:\.\d+)?)\s*(?:-|to|–|—)\s*(-?\d+(?:\.\d+)?)/i
  );

  if (range) {
    return (
      (Number(range[1]) + Number(range[2])) / 2
    );
  }

  const match = text.match(
    /-?\d+(?:\.\d+)?/
  );

  return match ? Number(match[0]) : null;
}

function isPercentLike(header, rawValue) {
  return (
    /%|percent|percentage|i2h|pay/i.test(
      String(header ?? "")
    ) ||
    /%/.test(String(rawValue ?? ""))
  );
}

function headersFromRows(rows) {
  if (!rows.length) {
    return [];
  }

  return Object.keys(rows[0]);
}

function findColumn(headers, patterns) {
  const keyed = headers.map((header) => ({
    raw: header,
    key: cleanKey(header),
  }));

  for (const pattern of patterns) {
    const regex = new RegExp(pattern, "i");

    const found = keyed.find((item) =>
      regex.test(item.key)
    );

    if (found) {
      return found.raw;
    }
  }

  return null;
}

/*
|--------------------------------------------------------------------------
| KR DATA NORMALIZATION
|--------------------------------------------------------------------------
*/

function inferLongRows(rows) {
  if (!rows.length) {
    return [];
  }

  const headers = headersFromRows(rows);

  const programCol = findColumn(headers, [
    "program",
    "course",
    "vertical",
    "business_unit",
    "stream",
  ]);

  const stakeholderCol = findColumn(headers, [
    "stakeholder",
    "owner",
    "instructor",
    "person",
    "module_owner",
  ]);

  const metricCol = findColumn(headers, [
    "metric",
    "kr",
    "kpi",
    "key_result",
    "measure",
    "goal",
  ]);

  const targetCol = findColumn(headers, [
    "target",
    "goal",
    "target_value",
  ]);

  const actualCol = findColumn(headers, [
    "actual",
    "current",
    "achieved",
    "value",
  ]);

  const monthCol = findColumn(headers, [
    "month",
    "period",
    "date",
    "timeline",
  ]);

  if (!metricCol || !targetCol || !actualCol) {
    return null;
  }

  return rows
    .map((row, index) => ({
      id: index,

      program: normText(
        programCol
          ? row[programCol]
          : "All"
      ),

      stakeholder: normText(
        stakeholderCol
          ? row[stakeholderCol]
          : "Team"
      ),

      metric: normText(row[metricCol]),

      target: num(row[targetCol]),

      actual: num(row[actualCol]),

      targetRaw: normText(row[targetCol]),

      actualRaw: normText(row[actualCol]),

      month: normText(
        monthCol
          ? row[monthCol]
          : ""
      ),

      unit:
        isPercentLike(
          metricCol,
          row[metricCol]
        ) ||
        isPercentLike(
          targetCol,
          row[targetCol]
        )
          ? "%"
          : "",
    }))
    .filter((row) => row.metric);
}

function inferWideRows(rows) {
  if (!rows.length) {
    return [];
  }

  const headers = headersFromRows(rows);

  const programCol = findColumn(headers, [
    "program",
    "course",
    "vertical",
    "business_unit",
    "stream",
  ]);

  const stakeholderCol = findColumn(headers, [
    "stakeholder",
    "owner",
    "instructor",
    "person",
    "module_owner",
  ]);

  const monthCol = findColumn(headers, [
    "month",
    "period",
    "date",
    "timeline",
  ]);

  const metricPairs = [];

  for (const header of headers) {
    const key = cleanKey(header);

    if (
      /target|goal/.test(key)
    ) {
      const base = key.replace(
        /_?target|_?goal/g,
        ""
      );

      const actualCol = headers.find(
        (candidate) => {
          const candidateKey =
            cleanKey(candidate);

          return (
            candidateKey ===
              `${base}_actual` ||
            candidateKey ===
              `${base}_current` ||
            candidateKey === base
          );
        }
      );

      if (actualCol) {
        metricPairs.push({
          metric: base
            .replace(/_/g, " ")
            .trim(),

          targetCol: header,

          actualCol,
        });
      }
    }
  }

  if (!metricPairs.length) {
    return [];
  }

  const output = [];

  rows.forEach((row, index) => {
    metricPairs.forEach((pair) => {
      if (
        row[pair.targetCol] === undefined &&
        row[pair.actualCol] === undefined
      ) {
        return;
      }

      const metricName =
        pair.metric
          .replace(/\b\w/g, (char) =>
            char.toUpperCase()
          );

      output.push({
        id: `${index}-${metricName}`,

        program: normText(
          programCol
            ? row[programCol]
            : "All"
        ),

        stakeholder: normText(
          stakeholderCol
            ? row[stakeholderCol]
            : "Team"
        ),

        metric: metricName,

        target: num(
          row[pair.targetCol]
        ),

        actual: num(
          row[pair.actualCol]
        ),

        targetRaw: normText(
          row[pair.targetCol]
        ),

        actualRaw: normText(
          row[pair.actualCol]
        ),

        month: normText(
          monthCol
            ? row[monthCol]
            : ""
        ),

        unit:
          isPercentLike(
            metricName,
            row[pair.targetCol]
          )
            ? "%"
            : "",
      });
    });
  });

  return output;
}

function normalizeMetrics(csvText) {
  const rows = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    bom: true,
    trim: true,
  });

  const longRows = inferLongRows(rows);

  if (longRows !== null) {
    return longRows;
  }

  return inferWideRows(rows);
}

/*
|--------------------------------------------------------------------------
| ACCESS DATA
|--------------------------------------------------------------------------
*/

function normalizeAccess(csvText) {
  const rows = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    bom: true,
    trim: true,
  });

  if (!rows.length) {
    return [];
  }

  const headers = headersFromRows(rows);

  const userCol = findColumn(headers, [
    "username",
    "user",
    "login",
    "email",
    "employee_email",
  ]);

  const passCol = findColumn(headers, [
    "password",
    "pass",
    "pwd",
  ]);

  const programCol = findColumn(headers, [
    "program",
    "course",
    "vertical",
    "access",
  ]);

  if (!userCol || !passCol) {
    return [];
  }

  return rows
    .map((row) => ({
      username: normText(
        row[userCol]
      ),

      password: normText(
        row[passCol]
      ),

      program: programCol
        ? normText(row[programCol])
        : "All",
    }))
    .filter(
      (row) =>
        row.username &&
        row.password
    );
}

/*
|--------------------------------------------------------------------------
| GOOGLE SHEETS FETCH
|--------------------------------------------------------------------------
*/

async function fetchText(url) {
  if (!url) {
    throw new Error(
      "Google Sheet URL is not configured."
    );
  }

  const response = await fetch(url, {
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(
      `Google Sheet fetch failed: ${response.status}`
    );
  }

  return response.text();
}

async function getData(force = false) {
  const cacheIsFresh =
    cache.metrics &&
    Date.now() - cache.fetchedAt <
      REFRESH_MS;

  if (!force && cacheIsFresh) {
    return cache;
  }

  /*
   * KR data is mandatory.
   * Access data is optional because the primary
   * founder login is controlled through
   * DASHBOARD_PASSWORD.
   */
  const krCsv = await fetchText(
    KR_CSV_URL
  );

  let access = [];

  if (ACCESS_CSV_URL) {
    try {
      const accessCsv =
        await fetchText(
          ACCESS_CSV_URL
        );

      access =
        normalizeAccess(accessCsv);
    } catch (error) {
      console.warn(
        "Access CSV could not be loaded:",
        error.message
      );
    }
  }

  const metrics =
    normalizeMetrics(krCsv);

  cache = {
    metrics,
    access,
    fetchedAt: Date.now(),
  };

  return cache;
}

/*
|--------------------------------------------------------------------------
| AUTHENTICATION
|--------------------------------------------------------------------------
*/

function requireAuth(
  req,
  res,
  next
) {
  if (!req.session.user) {
    return res.status(401).json({
      error: "Unauthorized",
    });
  }

  next();
}

app.post(
  "/api/login",
  async (req, res) => {
    try {
      const {
        username,
        password,
      } = req.body || {};

      if (
        !username ||
        !password
      ) {
        return res.status(400).json({
          error:
            "Username and password are required.",
        });
      }

      /*
       * Founder demo credentials.
       *
       * Username is always:
       * founder
       *
       * Password is controlled through:
       * DASHBOARD_PASSWORD
       */
      const validUsername =
        "founder";

      if (
        String(username)
          .trim()
          .toLowerCase() !==
        validUsername
      ) {
        return res.status(401).json({
          error:
            "Invalid credentials.",
        });
      }

      if (
        !DASHBOARD_PASSWORD
      ) {
        return res.status(500).json({
          error:
            "DASHBOARD_PASSWORD is not configured in Railway.",
        });
      }

      if (
        String(password) !==
        String(
          DASHBOARD_PASSWORD
        )
      ) {
        return res.status(401).json({
          error:
            "Invalid credentials.",
        });
      }

      /*
       * Make sure KR data is readable
       * before allowing access.
       */
      const data =
        await getData(true);

      req.session.user = {
        username: "founder",
        program: "All",
      };

      return res.json({
        ok: true,

        user:
          req.session.user,

        fetchedAt:
          data.fetchedAt,
      });
    } catch (error) {
      console.error(
        "Login error:",
        error
      );

      return res.status(500).json({
        error:
          "Login failed. Check the Google Sheet connection.",
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| LOGOUT
|--------------------------------------------------------------------------
*/

app.post(
  "/api/logout",
  (req, res) => {
    req.session.destroy(() => {
      res.json({
        ok: true,
      });
    });
  }
);

/*
|--------------------------------------------------------------------------
| CURRENT USER
|--------------------------------------------------------------------------
*/

app.get(
  "/api/me",
  (req, res) => {
    res.json({
      user:
        req.session.user ||
        null,
    });
  }
);

/*
|--------------------------------------------------------------------------
| KR METRICS
|--------------------------------------------------------------------------
*/

app.get(
  "/api/metrics",
  requireAuth,
  async (req, res) => {
    try {
      const data =
        await getData(false);

      return res.json({
        rows:
          data.metrics,

        fetchedAt:
          data.fetchedAt,

        refreshEveryMs:
          REFRESH_MS,

        user:
          req.session.user,
      });
    } catch (error) {
      console.error(
        "Metrics error:",
        error
      );

      return res.status(500).json({
        error:
          "Could not fetch Google Sheet data.",

        details:
          error.message,
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| MANUAL REFRESH
|--------------------------------------------------------------------------
*/

app.post(
  "/api/refresh",
  requireAuth,
  async (req, res) => {
    try {
      const data =
        await getData(true);

      return res.json({
        ok: true,

        count:
          data.metrics.length,

        fetchedAt:
          data.fetchedAt,
      });
    } catch (error) {
      return res.status(500).json({
        error:
          error.message,
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| HEALTH CHECK
|--------------------------------------------------------------------------
*/

app.get(
  "/health",
  (req, res) => {
    res.json({
      status: "ok",

      service:
        "KR Pulse",

      timestamp:
        new Date().toISOString(),
    });
  }
);

/*
|--------------------------------------------------------------------------
| START SERVER
|--------------------------------------------------------------------------
*/

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `KR Pulse running on port ${PORT}`
    );

    console.log(
      `KR CSV configured: ${Boolean(KR_CSV_URL)}`
    );

    console.log(
      `Access CSV configured: ${Boolean(ACCESS_CSV_URL)}`
    );

    console.log(
      `Dashboard password configured: ${Boolean(DASHBOARD_PASSWORD)}`
    );
  }
);
