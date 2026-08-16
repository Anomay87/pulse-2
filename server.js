const express = require("express");

const app = express();

const PORT = process.env.PORT || 3000;
const KR_CSV_URL = process.env.KR_CSV_URL || "";

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "KR Pulse",
    time: new Date().toISOString(),
  });
});

app.get("/debug/csv", async (req, res) => {
  try {
    if (!KR_CSV_URL) {
      return res.status(500).send("KR_CSV_URL is missing.");
    }

    const response = await fetch(KR_CSV_URL);

    if (!response.ok) {
      return res
        .status(500)
        .send(`Google Sheets returned ${response.status}`);
    }

    const csv = await response.text();

    res.type("text/plain").send(csv);
  } catch (error) {
    console.error(error);
    res.status(500).send(error.message);
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Debug server running on port ${PORT}`);
});
