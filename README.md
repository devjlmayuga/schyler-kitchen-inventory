# Schyler's Kitchen Inventory

Next.js POS, inventory, sales, replenishment, administration, authentication, and weekly attendance application backed exclusively by Neon PostgreSQL.

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

## Inventory and POS

Inventory loads automatically when the date changes. Search or filter for low stock, enter stock added and used, then select **Save inventory**. Copy, closed-day, and delete actions are in the actions menu. A closed day means the shop did not operate; it is not an end-of-shift action.

In **POS**, tap menu items, adjust quantities, and choose Takeaway, Dine-in, or Delivery. **Add a custom-priced item** accepts variable-price items such as “Barkada mix” at ₱230. Customer/table and order notes are optional. Enter cash received to calculate change, or leave it blank for exact payment. **Complete & print** saves the order, adds it to Sales, clears the basket, and opens the order slip. Disable automatic printing in **Printer setup** to use **Complete sale** instead.

Orders use the current date in Asia/Manila. Each order and its daily sales update commit together. If a checkout is interrupted, **Retry save** uses the same order reference so it is counted once. Pending checkouts survive a reload in the same tab. An internet connection is required to complete an order. **Saved orders** lets staff review and reprint previous slips, retaining the names and prices sold even after menu changes. Printing failures never create another sale.

**Sales** contains daily totals, expenses, staff payouts, cash carried over, and history/export. New POS orders preserve earlier revenue and historical product quantities. If another terminal updates Sales while an expense edit is open, reload the latest totals before saving.

To fix a mistake, choose **Sales → Edit sales / orders**, open the order, then **Edit sale**. You can also open it from **POS → Saved orders**. Correct products, quantities, unit prices, custom items, cash received, customer/table, and notes, then **Save correction**. The same order number is retained and its original day's sales, product counts, and cash balance update together. Catalog prices and other orders/expenses are preserved. Corrected slips show their revision and can be reprinted. Each correction keeps its previous and new values, operator, time, and optional note in the database. Interrupted saves can be retried without duplicating the correction; concurrent edits require reloading the latest order.

Historical days without POS orders still support **Adjust recorded sales** for daily totals and quantities. Days containing POS orders use individual order corrections so receipts and totals stay consistent. To remove a mistaken or duplicate sale, open **POS → Saved orders**, select the trash action, review the amount, and confirm **Delete sale**. The order is removed from saved orders and its amount and quantities are deducted from that day's totals; other sales and expenses remain unchanged. The deletion, operator, time, and optional note remain in the audit record. Deleting an order does not issue a payment refund. Electronic payment processing and automatic stock deductions are not implemented in this version.

## Order slip printing

**Printer setup** is saved on each device and offers 58 mm or 80 mm paper:

- **Device print dialog** is the default web workflow on Android, iPhone/iPad, Windows, and Mac. Select a printer exposed by the operating system, or save as PDF. A connected Bluetooth printer needs a compatible manufacturer print service/driver; pairing alone does not guarantee it will appear. Use the matching paper size, no browser headers/footers, and 100% scale where available.
- **Bluetooth Classic / USB serial** uses Web Serial in compatible desktop browsers with an ESC/POS printer. Pair Bluetooth Classic printers in the operating system first, select the printer in the browser chooser, and use its documented baud rate.
- **Bluetooth Low Energy** uses Web Bluetooth in compatible browsers with an ESC/POS BLE printer. Enter the manufacturer's service and writable characteristic UUIDs, then **Connect printer**. Bluetooth Classic-only printers cannot use this method.

Direct connection requires HTTPS (localhost also works) and browser permission; reconnect after reloading when needed. Unsupported direct methods are disabled. Direct slips use plain ASCII text and `PHP`; use the device print dialog for non-Latin names. Enable cutting only for printers with a cutter. A successful send confirms delivery to the connection, not physical paper output; check the printer before reprinting a partially printed slip. Printing or cancelling the print dialog does not affect the saved sale.

Browser support references: [Chrome Web Bluetooth](https://developer.chrome.com/docs/capabilities/bluetooth), [Bluetooth Classic over Web Serial](https://developer.chrome.com/blog/serial-over-bluetooth). Direct output uses [Epson ESC/POS commands](https://download4.epson.biz/sec_pubs/pos/reference_en/escpos/tmt20ivl.html). Physical printer compatibility must be checked with the printer model in use.

## Needs and administration

Needs shows stock to replenish for the selected date, plus a checklist for other supplies. Check off supplies as they are picked up, use **Undo** to restore the most recently completed item, or copy the shopping list. Stock alerts clear after updating inventory; each stock item links to its inventory entry on the selected date.

Admin separates **Overview**, **Inventory items**, **Menu products**, **Attendance**, and **Sales settings**. Item, menu, and settings edits are applied with the save bar. New catalog entries are added to the list before saving. Turn off a product's **Available** checkbox to hide it from new orders. Permanent deletion remains in each item's actions menu.

Reports include the full selected date range, with monthly chart totals for ranges longer than 31 days. Detailed daily figures and all product quantities can be expanded. Attendance shows weekly status and clock activity; camera enrollment and check-in controls open only when **Manage face attendance** is selected.

## Attendance, pay and custom entries

In **Admin → Sales settings**, set each staff member's **Daily pay**, **Quota bonus** (default ₱50) and **OT / hour** (default ₱50). The shop's daily sales quota defaults to ₱4,000. A bonus applies to every on-duty staff member when that day's saved sales are **strictly greater** than the quota; exactly ₱4,000 does not qualify.

In **Admin → Sales settings**, choose each staff member's regular Sunday–Saturday work days. In **Admin → Attendance**, select a week and review that default schedule. Select **Schedule & days** to adjust a specific week and mark planned days, actual duty and overtime independently. Sales records and face attendance can suggest actual duty until an admin saves explicit entries. Salary, quota and overtime use actual duty; scheduled-only days are shown separately and do not affect pay. Save directly in the modal; closing it keeps unsaved edits in the weekly overview. **Save attendance** captures the pay rates for that week. Later settings changes do not alter those saved rates; **Use current pay settings** explicitly replaces them. Saved sales totals still determine quota eligibility, so corrections to sales can change a reprinted payslip.

Select **Payslip** for an individual staff member to preview the selected Sunday–Saturday week. Use **Download PDF** to save it directly as `staffName_startDate_to_endDate.pdf`, or **Print** for the device print dialog. Missing daily rates must be set first. Payslips show base pay, quota bonuses, overtime hours/pay, and total earnings before deductions. Downloading or printing does not create a staff cash payout; record actual payments in Sales.

Inventory and menu names can be edited in their Admin lists. Inventory renames keep the same item and its stock history; previously recorded sales retain their original menu names. Duplicate names are rejected.

In **POS**, use **Add a custom-priced item** for variable-price items. In **Sales**, **Other expense** accepts a description and amount, such as “Delivery fee” at ₱80. Both are retained in the daily ledger; custom sales increase sales and custom expenses reduce cash balance and appear in expense reports.

Existing installations need `npm run db:migrate` before running this version. Schema version 3 adds overtime hours and saved pay-rate details to attendance. Version 4 adds saved POS orders and sales revision checks. Version 5 adds order revisions and correction history. Version 6 adds recoverable sale-deletion metadata. Version 7 adds flexible weekly staff schedules. Existing records are preserved.

## Verification

```bash
npm test
npm run build
```

Unit tests cover payroll, custom amounts, POS pricing/validation, order corrections, ledger preservation, thermal slip formatting, and Bluetooth write sequencing. With `TEST_DATABASE_URL` supplied, `test/payroll-postgres.test.js` verifies payroll persistence, inventory history after renaming, manual attendance overrides, and staff access restrictions. `test/pos-postgres.test.js` verifies order persistence, correction history, retry deduplication, historical prices, conflicting edits, expense preservation, and order pagination. Both integration suites enclose their records in transactions that always roll back.
