# Schyler's Kitchen Inventory

Next.js inventory, sales, replenishment, administration, authentication, and weekly attendance application backed exclusively by Neon PostgreSQL.

## Local setup

```bash
npm install
cp .env.example .env.local
npm run db:migrate
npm run db:import:dry-run -- --file "Takoyaki Simple Inventory.xlsx"
npm run db:import -- --file "Takoyaki Simple Inventory.xlsx"
npm run dev
```

Open `http://localhost:3000`. Local development can connect directly to Neon when `DATABASE_URL` and `DATABASE_URL_UNPOOLED` contain the Neon pooled and direct connection strings with `sslmode=verify-full`.

## Environment variables

- `DATABASE_URL`: pooled Neon runtime connection.
- `DATABASE_URL_UNPOOLED`: direct connection used only by schema and import scripts.
- `SI_API_TOKEN`: server-only administrative API token.
- `SI_JWT_SECRET`: signs login sessions.
- `SI_AUTH_PEPPER`: participates in password hashing and must remain stable.
- `FACE_DESCRIPTOR_KEY`: encrypts face descriptors and must remain stable. Use a separate long random secret in Vercel.
- `SI_DB_POOL_MAX`: optional per-instance connection limit; defaults to `5`.

Do not expose database credentials, the API token, JWT secret, or pepper through `NEXT_PUBLIC_*` variables.

Face detection, liveness checks, and descriptor generation run in the browser. Raw camera images are not uploaded or stored. Enrollment requires recorded staff consent and should always have a non-biometric fallback.

## Database

All application tables live under the `schyler_kitchen` schema. Runtime code reads and writes normalized PostgreSQL tables directly; the XLSX file is an offline migration source only.

- Schema: `db/schema.sql`
- Node importer: `scripts/import-xlsx.mjs`
- Standalone Neon SQL import: `db/import-takoyaki-data.sql`
- Setup and mapping guide: `docs/neon-database.md`

## Inventory and order entry

Inventory loads automatically when the date changes. Search or filter for low stock, enter stock added and used, then select **Save inventory**. Copy, closed-day, and delete actions are in the actions menu. A closed day means the shop did not operate; it is not an end-of-shift action.

In Sales, choose products from **New order**, adjust quantities in the basket, and select **Record sale**. A successful save adds the sale to the selected day's totals and clears the basket. **Daily summary** contains expenses, staff payouts, cash carried over, and corrections. Sales history and export are in the actions menu.

Sales still use the daily ledger: individual order records, receipts, payments, and automatic stock deductions are future POS work. New sales preserve previously recorded revenue and historical product quantities, including products removed from the active menu.

## Needs and administration

Needs shows stock to replenish for the selected date, plus a checklist for other supplies. Check off supplies as they are picked up, use **Undo** to restore the most recently completed item, or copy the shopping list. Stock alerts clear after updating inventory; each stock item links to its inventory entry on the selected date.

Admin separates **Overview**, **Inventory items**, **Menu products**, **Attendance**, and **Sales settings**. Item, menu, and settings edits are applied with the save bar. New catalog entries are added to the list before saving. Turn off a product's **Available** checkbox to hide it from new orders. Permanent deletion remains in each item's actions menu.

Reports include the full selected date range, with monthly chart totals for ranges longer than 31 days. Detailed daily figures and all product quantities can be expanded. Attendance shows weekly status and clock activity; camera enrollment and check-in controls open only when **Manage face attendance** is selected.

## Attendance, pay and custom entries

In **Admin → Sales settings**, set each staff member's **Daily pay**, **Quota bonus** (default ₱50) and **OT / hour** (default ₱50). The shop's daily sales quota defaults to ₱4,000. A bonus applies to every on-duty staff member when that day's saved sales are **strictly greater** than the quota; exactly ₱4,000 does not qualify.

In **Admin → Attendance**, select a week and review each person's duty days. Sales records and face attendance suggest duty until an admin saves explicit entries. Select **Edit days** to open the staff attendance modal, correct duty and enter overtime hours. Save directly in the modal; closing it keeps unsaved edits in the weekly overview. **Save attendance** captures the pay rates for that week. Later settings changes do not alter those saved rates; **Use current pay settings** explicitly replaces them. Saved sales totals still determine quota eligibility, so corrections to sales can change a reprinted payslip.

Select **Payslip** for an individual staff member to preview and print the selected Sunday–Saturday week (or save it as PDF through the print dialog). Missing daily rates must be set first. Payslips show base pay, quota bonuses, overtime hours/pay, and total earnings before deductions. Printing does not create a staff cash payout; record actual payments in Sales.

Inventory and menu names can be edited in their Admin lists. Inventory renames keep the same item and its stock history; previously recorded sales retain their original menu names. Duplicate names are rejected.

In **Sales → New order**, use **Custom sale** for variable-price items such as “Barkada mix” at ₱230, then record the order. In **Daily summary**, **Other expense** accepts a description and amount, such as “Delivery fee” at ₱80. Both are retained in the daily ledger; custom sales increase sales and custom expenses reduce cash balance and appear in expense reports.

Existing installations need `npm run db:migrate` before running this version. Schema version 3 adds overtime hours and saved pay-rate details to attendance without removing existing records.

## Verification

```bash
npm test
npm run build
```

Payroll calculations and custom ledger amounts have unit tests. `test/payroll-postgres.test.js` additionally verifies persistence, inventory history after renaming, manual attendance overrides, and staff access restrictions when `TEST_DATABASE_URL` is supplied. Its test records are enclosed in a transaction that always rolls back.
