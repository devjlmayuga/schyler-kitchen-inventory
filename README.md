# Schyler Kitchen Inventory

This project is a mobile-friendly inventory and sales management app for a kitchen or stall operation. It runs as a Next.js app and stores operational data in Google Sheets, so the system behaves like a lightweight internal ERP without needing a separate database service.

## What the system can do

### Inventory tracking
- Manage daily inventory entries per product with fields such as `Current_Qty`, `In_Stock`, `Out_Stock`, `Closing_Qty`, and `Threshold_Limit`.
- Calculate closing quantity automatically as:
  - `Closing_Qty = Current_Qty + In_Stock - Out_Stock`
- Flag products that are at or below threshold as needing replenishment.
- Load or seed a day’s inventory, close a day to lock changes, and reopen it when needed.
- Delete a day’s saved inventory if needed.

### Sales and finance tracking
- Record takoyaki or product sales with a sales ledger.
- Track expense categories and staff payout amounts.
- Auto-calculate totals based on product sales, expenses, previous cash, and cash remaining.
- Save by date and reload a previous day’s ledger.
- Use product categories and per-item quantities to generate a breakdown summary.

### Needs / replenishment list
- Derive an automatic needs list from inventory items at or below threshold.
- Add manual needs entries that remain until removed.
- Copy/export the replenishment list as plain text for WhatsApp or SMS style sharing.

### Admin and auth
- Login with username/password stored in a `Users` sheet.
- Support roles such as `admin` and `staff`.
- Admin-only actions include user creation and management tools.
- The app uses JWT-based sessions and optional API token auth for server-side actions.

## Main screens

- `/login` — sign in
- `/inventory` — daily stock entry and risk tracking
- `/sales` — sales + expense ledger
- `/needs` — needs list and replenishment export
- `/admin` — admin dashboard/reporting and threshold management

## Tech stack

- Next.js 15 with App Router
- React 18
- Tailwind CSS
- Google Sheets API via `googleapis`
- JWT session auth with environment-based secrets
- Server route at `/api/si` that dispatches action-based requests

## How it works under the hood

The app is organized around a thin API layer:

- Frontend pages call the client helper in `src/lib/googleSheetsApi.js`
- Requests go to `/api/si`
- The route in `src/app/api/si/route.js` parses the request and calls `dispatchAction` from `src/server/si/_router.js`
- The router calls service functions in `src/server/si/_services.js`
- Those functions read/write data in Google Sheets using helper functions in `src/server/si/_sheets.js`

This means the spreadsheet is effectively the database for the project, while Next.js handles the UI and API layer.

## Required environment variables

Create a local `.env.local` file in the project root and set the values below.

```bash
# Required for the app to talk to Google Sheets
SI_SPREADSHEET_ID="your_google_sheet_id"
SI_GOOGLE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'
# or
SI_GOOGLE_SERVICE_ACCOUNT_JSON_BASE64="base64_encoded_service_account_json"

# Required for auth/session security
SI_JWT_SECRET="a-long-random-secret"
SI_AUTH_PEPPER="another-long-random-secret"
SI_API_TOKEN="a-shared-api-token-for-server-calls"

# Optional if you want to override the default API URL in the browser
NEXT_PUBLIC_GOOGLE_SHEETS_API_URL="http://localhost:3000/api/si"
```

### Google Sheets setup

1. Create a Google Cloud project.
2. Enable the Google Sheets API.
3. Create a service account and download the JSON credentials.
4. Share your target spreadsheet with the service account email as `Editor`.
5. Put that JSON in `SI_GOOGLE_SERVICE_ACCOUNT_JSON` or base64-encode it and use `SI_GOOGLE_SERVICE_ACCOUNT_JSON_BASE64`.

## Local startup

1. Install dependencies:

```bash
npm install
```

2. Create `.env.local` using the variables above.

3. Start the app in development mode:

```bash
npm run dev
```

4. Open the app in your browser:

```text
http://localhost:3000
```

## Creating the first login user

The app expects a `Users` sheet with these columns:

- `Username`
- `Password_Hash`
- `Salt`
- `Role`
- `Active`

A helper script is included to generate a valid row payload:

```bash
node scripts/make-user-row.mjs admin your-password admin Y
```

This prints a JSON row you can paste into the `Users` sheet.

## Production / deployment

This project is designed to run on a platform like Vercel, Railway, or any Node host that supports Next.js.

### Deploy checklist
- Set all required environment variables in the hosting environment.
- Ensure the spreadsheet is shared with the service account email as `Editor`.
- Build the app:

```bash
npm run build
```

- Start the production server:

```bash
npm run start
```

## Project structure

```text
src/
  app/
    api/si/route.js
    (app)/
      inventory/page.jsx
      sales/page.jsx
      needs/page.jsx
      admin/page.jsx
  components/
  lib/
  screens/
  server/si/
      _router.js
      _services.js
      _sheets.js
scripts/
  make-user-row.mjs
apps-script/
```

## Notes

- The app is intentionally spreadsheet-first and lightweight, making it easy to manage small operational data without a full backend database.
- Auth is not based on a traditional database user table; it reads/writes the `Users` sheet in the same Google Sheet used for the inventory data.
- The code supports both service-account credentials and Google ADC fallback if the runtime has a valid Google application credential configuration.
