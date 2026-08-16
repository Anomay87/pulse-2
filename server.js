const express = require("express");
const session = require("express-session");
const fs = require("fs");
const path = require("path");
const { parse } = require("csv-parse/sync");

const app = express();
const PORT = process.env.PORT || 3000;

const KR_CSV_URL = process.env.KR_CSV_URL;
const ACCESS_CSV_URL = process.env.ACCESS_CSV_URL;
const SESSION_SECRET = process.env.SESSION_SECRET || "change-me-before-production";

if (!KR_CSV_URL || !ACCESS_CSV_URL) {
  console.warn("Missing KR_CSV_URL or ACCESS_CSV_URL environment variable.");
}

app.use(express.json({ limit: "100kb" }));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: false, maxAge: 8 * 60 * 60 * 1000 }
}));

app.use(express.static(path.join(__dirname, "public")));

let cache = {
  metrics: null,
  access: null,
  fetchedAt: 0
};

const REFRESH_MS = 5 * 60 * 1000;

function cleanKey(v) {
  return String(v ?? "")
    .trim()
    .toLowerCase()
    .replace(/[%()₹$]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normText(v) {
  return String(v ?? "").trim();
}

function num(v) {
  if (v === null || v === undefined) return null;
  let s = String(v).trim();
  if (!s || /^n\/?a$/i.test(s) || /^na$/i.test(s) || /^-+$/.test(s)) return null;
  s = s.replace(/,/g, "").replace(/₹/g, "").trim();
  // ranges: use midpoint for calculation, keep raw label in display
  const range = s.match(/(-?\d+(?:\.\d+)?)\s*(?:-|to|–|—)\s*(-?\d+(?:\.\d+)?)/i);
  if (range) return (Number(range[1]) + Number(range[2])) / 2;
  const m = s.match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

function isPercentLike(header, raw) {
  return /%|percent|percentage|i2h|pay/i.test(header) || /%/.test(String(raw ?? ""));
}

function headersFromRows(rows) {
  if (!rows.length) return [];
  return Object.keys(rows[0]);
}

function findColumn(headers, patterns) {
  const keyed = headers.map(h => ({ raw: h, key: cleanKey(h) }));
  for (const p of patterns) {
    const re = new RegExp(p, "i");
    const found = keyed.find(x => re.test(x.key));
    if (found) return found.raw;
  }
  return null;
}

function inferLongRows(rows) {
  const headers = headersFromRows(rows);
  const programCol = findColumn(headers, ["program", "course", "vertical", "business_unit", "stream"]);
  const stakeholderCol = findColumn(headers, ["stakeholder", "owner", "instructor", "person", "module_owner"]);
  const metricCol = findColumn(headers, ["metric", "kr", "kpi", "key_result", "measure", "goal"]);
  const targetCol = findColumn(headers, ["target", "goal", "target_value"]);
  const actualCol = findColumn(headers, ["actual", "current", "achieved", "value"]);
  const monthCol = findColumn(headers, ["month", "period", "date", "timeline"]);

  if (!metricCol || !targetCol || !actualCol) return null;

  return rows.map((r, i) => ({
    id: i,
    program: normText(programCol ? r[programCol] : "All"),
    stakeholder: normText(stakeholderCol ? r[stakeholderCol] : "Team"),
    metric: normText(r[metricCol]),
    target: num(r[targetCol]),
    actual: num(r[actualCol]),
    targetRaw: normText(r[targetCol]),
    actualRaw: normText(r[actualCol]),
    month: normText(monthCol ? r[monthCol] : ""),
    unit: isPercentLike(metricCol, r[metricCol]) || isPercentLike(targetCol, r[targetCol]) ? "%" : ""
  })).filter(x => x.metric);
}

function inferWideRows(rows) {
  if (!rows.length) return [];
  const headers = headersFromRows(rows);
  const programCol = findColumn(headers, ["program", "course", "vertical", "business_unit", "stream"]);
  const stakeholderCol = findColumn(headers, ["stakeholder", "owner", "instructor", "person", "module_owner"]);
  const monthCol = findColumn(headers, ["month", "period", "date", "timeline"]);

  const metricPairs = [];
  for (const h of headers) {
    const k = cleanKey(h);
    if (/target|goal/.test(k)) {
      const base = k.replace(/_?target|_?goal/g, "");
      const actual = headers.find(h2 => {
        const k2 = cleanKey(h2);
        return k2 === `${base}_actual` || k2 === `${base}_current` || k2 === base;
      });
      if (actual) {
        metricPairs.push({ metric: base.replace(/_/g, " ").trim(), targetCol: h, actualCol: actual });
      }
    }
  }
  if (!metricPairs.length) return [];

  const out = [];
  rows.forEach((r, i) => {
    for (const p of metricPairs) {
      const metric = p.metric.replace(/\b\w/g, c => c.toUpperCase());
      if (r[p.targetCol] === undefined && r[p.actualCol] === undefined) continue;
      out.push({
        id: `${i}-${metric}`,
        program: normText(programCol ? r[programCol] : "All"),
        stakeholder: normText(stakeholderCol ? r[stakeholderCol] : "Team"),
        metric,
        target: num(r[p.targetCol]),
        actual: num(r[p.actualCol]),
        targetRaw: normText(r[p.targetCol]),
        actualRaw: normText(r[p.actualCol]),
        month: normText(monthCol ? r[monthCol] : ""),
        unit: isPercentLike(metric, metric) || isPercentLike(p.targetCol, r[p.targetCol]) ? "%" : ""
      });
    }
  });
  return out;
}

function normalizeMetrics(csv) {
  const rows = parse(csv, { columns: true, skip_empty_lines: true, relax_column_count: true, bom: true, trim: true });
  return inferLongRows(rows) || inferWideRows(rows);
}

function normalizeAccess(csv) {
  const rows = parse(csv, { columns: true, skip_empty_lines: true, relax_column_count: true, bom: true, trim: true });
  if (!rows.length) return [];
  const headers = headersFromRows(rows);
  const userCol = findColumn(headers, ["username", "user", "login", "email", "employee_email"]);
  const passCol = findColumn(headers, ["password", "pass", "pwd"]);
  const programCol = findColumn(headers, ["program", "course", "vertical", "access"]);
  if (!userCol || !passCol) {
    return rows.map(r => ({ username: normText(r[headers[0]]), password: normText(r[headers[1]]), program: programCol ? normText(r[programCol]) : "All" }));
  }
  return rows.map(r => ({
    username: normText(r[userCol]),
    password: normText(r[passCol]),
    program: programCol ? normText(r[programCol]) : "All"
  })).filter(x => x.username && x.password);
}

async function fetchText(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  return await res.text();
}

async function getData(force = false) {
  if (!force && cache.metrics && Date.now() - cache.fetchedAt < REFRESH_MS) return cache;
  const [krCsv, accessCsv] = await Promise.all([fetchText(KR_CSV_URL), fetchText(ACCESS_CSV_URL)]);
  const metrics = normalizeMetrics(krCsv);
  const access = normalizeAccess(accessCsv);
  cache = { metrics, access, fetchedAt: Date.now() };
  return cache;
}

function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Unauthorized" });
  next();
}

app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: "Username and password are required." });
    const data = await getData(true);
    const row = data.access.find(x => x.username.toLowerCase() === String(username).trim().toLowerCase() && x.password === String(password));
    if (!row) return res.status(401).json({ error: "Invalid credentials." });
    req.session.user = { username: row.username, program: row.program || "All" };
    res.json({ ok: true, user: req.session.user, fetchedAt: data.fetchedAt });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not load access list. Check the Railway environment variables and CSV URL." });
  }
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/me", (req, res) => {
  res.json({ user: req.session.user || null });
});

app.get("/api/metrics", requireAuth, async (req, res) => {
  try {
    const data = await getData(false);
    res.json({
      rows: data.metrics,
      fetchedAt: data.fetchedAt,
      refreshEveryMs: REFRESH_MS,
      user: req.session.user
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not fetch Google Sheet data.", details: e.message });
  }
});

app.post("/api/refresh", requireAuth, async (req, res) => {
  try {
    const data = await getData(true);
    res.json({ ok: true, count: data.metrics.length, fetchedAt: data.fetchedAt });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`KR Pulse running on port ${PORT}`);
});