# Contract: Google Apps Script Web App API

**Purpose**: Define the request/response contract between the React app and the Google Apps Script Web App that reads/writes the Google Sheet tabs.

## Base URL

- `BASE_URL`: Google Apps Script Web App deployment URL (single endpoint).
- Shared secret: `token` (required for all actions)

## Response Envelope (all actions)

### Success
```json
{
  "ok": true,
  "data": {}
}
```

### Error
```json
{
  "ok": false,
  "error": {
    "code": "BAD_REQUEST",
    "message": "Human-readable message"
  }
}
```

## Read Actions (GET)

### `inventory.get`

**Request**
- Method: `GET`
- Query:
  - `action=inventory.get`
  - `token` (required)
  - `date` (required, `YYYY-MM-DD`)

**Response `data`**
```json
{
  "closed": false,
  "items": [
    {
      "Product": "Flour",
      "Current_Qty": 0,
      "In_Stock": 0,
      "Out_Stock": 0,
      "Closing_Qty": 0,
      "Unit": "kg",
      "Threshold_Limit": 0,
      "Is_Closed": ""
    }
  ]
}
```

### `inventory.getOrSeed`

Returns existing inventory for the requested date, or a seeded template (QTY inherited from the most recent non-closed day with saved inventory).

**Request**
- Method: `GET`
- Query:
  - `action=inventory.getOrSeed`
  - `token` (required)
  - `date` (required, `YYYY-MM-DD`)

**Response `data`**
```json
{
  "closed": false,
  "seeded": true,
  "seededFrom": "2026-05-20",
  "items": []
}
```

### `inventory.seedTemplate`

Returns a seeded template for the requested date (does not save).

**Request**
- Method: `GET`
- Query:
  - `action=inventory.seedTemplate`
  - `token` (required)
  - `date` (required, `YYYY-MM-DD`)

**Response `data`**
```json
{
  "seededFrom": "2026-05-20",
  "items": []
}
```

### `salesFinance.list`

**Request**
- Method: `GET`
- Query:
  - `action=salesFinance.list`
  - `token` (required)
  - `from` (optional, ISO date `YYYY-MM-DD`)
  - `to` (optional, ISO date `YYYY-MM-DD`)

**Response `data`**
```json
{
  "rows": [
    {
      "Date": "2026-05-21T09:15:00+08:00",
      "Takoyaki_Sales": 0,
      "Expenses_Total": 0,
      "Breakdown_Allow": 0,
      "Breakdown_Ipon": 0,
      "Breakdown_Bill": 0,
      "Breakdown_Ilaw": 0,
      "Total_Cash_Calculated": 0,
      "Previous_Cash_Added": 0,
      "Final_Total_Cash": 0,
      "Payout_Mykah": 0,
      "Payout_Natalie": 0,
      "Remaining_Balance": 0
    }
  ]
}
```

### `needs.list`

**Request**
- Method: `GET`
- Query:
  - `action=needs.list`
  - `token` (required)
  - `date` (required, `YYYY-MM-DD`)
  - `source=derived` (optional; default `derived`, returns manual needs only)

**Response `data`**
```json
{
  "items": [
    {
      "Product": "Mayo",
      "Current_Closing_Qty": 1,
      "Threshold_Limit": 2,
      "Status": "NEEDS_AUTO"
    }
  ]
}
```

## Write Actions (POST, JSON)

All POST requests use `Content-Type: application/json`.

### `inventory.submit`

Used by “Submit Daily Inventory”.

**Request**
```json
{
  "action": "inventory.submit",
  "token": "optional-secret",
  "payload": {
    "date": "2026-05-21",
    "items": [
      {
        "Product": "Flour",
        "Current_Qty": 10,
        "In_Stock": 2,
        "Out_Stock": 5,
        "Closing_Qty": 7,
        "Unit": "kg",
        "Threshold_Limit": 3,
        "Is_Closed": ""
      }
    ]
  }
}
```

**Response `data`**
```json
{
  "updated": 1
}
```

### `inventory.setClosed`

Marks a date as closed/open for inventory purposes. When setting `closed=true`, the server resets IN/OUT to `0` and locks the day to the previous open day’s QTY baseline.

**Request**
```json
{
  "action": "inventory.setClosed",
  "token": "optional-secret",
  "payload": {
    "date": "2026-05-21",
    "closed": true
  }
}
```

**Response `data`**
```json
{
  "date": "2026-05-21",
  "closed": true,
  "updated": 18,
  "seededFrom": "2026-05-20"
}
```

### `salesFinance.append`

Deprecated for per-day CRUD. Use `salesFinance.upsertByDate`.

**Request**
```json
{
  "action": "salesFinance.append",
  "token": "optional-secret",
  "payload": {
    "row": {
      "Takoyaki_Sales": 0,
      "Breakdown_Allow": 0,
      "Breakdown_Ipon": 0,
      "Breakdown_Bill": 0,
      "Breakdown_Ilaw": 0,
      "Previous_Cash_Added": 0,
      "Payout_Mykah": 0,
      "Payout_Natalie": 0
    }
  }
}
```

**Response `data`**
```json
{
  "Date": "2026-05-21T09:15:00+08:00"
}
```

### `needs.sync` (optional)

If the business wants the `Needs_Replenish` tab actively maintained.

**Request**
```json
{
  "action": "needs.sync",
  "token": "optional-secret",
  "payload": {
    "items": [
      { "Product": "Mayo", "Current_Closing_Qty": 1, "Status": "NEEDS_AUTO" }
    ]
  }
}
```

**Response `data`**
```json
{
  "updated": 1
}
```

### `needs.manual.upsert` (optional)

Adds or updates a user-created manual need item (not tied to inventory thresholds).

**Request**
```json
{
  "action": "needs.manual.upsert",
  "token": "optional-secret",
  "payload": {
    "date": "2026-05-21",
    "item": { "Product": "Ice", "Current_Closing_Qty": 0, "Status": "NEEDS_MANUAL" }
  }
}
```

**Response `data`**
```json
{
  "ok": true
}
```

### `needs.manual.remove` (optional)

Removes a user-created manual need item.

**Request**
```json
{
  "action": "needs.manual.remove",
  "token": "optional-secret",
  "payload": { "Product": "Ice" }
}
```

## Per-day CRUD Actions

### `inventory.deleteDay`

Deletes `Inventory_History` rows for the date (does not remove products from `Inventory`).

```json
{
  "action": "inventory.deleteDay",
  "token": "optional-secret",
  "payload": { "date": "2026-05-21" }
}
```

### `salesFinance.getByDate`

GET `?action=salesFinance.getByDate&token=...&date=YYYY-MM-DD`

### `salesFinance.upsertByDate`

Upserts a single ledger entry for the given date (backend computes totals).

```json
{
  "action": "salesFinance.upsertByDate",
  "token": "optional-secret",
  "payload": {
    "date": "2026-05-21",
    "row": {
      "Takoyaki_Sales": 0,
      "Breakdown_Allow": 0,
      "Breakdown_Ipon": 0,
      "Breakdown_Bill": 0,
      "Breakdown_Ilaw": 0,
      "Previous_Cash_Added": 0,
      "Payout_Mykah": 0,
      "Payout_Natalie": 0
    }
  }
}
```

### `salesFinance.deleteByDate`

```json
{
  "action": "salesFinance.deleteByDate",
  "token": "optional-secret",
  "payload": { "date": "2026-05-21" }
}
```

## Admin / Configuration Actions

### `thresholds.get`

GET `?action=thresholds.get&token=...`

### `thresholds.update`

```json
{
  "action": "thresholds.update",
  "token": "optional-secret",
  "payload": { "product": "Mayo", "threshold": 2 }
}
```

## CORS / Browser Requirements (Apps Script)

The Web App must return headers allowing browser access:
- `Access-Control-Allow-Origin` (recommended: specific domain(s), or `*` for simple deployment)
- `Access-Control-Allow-Methods: GET,POST,OPTIONS`
- `Access-Control-Allow-Headers: Content-Type`
