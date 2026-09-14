import fs from 'node:fs';
import path from 'node:path';
import { profileWorkbook, readWorkbook } from '../db/workbook.js';

const option = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
};
const input = option('--file', 'Takoyaki Simple Inventory.xlsx');
const output = path.resolve(option('--output', 'db/import-takoyaki-data.sql'));
const workbook = await readWorkbook(input);
const profile = profileWorkbook(workbook);
if (profile.dispositions.quarantined) throw new Error(`SQL generation blocked: ${profile.dispositions.quarantined} quarantined row(s)`);

const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
const rows = (name) => workbook.sheets.find((sheet) => sheet.name === name)?.records.map((record) => record.raw) || [];
const statements = [];
statements.push(`-- Generated from ${path.basename(input)}. SHA-256: ${profile.workbookHash}`);
statements.push('-- Contains password hashes and salts from the Users sheet. Store and share securely.');
statements.push('-- Run db/schema.sql first. This script is transactional and safe to rerun.');
statements.push('BEGIN;');
statements.push('SET LOCAL search_path TO schyler_kitchen, public;');

statements.push(`INSERT INTO migration_runs(workbook_hash,source_file,status,completed_at,report)
SELECT ${literal(profile.workbookHash)},${literal(path.basename(input))},'completed',now(),${literal(JSON.stringify({ rowCount: profile.rowCount, dispositions: profile.dispositions }))}::jsonb
WHERE NOT EXISTS (SELECT 1 FROM migration_runs WHERE workbook_hash=${literal(profile.workbookHash)} AND status='completed');`);

const migrationRows = profile.records.map((row) => ({
  sheet_name: row.sheetName, source_row: row.sourceRow, logical_key: row.logicalKey,
  fingerprint: row.fingerprint, raw_row: row.raw, disposition: row.disposition, reason: row.reason,
}));
statements.push(`INSERT INTO migration_records(run_id,workbook_hash,sheet_name,source_row,logical_key,fingerprint,raw_row,disposition,reason)
SELECT r.id,${literal(profile.workbookHash)},x.sheet_name,x.source_row,x.logical_key,x.fingerprint,x.raw_row,x.disposition,x.reason
FROM jsonb_to_recordset(${literal(JSON.stringify(migrationRows))}::jsonb)
  AS x(sheet_name text,source_row integer,logical_key text,fingerprint text,raw_row jsonb,disposition text,reason text)
CROSS JOIN LATERAL (SELECT id FROM migration_runs WHERE workbook_hash=${literal(profile.workbookHash)} ORDER BY id DESC LIMIT 1) r
ON CONFLICT(workbook_hash,sheet_name,source_row) DO UPDATE SET logical_key=excluded.logical_key,fingerprint=excluded.fingerprint,raw_row=excluded.raw_row,disposition=excluded.disposition,reason=excluded.reason;`);

statements.push(`INSERT INTO inventory_items(product,unit,threshold_limit)
SELECT trim("Product"),coalesce("Unit",''),coalesce(nullif(replace("Threshold_Limit",',',''),''),'0')::numeric
FROM jsonb_to_recordset(${literal(JSON.stringify(rows('Inventory')))}::jsonb) AS x("Product" text,"Unit" text,"Threshold_Limit" text)
WHERE trim(coalesce("Product",''))<>'' ON CONFLICT(product) DO UPDATE SET unit=excluded.unit,threshold_limit=excluded.threshold_limit;`);
statements.push(`INSERT INTO product_catalog(category,name,price,active)
SELECT coalesce("Category",''),trim("Name"),coalesce(nullif(replace("Price",',',''),''),'0')::numeric,
  upper(trim(coalesce("Active",'Y'))) NOT IN ('N','NO','FALSE','0')
FROM jsonb_to_recordset(${literal(JSON.stringify(rows('Products')))}::jsonb) AS x("Category" text,"Name" text,"Price" text,"Active" text)
WHERE trim(coalesce("Name",''))<>'' ON CONFLICT(name) DO UPDATE SET category=excluded.category,price=excluded.price,active=excluded.active;`);
statements.push(`INSERT INTO users(username,password_hash,salt,role,active)
SELECT trim("Username"),coalesce("Password_Hash",''),coalesce("Salt",''),coalesce(nullif("Role",''),'staff'),
  upper(trim(coalesce("Active",'Y'))) NOT IN ('N','NO','FALSE','0')
FROM jsonb_to_recordset(${literal(JSON.stringify(rows('Users')))}::jsonb) AS x("Username" text,"Password_Hash" text,"Salt" text,"Role" text,"Active" text)
WHERE trim(coalesce("Username",''))<>'' ON CONFLICT ((lower(trim(username)))) DO NOTHING;`);

const history = literal(JSON.stringify(rows('Inventory_History')));
statements.push(`WITH source AS (SELECT DISTINCT ON (trim("Product")) trim("Product") product,coalesce("Unit",'') unit,coalesce(nullif(replace("Threshold_Limit",',',''),''),'0')::numeric threshold
FROM jsonb_to_recordset(${history}::jsonb) AS x("Product" text,"Unit" text,"Threshold_Limit" text) WHERE trim(coalesce("Product",''))<>'' ORDER BY trim("Product"))
INSERT INTO inventory_items(product,unit,threshold_limit) SELECT product,unit,threshold FROM source ON CONFLICT(product) DO NOTHING;`);
statements.push(`WITH source AS (SELECT left("Date",10)::date business_date,bool_or(upper(trim(coalesce("Is_Closed",''))) IN ('Y','YES','TRUE','1')) is_closed
FROM jsonb_to_recordset(${history}::jsonb) AS x("Date" text,"Is_Closed" text) WHERE left(coalesce("Date",''),10) ~ '^\\d{4}-\\d{2}-\\d{2}$' GROUP BY 1)
INSERT INTO inventory_days(business_date,is_closed) SELECT business_date,is_closed FROM source ON CONFLICT(business_date) DO UPDATE SET is_closed=inventory_days.is_closed OR excluded.is_closed;`);
statements.push(`WITH source AS (SELECT left("Date",10)::date business_date,trim("Product") product,
coalesce(nullif(replace("Current_Qty",',',''),''),'0')::numeric current_qty,coalesce(nullif(replace("In_Stock",',',''),''),'0')::numeric in_stock,
coalesce(nullif(replace("Out_Stock",',',''),''),'0')::numeric out_stock,coalesce(nullif(replace("Closing_Qty",',',''),''),'0')::numeric closing_qty,
coalesce("Unit",'') unit_snapshot,coalesce(nullif(replace("Threshold_Limit",',',''),''),'0')::numeric threshold_snapshot
FROM jsonb_to_recordset(${history}::jsonb) AS x("Date" text,"Product" text,"Current_Qty" text,"In_Stock" text,"Out_Stock" text,"Closing_Qty" text,"Unit" text,"Threshold_Limit" text)
WHERE trim(coalesce("Product",''))<>'' AND left(coalesce("Date",''),10) ~ '^\\d{4}-\\d{2}-\\d{2}$')
INSERT INTO inventory_day_items(inventory_day_id,inventory_item_id,current_qty,in_stock,out_stock,closing_qty,unit_snapshot,threshold_snapshot)
SELECT d.id,i.id,s.current_qty,s.in_stock,s.out_stock,s.closing_qty,s.unit_snapshot,s.threshold_snapshot FROM source s
JOIN inventory_days d ON d.business_date=s.business_date JOIN inventory_items i ON i.product=s.product
ON CONFLICT(inventory_day_id,inventory_item_id) DO UPDATE SET current_qty=excluded.current_qty,in_stock=excluded.in_stock,out_stock=excluded.out_stock,closing_qty=excluded.closing_qty,unit_snapshot=excluded.unit_snapshot,threshold_snapshot=excluded.threshold_snapshot;`);

statements.push(`INSERT INTO sales_ledgers(business_date,raw_row,takoyaki_sales,expenses_total,total_cash_calculated,previous_cash_added,final_total_cash,remaining_balance)
SELECT left(raw->>'Date',10)::date,raw,coalesce(nullif(replace(raw->>'Takoyaki_Sales',',',''),''),'0')::numeric,coalesce(nullif(replace(raw->>'Expenses_Total',',',''),''),'0')::numeric,
coalesce(nullif(replace(raw->>'Total_Cash_Calculated',',',''),''),'0')::numeric,coalesce(nullif(replace(raw->>'Previous_Cash_Added',',',''),''),'0')::numeric,
coalesce(nullif(replace(raw->>'Final_Total_Cash',',',''),''),'0')::numeric,coalesce(nullif(replace(raw->>'Remaining_Balance',',',''),''),'0')::numeric
FROM jsonb_array_elements(${literal(JSON.stringify(rows('Sales_Finance')))}::jsonb) AS source(raw)
WHERE left(coalesce(raw->>'Date',''),10) ~ '^\\d{4}-\\d{2}-\\d{2}$' ON CONFLICT(business_date) DO UPDATE SET raw_row=excluded.raw_row,takoyaki_sales=excluded.takoyaki_sales,expenses_total=excluded.expenses_total,total_cash_calculated=excluded.total_cash_calculated,previous_cash_added=excluded.previous_cash_added,final_total_cash=excluded.final_total_cash,remaining_balance=excluded.remaining_balance;`);
statements.push(`INSERT INTO replenishment_needs(business_date,product,inventory_item_id,current_closing_qty,status)
SELECT left(x."Date",10)::date,trim(x."Product"),i.id,coalesce(nullif(replace(x."Current_Closing_Qty",',',''),''),'0')::numeric,coalesce(x."Status",'')
FROM jsonb_to_recordset(${literal(JSON.stringify(rows('Needs_Replenish')))}::jsonb) AS x("Date" text,"Product" text,"Current_Closing_Qty" text,"Status" text)
LEFT JOIN inventory_items i ON i.product=trim(x."Product") WHERE trim(coalesce(x."Product",''))<>'' AND left(coalesce(x."Date",''),10) ~ '^\\d{4}-\\d{2}-\\d{2}$'
ON CONFLICT(business_date,product,status) DO UPDATE SET inventory_item_id=excluded.inventory_item_id,current_closing_qty=excluded.current_closing_qty;`);
statements.push(`INSERT INTO app_config(key,value) SELECT trim("Key"),to_jsonb(coalesce("Value",''))
FROM jsonb_to_recordset(${literal(JSON.stringify(rows('Config')))}::jsonb) AS x("Key" text,"Value" text) WHERE trim(coalesce("Key",''))<>''
ON CONFLICT(key) DO UPDATE SET value=excluded.value;`);
statements.push(`WITH source AS (SELECT left("Date",10)::date business_date,trim("Staff") staff,upper(trim(coalesce("On_Duty",''))) IN ('Y','YES','TRUE','1') on_duty
FROM jsonb_to_recordset(${literal(JSON.stringify(rows('Attendance')))}::jsonb) AS x("Date" text,"Staff" text,"On_Duty" text)
WHERE trim(coalesce("Staff",''))<>'' AND left(coalesce("Date",''),10) ~ '^\\d{4}-\\d{2}-\\d{2}$'), members AS (
INSERT INTO staff_members(display_name) SELECT DISTINCT staff FROM source ON CONFLICT(display_name) DO UPDATE SET display_name=excluded.display_name RETURNING id,display_name)
INSERT INTO attendance(business_date,staff_id,on_duty) SELECT s.business_date,m.id,s.on_duty FROM source s JOIN members m ON m.display_name=s.staff
ON CONFLICT(business_date,staff_id) DO UPDATE SET on_duty=excluded.on_duty;`);

statements.push('COMMIT;');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${statements.join('\n\n')}\n`);
console.log(JSON.stringify({ output, workbookHash: profile.workbookHash, sheets: profile.sheetCount, rows: profile.rowCount }, null, 2));
