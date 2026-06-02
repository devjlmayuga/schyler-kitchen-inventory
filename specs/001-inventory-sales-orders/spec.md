# Feature Specification: Takoyaki Stall Inventory, Sales, & Orders

**Feature Branch**: `001-inventory-sales-orders`

**Created**: 2026-05-21

**Status**: Draft

**Input**: User description: "Build a 3-page web app for a small takoyaki stall to track daily inventory, record sales and expenses, and show a dynamic low-stock replenishment list based on thresholds."

## Clarifications

### Session 2026-05-21

- Q: For the 3-page app, should Page 3 be Orders or the “Needs!” replenishment list? → A: Page 3 is Needs! (replenishment list)
- Q: Should the API require a shared secret token for read/write access? → A: Yes — shared secret token required
- Q: Should daily inventory rollover be manual or automatic? → A: Manual rollover button (Current_Qty=Closing_Qty; reset In/Out=0)
- Q: For the Needs list, should the app support print or WhatsApp-ready text export? → A: WhatsApp-ready text export (copy/share)
- Q: Can users add additional items to the Needs list beyond threshold-based items? → A: Yes — users can add and manage manual needs
- Q: Should Inventory, Sales, and Needs be editable per selected date (CRUD by day)? → A: Yes — user can select a date and create/update/delete that day’s records
- Q: Should there be an Admin page for reports and threshold updates? → A: Yes — add an Admin dashboard URL for sales charts and threshold editing

## User Scenarios & Testing *(mandatory)*

<!--
  IMPORTANT: User stories should be PRIORITIZED as user journeys ordered by importance.
  Each user story/journey must be INDEPENDENTLY TESTABLE - meaning if you implement just ONE of them,
  you should still have a viable MVP (Minimum Viable Product) that delivers value.

  Assign priorities (P1, P2, P3, etc.) to each story, where P1 is the most critical.
  Think of each story as a standalone slice of functionality that can be:
  - Developed independently
  - Tested independently
  - Deployed independently
  - Demonstrated to users independently
-->

### User Story 1 - Track Inventory & Low-Stock Alerts (Priority: P1)

As a stall operator, I can maintain a list of stock items (ingredients, packaging, and/or sellable items), update quantities during the day (restock/usage/adjustments), and immediately see which items are running low.

**Why this priority**: Avoid stock-outs during service and reduce manual tracking errors.

**Independent Test**: Create a few inventory items with thresholds, change quantities, and verify low-stock flags update correctly and persist across refresh.

**Acceptance Scenarios**:

1. **Given** an inventory item with a low-stock threshold, **When** its quantity is updated to be at or below the threshold, **Then** the item is visibly flagged as low stock.
2. **Given** an inventory list, **When** the user records a stock adjustment (increase or decrease) for an item, **Then** the current quantity reflects the adjustment and the change is saved.

---

### User Story 2 - Record Daily Sales & Expenses (Priority: P1)

As a stall operator, I can record sales and expenses for a specific day and quickly see a daily summary (total sales, total expenses, and net result).

**Why this priority**: Provides a simple end-of-day view of performance and cash movement.

**Independent Test**: Add sales and expense entries for a date and verify the daily totals and net result are correct and can be viewed later.

**Acceptance Scenarios**:

1. **Given** a selected date, **When** the user adds sales entries for that date, **Then** the daily sales total updates to include them.
2. **Given** a selected date, **When** the user adds expense entries for that date, **Then** the daily expense total updates to include them and the net result recalculates.

---

### User Story 3 - Generate “Needs!” Replenishment List (Priority: P2)

As a stall operator, I can quickly see a list of items that need replenishment (auto-flagged by threshold and also manually added needs) so I can buy supplies before the next service day.

**Why this priority**: Turns low-stock detection into a ready-to-use shopping list.

**Independent Test**: Adjust a few inventory items below threshold and verify they appear on the Needs list; items above threshold do not.

**Acceptance Scenarios**:

1. **Given** inventory items with thresholds, **When** some items have Closing_Qty at or below Threshold_Limit, **Then** the Needs list shows only those items.
2. **Given** the Needs list, **When** the user adds a manual need item, **Then** it appears in the list and remains there until removed/marked resolved.
3. **Given** the Needs list, **When** the user copies/exports the list text, **Then** the output includes each needed item and its Closing_Qty and Unit (when available), and also includes manual needs (even if quantity is unknown).

---

### Edge Cases
- Attempting to record non-numeric, negative, or excessively large quantities or amounts.
- Editing or deleting historical records (prior dates) and ensuring totals are updated correctly.
- Two staff members making updates at the same time (conflicting edits).
- Temporary loss of connectivity or inability to reach the data store (read-only fallback and clear error messaging).
- Inventory list contains missing or duplicated product names; the system must behave predictably (e.g., prevent duplicates or handle them safely).
- Items with missing threshold or unit values; the system must still calculate Closing_Qty and apply a consistent default for highlighting rules.
- Invalid or missing API token; the system must block saves and show a clear error message.
- Manual needs added that don’t exist in Inventory; the system must still include them in exports and allow removing them.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST provide three primary areas: Inventory, Sales, and Needs (replenishment list).
- **FR-001a**: The system MUST require a shared secret token for reading and writing data (configured by the business).
- **FR-002**: The system MUST allow users to create, edit, and archive inventory items with a name, unit of measure, and low-stock threshold.
- **FR-003**: The system MUST allow users to view current quantity per inventory item and see a clear low-stock indicator when quantity is at or below threshold.
- **FR-004**: The system MUST allow users to record inventory adjustments (increase/decrease) with a date/time, quantity change, and a short reason (e.g., restock, spoilage, recount).
- **FR-005**: The system MUST keep an audit-friendly history of inventory adjustments so users can review “what changed” for a date range.
- **FR-005a**: The system MUST provide a manual “Rollover Day” action that sets each item’s Current_Qty to its Closing_Qty and resets In_Stock and Out_Stock to 0.
- **FR-005b**: The system MUST allow users to select a date and create/update/delete that day’s inventory record set.
- **FR-006**: The system MUST allow users to record sales entries with date, amount, and optional notes (e.g., event day, promo).
- **FR-007**: The system MUST allow users to record expense entries with date, amount, category (user-defined or selected), and notes (e.g., ingredients, gas, packaging).
- **FR-008**: The system MUST calculate and display per-day totals: total sales, total expenses, and net result (sales minus expenses).
- **FR-008a**: The system MUST allow users to select a date and create/update/delete that day’s sales ledger.
- **FR-009**: The system MUST provide a Needs view that lists only items where Closing_Qty is at or below the threshold.
- **FR-009a**: The system MUST allow users to copy/export the Needs list as share-ready text (for WhatsApp/SMS).
- **FR-009b**: The system MUST allow users to add manual need items (in addition to threshold-based items) and remove/resolve them later.
- **FR-009c**: The system MUST ensure manual needs are not lost or overwritten when inventory values change.
- **FR-009d**: The system MUST allow users to select a date and manage manual needs for that date.
- **FR-010**: The system MUST allow users to search and filter sales and expenses by date (at minimum: today, specific date, and date range).
- **FR-011**: The system MUST protect against accidental data loss by requiring confirmation before deleting records that affect totals.
- **FR-012**: The system MUST store data in a shared spreadsheet accessible to the business so records can be viewed and backed up outside the app.
- **FR-013**: The system MUST provide an Admin area that shows sales reports (charts/totals) for a selected date range.
- **FR-014**: The system MUST allow an Admin user to update per-product threshold limits.

### Key Entities *(include if feature involves data)*

- **Inventory Item**: A tracked stock item (name, unit, current quantity, low-stock threshold, active/archived state).
- **Inventory Adjustment**: A dated change to an inventory item’s quantity (delta, reason, who/what recorded it).
- **Sales Entry**: A dated record of sales amount (and optional notes).
- **Expense Entry**: A dated record of expense amount (category and optional notes).
- **Needs Item**: A derived view of an inventory item that is at/below threshold (product, closing quantity, unit, threshold status).
- **Manual Need**: A user-added needs entry (name, optional quantity/unit/notes, resolved/active state).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A staff member can add a new inventory item (including threshold) in under 60 seconds.
- **SC-002**: A staff member can complete an end-of-day entry (sales + expenses) for a date in under 3 minutes.
- **SC-003**: Low-stock items are correctly flagged 100% of the time when quantity is at or below the configured threshold.
- **SC-004**: For a selected date, daily totals (sales, expenses, net) match manually calculated results with 0 discrepancies across a minimum of 30 recorded days.
- **SC-005**: At least 90% of intended users report the system is “easy to use” after one week of use (simple 1-question survey).

## Assumptions
- The primary users are stall staff/owners, and the app is used by a small team (often 1–3 people) with minimal training time.
- Users generally have stable internet connectivity during use; if not, the app clearly communicates when updates cannot be saved.
- The business will configure and keep a shared secret token private for app access.
- Inventory quantities represent what the business chooses to track (ingredients, packaging, and/or sellable items); the initial set of items is configured by the business.
- “Needs!” includes both threshold-derived items and user-maintained manual needs in v1.
- Order management is out of scope for v1 of the 3-page app.
- The business requires the underlying records to be accessible in a shared spreadsheet for backup, auditing, and ad-hoc review.
