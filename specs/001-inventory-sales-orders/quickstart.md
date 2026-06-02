# Quickstart: Takoyaki Stall Inventory, Sales, & Orders

This quickstart describes the expected setup once implementation is in place.

## 1) Google Sheet setup

Create a Google Sheet with these tabs and columns (row 1 as headers):

### `Inventory`
`Product, Current_Qty, In_Stock, Out_Stock, Closing_Qty, Unit, Threshold_Limit`

### `Inventory_History` (required for per-day CRUD)
`Date, Product, Current_Qty, In_Stock, Out_Stock, Closing_Qty, Unit, Threshold_Limit, Is_Closed`

### `Sales_Finance`
`Date, Takoyaki_Sales, Expenses_Total, Breakdown_Allow, Breakdown_Ipon, Breakdown_Bill, Breakdown_Ilaw, Total_Cash_Calculated, Previous_Cash_Added, Final_Total_Cash, Payout_Mykah, Payout_Natalie, Remaining_Balance`

> Note: The backend will auto-add `Staff_Expenses_JSON` and `Staff_Expenses_Total` headers when saving staff payouts.

### `Needs_Replenish` (optional to keep synced)
`Date, Product, Current_Closing_Qty, Status`

### `Config` (auto-created by script, optional to pre-create)
`Key, Value`

### `Users` (required for Login)
`Username, Password_Hash, Salt, Role, Active`

## 2) Apps Script Web App setup

- Create an Apps Script project bound to the Sheet (or standalone with Sheet ID configured).
- You can start from the reference implementation in `apps-script/Code.gs` (or edit/copy from `apps-script/Code.js`).
- Implement `doGet(e)` and `doPost(e)` handlers to satisfy `specs/001-inventory-sales-orders/contracts/apps-script-api.md`, including:
  - `inventory.get` (by date), `inventory.submit` (by date), `inventory.deleteDay`
  - `salesFinance.getByDate`, `salesFinance.upsertByDate`, `salesFinance.deleteByDate`, `salesFinance.list`
  - `needs.list` (by date)
  - Optional manual needs: `needs.manual.upsert`, `needs.manual.remove`
- Deploy as a Web App and copy the deployment URL.
- Ensure responses include CORS headers for browser access.

## 3) Frontend environment variables

Create a `.env` file at repo root:

```bash
VITE_GOOGLE_SHEETS_API_URL="https://script.google.com/macros/s/....../exec"
# Optional:
# - If set: app uses API token (bypasses Login).
# - If not set: app requires Login and uses a session token.
VITE_GOOGLE_SHEETS_API_TOKEN=""
```

## 4) Run the app (expected)

```bash
npm install
npm run dev
```

Open the printed local URL and verify:
- Inventory loads and low-stock highlighting works.
- Ledger calculations update as you type and saving appends to `Sales_Finance`.
- Needs list shows items at/below threshold and can be printed/exported.

## 5) Create your first user

Recommended (admin setup using API token):
- Keep `VITE_GOOGLE_SHEETS_API_TOKEN` set temporarily.
- Call `auth.admin.upsertUser` with `{ username, password, role: "admin", active: "Y" }`.
- Then remove `VITE_GOOGLE_SHEETS_API_TOKEN` from `.env` to force Login.

Optional hardening:
- Add Script Property `AUTH_PEPPER` (random secret) to strengthen stored password hashes.
