# Research & Decisions: Takoyaki Stall Inventory, Sales, & Orders

**Date**: 2026-05-21

This project uses a Google Sheet as the database, exposed via a Google Apps Script Web App URL (REST-style). This document records key design decisions and the rationale.

## Decisions

### 1) API shape: single endpoint, action-based

**Decision**: Use one Apps Script Web App URL with:
- `GET` for reads using query parameters like `?action=inventory.get`
- `POST` for writes using JSON body like `{ "action": "inventory.submit", "payload": { ... } }`

**Rationale**: Apps Script Web Apps are easiest to deploy/operate as a single URL. An action-based contract is simple to extend without managing multiple routes.

**Alternatives considered**:
- Multiple endpoints (separate URLs) for inventory/sales/needs: harder deployment/maintenance for a small business.

### 2) Minimal auth: shared secret token (optional but recommended)

**Decision**: Support an optional shared secret `token` passed as:
- `GET`: `?token=...`
- `POST`: JSON body `{ "token": "...", ... }`

**Rationale**: “Anyone with the link” is fast but risky. A token provides lightweight protection without requiring Google account sign-in UX.

**Alternatives considered**:
- Full Google OAuth: too heavy for v1 and introduces more operational friction.

### 3) Inventory tab is the current day’s working sheet (no history in v1)

**Decision**: The `Inventory` tab holds the current working values for each product:
`Current_Qty`, `In_Stock`, `Out_Stock`, and computed `Closing_Qty`.

**Rationale**: Matches the provided sheet columns and the “Submit Daily Inventory” button behavior.

**Alternatives considered**:
- Add an `Inventory_History` tab for time-series: valuable, but not requested; can be added later without breaking the UI contract.

### 4) Sales_Finance rows append per save; date stores a timestamp

**Decision**: Each “Save Daily Ledger” appends a new row to `Sales_Finance`. The `Date` column stores an ISO timestamp (e.g., `2026-05-21T09:15:00+08:00`) so the sheet naturally includes “with a timestamp” without adding columns.

**Rationale**: The tab structure provided does not include a separate timestamp column.

**Alternatives considered**:
- Store `Date` as `YYYY-MM-DD` only: loses the “timestamp” requirement unless the sheet is changed.

### 5) Needs_Replenish can be derived (preferred) but also syncable

**Decision**: The app can derive the “Needs!” list from `Inventory` (Closing_Qty <= Threshold_Limit). If desired, the backend can also write a synced view into `Needs_Replenish`.

**Rationale**: Derivation avoids duplication and sync drift; syncing can help non-app users view the needs list directly in Sheets.

## Non-goals (v1)

- Multi-user permissions / roles.
- Offline-first editing with background sync.
- Full inventory history / analytics beyond the current values and ledger rows.

## Risks & Mitigations

- **Concurrent edits**: Two users can overwrite values. Mitigation: show “Last updated” timestamp per payload if implemented in Apps Script; otherwise keep flows simple (one device recommended during close-out).
- **Data validation**: Sheets accept anything. Mitigation: validate numbers client-side and server-side; reject NaN/negative where not allowed.
- **Latency/failures**: Apps Script can be slow. Mitigation: loading spinner, disable submit while saving, show retry messaging, and keep payloads small.
