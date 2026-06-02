# Implementation Plan: Takoyaki Stall Inventory, Sales, Needs, & Admin

**Branch**: `main` | **Date**: 2026-05-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-inventory-sales-orders/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

Build a mobile-friendly 3-page web app for a small takoyaki stall to:
- Track daily inventory per product (QTY/IN/OUT with computed Closing_Qty) and flag low stock vs Threshold_Limit.
- Record daily sales + expenses with real-time calculations and partner payouts.
- Show a “Needs!” replenishment list (items at/below threshold) plus manual needs with export support.

Add an Admin area for sales reporting and threshold updates.

Data is stored in a shared Google Sheet with 3 primary tabs (Inventory, Sales_Finance, Needs_Replenish) and accessed via a lightweight REST-style endpoint (Google Apps Script Web App).

**Artifacts**
- Research: [research.md](./research.md)
- Data model: [data-model.md](./data-model.md)
- API contract: [contracts/apps-script-api.md](./contracts/apps-script-api.md)
- Setup guide: [quickstart.md](./quickstart.md)

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: JavaScript (ES2022+)

**Primary Dependencies**: React, Tailwind CSS, Lucide React, React Router

**Storage**: Google Sheets (via Google Apps Script Web App REST endpoint)

**Testing**: Component tests (React Testing Library) and lightweight API contract tests for the Apps Script endpoint

**Target Platform**: Modern mobile browsers (Android Chrome/iOS Safari) + desktop Chrome

**Project Type**: Single-page web application + external spreadsheet-backed API

**Performance Goals**: First usable view within ~2 seconds on shop Wi‑Fi/4G; typing calculations update instantly

**Constraints**: Must be usable on phone/tablet; show clear loading/saving states; handle temporary API failures gracefully

**Scale/Scope**: Small team (1–3 users); tens of inventory items; daily ledger entries; low concurrency

## Feature Breakdown

### Page 1: Daily Inventory Dashboard

- Table view of all `Inventory` products with inputs for `Current_Qty` (Starting), `In_Stock`, `Out_Stock`.
- `Closing_Qty` is calculated live: `Closing_Qty = Current_Qty + In_Stock - Out_Stock`.
- Row highlight + “Needs Replenish” badge when `Closing_Qty <= Threshold_Limit`.
- “Submit Daily Inventory” writes the current row values to the `Inventory` tab (and optionally syncs `Needs_Replenish`).
- Date picker to load/save/delete inventory snapshots per day (via `Inventory_History`).

### Page 2: Sales & Financial Ledger

- Card-style layout for rapid entry on mobile.
- Inputs: `Takoyaki_Sales`, expense breakdown (`Allow`, `Ipon`, `Bill`, `Ilaw`), `Previous_Cash_Added`, payouts (`Mykah`, `Natalie`).
- Calculations update live:
  - `Expenses_Total = Allow + Ipon + Bill + Ilaw`
  - `Total_Cash_Calculated = Takoyaki_Sales - Expenses_Total`
  - `Final_Total_Cash = Total_Cash_Calculated + Previous_Cash_Added`
  - `Remaining_Balance = Final_Total_Cash - Payout_Mykah - Payout_Natalie`
- “Save Daily Ledger” appends a row to `Sales_Finance` with an ISO timestamp.
- Date picker to load/save/delete a single ledger per day (CRUD by date).

### Page 3: Smart Replenishment (“Needs!”) List

- Derived list view of items with `Closing_Qty <= Threshold_Limit`, plus user-added manual needs.
- Shopping-list style layout with quantity and unit.
- Actions:
  - Export text (copy/share-ready message for WhatsApp/SMS)
  - Add manual need (simple input)
  - Remove/resolve manual need
- Date picker so manual needs are tracked per day.

### Admin: Dashboard & Thresholds

- Sales report chart over a selected date range (uses `Sales_Finance`).
- Update product thresholds (writes to `Inventory.Threshold_Limit`).

## UI/UX Notes

- Mobile-first layout (phone/tablet at the stall).
- Clear loading and saving states (spinner + disabled buttons while saving).
- Inline validation and friendly error messages (don’t allow NaN; default blanks to 0).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

The current `.specify/memory/constitution.md` is a template and does not define enforceable gates. Default gates for this feature:
- No secrets committed (URL/token via environment variables).
- User-visible errors for API failures; no silent data loss.
- Basic automated tests for calculations and API contract.

## Project Structure

### Documentation (this feature)

```text
specs/001-inventory-sales-orders/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)
<!--
  ACTION REQUIRED: Replace the placeholder tree below with the concrete layout
  for this feature. Delete unused options and expand the chosen structure with
  real paths (e.g., apps/admin, packages/something). The delivered plan must
  not include Option labels.
-->

```text
# Single-project React app (root)
src/
├── app/                      # Routing + layout shell
│   ├── App.jsx
│   └── routes.jsx
├── components/
│   ├── Layout.jsx            # Sidebar/top nav
│   ├── LoadingSpinner.jsx
│   ├── ErrorBanner.jsx
│   ├── StatCard.jsx
│   └── inputs/               # Reusable input groups
├── pages/
│   ├── InventoryPage.jsx
│   ├── SalesPage.jsx
│   └── NeedsPage.jsx
├── lib/
│   ├── googleSheetsApi.js    # GET/POST wrapper to Apps Script URL
│   ├── money.js              # safe number parsing/formatting
│   └── dates.js              # date helpers (shop timezone behavior)
└── styles/
    └── globals.css

tests/
├── unit/                     # pure calculation tests
└── contract/                 # API request/response shape tests (mocked fetch)
```

**Structure Decision**: Single-project React app at repo root (no separate backend folder); the “backend” is the external Apps Script Web App endpoint documented under `specs/001-inventory-sales-orders/contracts/`.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |
