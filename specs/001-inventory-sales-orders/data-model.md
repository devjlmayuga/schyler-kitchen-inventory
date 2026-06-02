# Data Model: Takoyaki Stall Inventory, Sales, & Orders

**Date**: 2026-05-21

This feature stores operational data in a single Google Sheet with three primary tabs.

## Spreadsheet Tabs

### 1) `Inventory`

One row per `Product`. This tab represents the current working day’s inventory state.

**Columns**

| Column | Type | Notes |
|-------|------|-------|
| Product | string | Primary key for the row (must be unique). |
| Current_Qty | number | Starting quantity for the day (or “current base”). |
| In_Stock | number | Quantity added during the day. |
| Out_Stock | number | Quantity used/removed during the day. |
| Closing_Qty | number | Computed: `Current_Qty + In_Stock - Out_Stock`. Stored for convenience. |
| Unit | string | E.g., pcs, packs, grams, ml. |
| Threshold_Limit | number | Minimum acceptable Closing_Qty; at/below triggers replenish. |

**Derived fields (UI)**
- `NeedsReplenish`: `Closing_Qty <= Threshold_Limit`

### 1b) `Inventory_History`

Stores one snapshot per product per day to support per-day CRUD in the app.

**Columns**

| Column | Type | Notes |
|-------|------|-------|
| Date | string | `YYYY-MM-DD`. |
| Product | string | Matches Inventory.Product. |
| Current_Qty | number | Starting quantity for the day. |
| In_Stock | number | Quantity added during the day. |
| Out_Stock | number | Quantity used/removed during the day. |
| Closing_Qty | number | Computed: `Current_Qty + In_Stock - Out_Stock`. |
| Unit | string | Copied from Inventory.Unit for convenience. |
| Threshold_Limit | number | Copied from Inventory.Threshold_Limit for convenience. |
| Is_Closed | string | Optional day flag (`Y` = stall closed for this date). Stored per row for simplicity. |

**Sample products (seed list)**
Flour, Batter, Sauce, Mayo, Bonito, Aonori, Cheese, Bacon, Octo, Crab, Chicken, Tuna, Chili, Egg, Oil, Cabbage, Styro, Fork, Keychain, Bracelet

### 2) `Sales_Finance`

One row per saved daily ledger entry (append-only).

**Columns**

| Column | Type | Notes |
|-------|------|-------|
| Date | string | ISO timestamp of save (e.g., `2026-05-21T09:15:00+08:00`). |
| Takoyaki_Sales | number | Input amount for the day/shift. |
| Expenses_Total | number | Computed: Allow + Ipon + Bill + Ilaw. |
| Breakdown_Allow | number | Expense input. |
| Breakdown_Ipon | number | Expense input. |
| Breakdown_Bill | number | Expense input. |
| Breakdown_Ilaw | number | Expense input. |
| Total_Cash_Calculated | number | Computed: Takoyaki_Sales - Expenses_Total. |
| Previous_Cash_Added | number | “Add Cash” / brought-forward cash. |
| Final_Total_Cash | number | Computed: Total_Cash_Calculated + Previous_Cash_Added. |
| Payout_Mykah | number | Partner payout input. |
| Payout_Natalie | number | Partner payout input. |
| Remaining_Balance | number | Computed: Final_Total_Cash - Payout_Mykah - Payout_Natalie. |

### 3) `Needs_Replenish`

This tab can be derived from `Inventory`. Optionally, it can be synced so non-app users can see the current shopping list.
It can also store user-added manual needs that are not tied to threshold logic.

**Columns**

| Column | Type | Notes |
|-------|------|-------|
| Date | string | `YYYY-MM-DD` to support per-day needs (manual + derived references). |
| Product | string | For `NEEDS_AUTO`, matches Inventory.Product; for `NEEDS_MANUAL`, can be free-text. |
| Current_Closing_Qty | number | Mirrors Inventory.Closing_Qty at sync time. |
| Status | string | Suggested values: `NEEDS_AUTO`, `NEEDS_MANUAL`, `OK`. |

## Data Integrity Rules

- All numeric fields must parse to finite numbers; blank inputs default to `0` for calculations (but store explicitly as `0` when submitting).
- `Product` names are treated as identifiers; renaming a product changes the key and should be a deliberate action.
- Threshold logic uses “at or below” (`<=`) per requirements.
