# Tasks: Takoyaki Stall Inventory, Sales, & Needs

**Input**: Design documents from `/specs/001-inventory-sales-orders/`

**Prerequisites**: `plan.md` (required), `spec.md` (required), plus `research.md`, `data-model.md`, `contracts/`

**Organization**: Tasks are grouped by user story so each story can be implemented and validated independently.

## Phase 1: Setup (Shared Infrastructure)

- [X] T001 Initialize Vite + React project in repo root (`package.json`, `vite.config.*`, `index.html`)
- [X] T002 Install UI/runtime deps (`package.json`): `react-router-dom`, `lucide-react`
- [X] T003 Setup Tailwind CSS + PostCSS (`tailwind.config.*`, `postcss.config.*`, `src/styles/globals.css`)
- [X] T004 [P] Create source folder structure per plan (`src/app/`, `src/components/`, `src/pages/`, `src/lib/`, `src/styles/`)
- [X] T005 [P] Add env templates for Sheets API (`.env.example`) and reference `VITE_GOOGLE_SHEETS_API_URL`, `VITE_GOOGLE_SHEETS_API_TOKEN`

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: No user story work should start until this phase is complete.

- [X] T006 Implement Google Sheets API client wrapper (`src/lib/googleSheetsApi.js`) with `get(action, params)`, `post(action, payload)`, token support, and normalized errors
- [X] T007 [P] Add loading + error UI primitives (`src/components/LoadingSpinner.jsx`, `src/components/ErrorBanner.jsx`)
- [X] T008 [P] Add safe numeric parsing helpers (`src/lib/money.js`) for currency fields (blank→0, NaN guards)
- [X] T009 [P] Add safe numeric parsing helpers (`src/lib/numbers.js`) for quantity fields (blank→0, integer/decimal handling)
- [X] T010 [P] Add date helpers for “today” and ISO formatting (`src/lib/dates.js`)
- [X] T011 Build app routing + navigation shell (`src/app/routes.jsx`, `src/app/App.jsx`, `src/components/Layout.jsx`)
- [X] T012 Wire global Tailwind styles into app entry (`src/main.jsx`, `src/styles/globals.css`)

**Checkpoint**: Foundation ready (routing works, shared UI exists, API wrapper in place).

---

## Phase 3: User Story 1 - Track Inventory & Low-Stock Alerts (Priority: P1) 🎯 MVP

**Goal**: Show the Inventory table, compute Closing_Qty live, highlight low stock, and submit daily inventory updates to Google Sheets.

**Independent Test**: Load inventory rows, change QTY/IN/OUT and confirm Closing_Qty updates instantly; set values below threshold and confirm row highlight + badge; click Submit and refresh to verify persisted values.

- [X] T013 [US1] Implement inventory page layout + table skeleton (`src/pages/InventoryPage.jsx`)
- [X] T014 [US1] Fetch inventory data via API action `inventory.get` and map rows to UI state (`src/pages/InventoryPage.jsx`)
- [X] T015 [US1] Implement live Closing_Qty calculation and row low-stock highlighting/badge (`src/pages/InventoryPage.jsx`)
- [X] T016 [US1] Add client-side validation for quantity inputs (no NaN; prevent negative where required) (`src/pages/InventoryPage.jsx`, `src/lib/numbers.js`)
- [X] T017 [US1] Implement “Submit Daily Inventory” to POST `inventory.submit` with computed `Closing_Qty` (`src/pages/InventoryPage.jsx`, `src/lib/googleSheetsApi.js`)
- [X] T018 [US1] Implement manual “Rollover Day” action (set `Current_Qty=Closing_Qty`, reset `In_Stock/Out_Stock=0`, then submit) (`src/pages/InventoryPage.jsx`)
- [X] T019 [US1] Ensure loading/saving UI states and clear error messages for API failures (`src/pages/InventoryPage.jsx`, `src/components/LoadingSpinner.jsx`, `src/components/ErrorBanner.jsx`)

**Checkpoint**: Inventory page is fully functional and can be demoed independently.

---

## Phase 4: User Story 2 - Record Daily Sales & Expenses (Priority: P1)

**Goal**: Provide a ledger-style entry screen with real-time calculations and save rows to `Sales_Finance`.

**Independent Test**: Enter sales and expense breakdown fields and verify totals update instantly; click Save and confirm a new row is appended to the sheet; refresh and confirm the saved entry appears (if a list/history view exists).

- [X] T020 [US2] Implement sales ledger page layout (card-style) with input groups (`src/pages/SalesPage.jsx`)
- [X] T021 [US2] Implement real-time calculations for expenses, totals, and remaining balance (`src/pages/SalesPage.jsx`, `src/lib/money.js`)
- [X] T022 [US2] Add client-side validation for currency inputs (blank→0; block NaN; allow 0) (`src/pages/SalesPage.jsx`, `src/lib/money.js`)
- [X] T023 [US2] Implement “Save Daily Ledger” to POST `salesFinance.append` and show success/failure states (`src/pages/SalesPage.jsx`, `src/lib/googleSheetsApi.js`)
- [X] T024 [US2] (Optional UI) Add simple “Recent entries” view by GET `salesFinance.list` filtered to today/date range (`src/pages/SalesPage.jsx`)
- [X] T025 [US2] Ensure loading/saving UI states and clear error messages for API failures (`src/pages/SalesPage.jsx`, `src/components/LoadingSpinner.jsx`, `src/components/ErrorBanner.jsx`)

**Checkpoint**: Sales ledger page can be used independently for daily close-out.

---

## Phase 5: User Story 3 - Generate “Needs!” Replenishment List (Priority: P2)

**Goal**: Show a needs-only list derived from inventory thresholds plus manual needs; allow copy/export as WhatsApp-ready text.

**Independent Test**: Create at/below-threshold inventory items and confirm they show; add a manual need and confirm it persists; copy/export and confirm output includes both auto and manual needs.

- [X] T026 [US3] Implement needs list page layout (shopping list style) (`src/pages/NeedsPage.jsx`)
- [X] T027 [US3] Load needs items by deriving from Inventory fetch (Closing_Qty <= Threshold_Limit) and merge with manual needs list (`src/pages/NeedsPage.jsx`, `src/lib/googleSheetsApi.js`)
- [X] T028 [US3] Implement manual needs add/remove UI and persistence via API actions (`needs.manual.upsert`, `needs.manual.remove`) (`src/pages/NeedsPage.jsx`, `src/lib/googleSheetsApi.js`)
- [X] T029 [US3] Implement “Copy/Export” share-ready text generation (`src/pages/NeedsPage.jsx`)
- [X] T030 [US3] Ensure loading/saving UI states and clear error messages for API failures (`src/pages/NeedsPage.jsx`, `src/components/LoadingSpinner.jsx`, `src/components/ErrorBanner.jsx`)

**Checkpoint**: Needs page supports both auto + manual needs and export.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T031 [P] Add responsive layout refinements for phone/tablet (spacing, sticky totals, scroll handling) (`src/components/Layout.jsx`, `src/pages/*.jsx`)
- [X] T032 [P] Add consistent input components (labels, helper text, error display) (`src/components/inputs/`, `src/pages/*.jsx`)
- [X] T033 Add “no silent data loss” UX: confirm destructive actions; disable submit while saving (`src/pages/InventoryPage.jsx`, `src/pages/NeedsPage.jsx`, `src/pages/SalesPage.jsx`)
- [X] T034 Update quickstart with final env keys and endpoint actions used (`specs/001-inventory-sales-orders/quickstart.md`)

---

## Dependencies & Execution Order

- Phase 1 → Phase 2 are required for everything.
- After Phase 2, US1 and US2 can be built in parallel; US3 depends on Inventory-derived needs (US1) plus manual needs API actions.

## Parallel Opportunities

- Phase 1: T004–T005 can run in parallel.
- Phase 2: T007–T010 can run in parallel.
- After Phase 2: US1 (T013–T019) and US2 (T020–T025) can run in parallel.
