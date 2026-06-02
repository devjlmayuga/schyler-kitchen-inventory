# simple-inventory

Next.js (App Router) SSR app with an API route that reads/writes a Google Sheet directly via Google Sheets API.

## Local dev

1) Create `.env` from `.env.example`
2) Run `npm install`
3) Run `npm run dev`

## Google Sheets setup (service account)

- Create a Google Cloud Service Account + JSON key
- Share your target Google Sheet with the service account email as **Editor**
- Set:
  - `SI_SPREADSHEET_ID`
  - `SI_GOOGLE_SERVICE_ACCOUNT_JSON` (paste JSON) or `SI_GOOGLE_SERVICE_ACCOUNT_JSON_BASE64`

## Creating a login user

- Add a row to the `Users` tab (`Username`, `Password_Hash`, `Salt`, `Role`, `Active`).
- Helper: `node scripts/make-user-row.mjs admin your-password admin Y`

## API contract

Frontend calls `NEXT_PUBLIC_GOOGLE_SHEETS_API_URL` (default `/api/si`) using `action=...` and expects `{ ok, data }` envelopes.

## Deploy (Vercel)

- Framework preset: Next.js
- Set environment variables from `.env.example` in Vercel Project Settings → Environment Variables
- Share the target Google Sheet with your service account `client_email` as Editor
