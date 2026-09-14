BEGIN;

CREATE SCHEMA IF NOT EXISTS schyler_kitchen;
SET LOCAL search_path TO schyler_kitchen, public;

CREATE TABLE IF NOT EXISTS schema_versions (
  version integer PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username text NOT NULL,
  password_hash text NOT NULL,
  salt text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'staff')),
  active boolean NOT NULL DEFAULT true,
  UNIQUE (username)
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_normalized_uq ON users (lower(trim(username)));

CREATE TABLE IF NOT EXISTS inventory_items (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product text NOT NULL UNIQUE,
  unit text NOT NULL DEFAULT '',
  threshold_limit numeric(18,3) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS inventory_days (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_date date NOT NULL UNIQUE,
  is_closed boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS inventory_day_items (
  inventory_day_id bigint NOT NULL REFERENCES inventory_days(id) ON DELETE CASCADE,
  inventory_item_id bigint NOT NULL REFERENCES inventory_items(id),
  current_qty numeric(18,3) NOT NULL DEFAULT 0,
  in_stock numeric(18,3) NOT NULL DEFAULT 0,
  out_stock numeric(18,3) NOT NULL DEFAULT 0,
  closing_qty numeric(18,3) NOT NULL DEFAULT 0,
  unit_snapshot text NOT NULL DEFAULT '',
  threshold_snapshot numeric(18,3) NOT NULL DEFAULT 0,
  PRIMARY KEY (inventory_day_id, inventory_item_id)
);

CREATE TABLE IF NOT EXISTS product_catalog (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  category text NOT NULL DEFAULT '',
  name text NOT NULL UNIQUE,
  price numeric(18,2) NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS sales_ledgers (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_date date NOT NULL UNIQUE,
  raw_row jsonb NOT NULL,
  takoyaki_sales numeric(18,2) NOT NULL DEFAULT 0,
  expenses_total numeric(18,2) NOT NULL DEFAULT 0,
  total_cash_calculated numeric(18,2) NOT NULL DEFAULT 0,
  previous_cash_added numeric(18,2) NOT NULL DEFAULT 0,
  final_total_cash numeric(18,2) NOT NULL DEFAULT 0,
  remaining_balance numeric(18,2) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS replenishment_needs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_date date NOT NULL,
  product text NOT NULL,
  inventory_item_id bigint REFERENCES inventory_items(id),
  current_closing_qty numeric(18,3) NOT NULL DEFAULT 0,
  status text NOT NULL,
  UNIQUE (business_date, product, status)
);

CREATE TABLE IF NOT EXISTS staff_members (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  display_name text NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS attendance (
  business_date date NOT NULL,
  staff_id bigint NOT NULL REFERENCES staff_members(id),
  on_duty boolean NOT NULL DEFAULT false,
  PRIMARY KEY (business_date, staff_id)
);

CREATE TABLE IF NOT EXISTS face_profiles (
  staff_id bigint PRIMARY KEY REFERENCES staff_members(id) ON DELETE CASCADE,
  descriptor_ciphertext text NOT NULL,
  consent_at timestamptz NOT NULL,
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  active boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS face_attendance_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  staff_id bigint NOT NULL REFERENCES staff_members(id),
  event_time timestamptz NOT NULL DEFAULT now(),
  event_type text NOT NULL DEFAULT 'CHECK_IN' CHECK (event_type IN ('CHECK_IN','CHECK_OUT')),
  confidence numeric(6,5) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  verification text NOT NULL DEFAULT 'FACE',
  device_label text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS face_attendance_events_staff_time_idx ON face_attendance_events(staff_id,event_time DESC);

CREATE TABLE IF NOT EXISTS app_config (
  key text PRIMARY KEY,
  value jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS migration_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workbook_hash text NOT NULL,
  source_file text NOT NULL,
  status text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  report jsonb
);
CREATE TABLE IF NOT EXISTS migration_records (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id bigint NOT NULL REFERENCES migration_runs(id) ON DELETE CASCADE,
  workbook_hash text NOT NULL,
  sheet_name text NOT NULL,
  source_row integer NOT NULL,
  logical_key text NOT NULL,
  fingerprint text NOT NULL,
  raw_row jsonb NOT NULL,
  disposition text NOT NULL CHECK (disposition IN ('loaded','quarantined','approved-excluded')),
  reason text,
  UNIQUE (workbook_hash, sheet_name, source_row)
);

CREATE TABLE IF NOT EXISTS application_write_log (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  action text NOT NULL,
  entity_identity text NOT NULL,
  actor text,
  before_payload jsonb,
  after_payload jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO schema_versions(version) VALUES (1),(2) ON CONFLICT DO NOTHING;
COMMIT;
