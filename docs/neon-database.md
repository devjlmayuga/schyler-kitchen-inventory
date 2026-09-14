# Neon database setup

1. Create a Neon PostgreSQL project in the same region as the Vercel function where possible. The migration creates every application table under the `schyler_kitchen` PostgreSQL schema; `public` is used only as the secondary search path.
2. Copy `.env.example` to `.env.local` (preferred) or `.env`. Set the pooled Neon URL as `DATABASE_URL` and the direct Neon URL as `DATABASE_URL_UNPOOLED`; both URLs should include `sslmode=verify-full`. Database scripts load `.env.local` first and fall back to `.env`.
3. From the local project run `npm run db:migrate`, then `npm run db:import:dry-run -- --file "Takoyaki Simple Inventory.xlsx"`.
4. Review the generated report. Import into the selected database with `npm run db:import -- --file "Takoyaki Simple Inventory.xlsx"`.
5. Add the same server-only variables to Vercel and deploy only after local import and application verification pass. PostgreSQL is the only runtime backend.

The importer hashes the source, records every source row, and uses a unique workbook/sheet/row identity, so rerunning the same backup does not duplicate records. Keep the XLSX immutable. Never prefix database URLs with `NEXT_PUBLIC_`.

## Workbook mapping

| XLSX sheet | PostgreSQL target |
|---|---|
| Inventory | `inventory_items` |
| Inventory_History | `inventory_days`, `inventory_day_items` |
| Products | `product_catalog` |
| Sales_Finance | `sales_ledgers` with the untouched source row in `raw_row` |
| Users | `users` with case-insensitive username uniqueness |
| Needs_Replenish | `replenishment_needs` with an optional inventory link |
| Attendance | `staff_members`, `attendance` |
| Config | `app_config` |

`migration_runs` and `migration_records` retain the workbook hash and row provenance. Runtime reads and writes use only the normalized PostgreSQL tables.
