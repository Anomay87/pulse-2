# KR Pulse — Executive Dashboard

A premium internal KR dashboard designed for a founder/executive view.

## Architecture

Google Sheets (published CSV)
→ Railway Node/Express app
→ server-side fetch + 5-minute cache
→ authenticated dashboard

The dashboard never exposes the Google Sheet URLs in the browser.

## Railway environment variables

Add these variables to your Railway service:

- `KR_CSV_URL` = the published CSV URL for the KR Dashboard tab
- `ACCESS_CSV_URL` = the published CSV URL for the Access tab
- `SESSION_SECRET` = a long random string

Example:

KR_CSV_URL=https://docs.google.com/spreadsheets/d/e/.../pub?gid=...&single=true&output=csv
ACCESS_CSV_URL=https://docs.google.com/spreadsheets/d/e/.../pub?gid=0&single=true&output=csv
SESSION_SECRET=replace-with-a-random-long-secret

## Expected Access CSV

The app looks for columns similar to:

- Username / User / Email
- Password
- Program / Access (optional)

## Expected KR CSV

Preferred long-form columns:

- Program
- Stakeholder / Owner / Instructor
- Metric / KR / KPI
- Target
- Actual / Current
- Month (optional)

The server also attempts a simple wide-format inference for Target/Actual pairs.

## Deploy on Railway

1. Create a new Railway service from this folder/repository.
2. Ensure the service uses Node 20+.
3. Add the environment variables above.
4. Deploy.
5. In Railway, open Settings → Networking → Generate Domain.
6. Open the generated HTTPS URL.

## Notes

- Dashboard auto-refreshes every 5 minutes.
- Manual refresh button is included.
- Login uses the Access CSV.
- Program filter: All → individual programs.
- Program view is consolidated.
- Dashboard shows latest metric cards and monthly trend for the selected metric.