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
- `SI_DB_POOL_MAX`: optional per-instance connection limit; defaults to `5`.

Do not expose database credentials, the API token, JWT secret, or pepper through `NEXT_PUBLIC_*` variables.

## Database

All application tables live under the `schyler_kitchen` schema. Runtime code reads and writes normalized PostgreSQL tables directly; the XLSX file is an offline migration source only.

- Schema: `db/schema.sql`
- Node importer: `scripts/import-xlsx.mjs`
- Standalone Neon SQL import: `db/import-takoyaki-data.sql`
- Setup and mapping guide: `docs/neon-database.md`

## Verification

```bash
npm test
npm run build
```
