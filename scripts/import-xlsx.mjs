import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { profileWorkbook, readWorkbook } from '../db/workbook.js';
import './load-env.mjs';

const value = (flag, fallback) => { const index = process.argv.indexOf(flag); return index < 0 ? fallback : process.argv[index + 1]; };
const file = value('--file', 'Takoyaki Simple Inventory.xlsx');
const dryRun = process.argv.includes('--dry-run');
const workbook = await readWorkbook(file);
const profile = profileWorkbook(workbook);
const report = { ...profile, records: profile.records.map(({ raw, ...row }) => row) };
fs.mkdirSync('migration-reports', { recursive: true });
const reportFile = path.resolve(`migration-reports/${profile.workbookHash}.json`);
fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
if (dryRun) {
  console.log(JSON.stringify({ reportFile, workbookHash: profile.workbookHash, sheetCount: profile.sheetCount, rowCount: profile.rowCount, bySheet: profile.bySheet, dispositions: profile.dispositions }, null, 2));
  process.exit(0);
}
if (profile.dispositions.quarantined) throw new Error(`Import blocked: ${profile.dispositions.quarantined} quarantined row(s)`);
const connectionString = String(process.env.DATABASE_URL_UNPOOLED || '').trim();
if (!connectionString) throw new Error('DATABASE_URL_UNPOOLED is required');
const client = new pg.Client({ connectionString });
await client.connect();
await client.query('set search_path to schyler_kitchen, public');

const number = (value) => {
  if (value == null || value === '') return 0;
  const parsed = Number(String(value).replaceAll(',', '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
};
const day = (value) => String(value || '').slice(0, 10);
const enabled = (value) => !['N', 'NO', 'FALSE', '0'].includes(String(value ?? '').trim().toUpperCase());

async function loadNormalized() {
  const sheet = (name) => workbook.sheets.find((candidate) => candidate.name === name)?.records || [];
  for (const { raw } of sheet('Inventory')) {
    const product = String(raw.Product || '').trim();
    if (!product) continue;
    await client.query(`insert into inventory_items(product,unit,threshold_limit) values($1,$2,$3)
      on conflict(product) do update set unit=excluded.unit,threshold_limit=excluded.threshold_limit`, [product, String(raw.Unit || ''), number(raw.Threshold_Limit)]);
  }
  for (const { raw } of sheet('Products')) {
    const name = String(raw.Name || '').trim();
    if (!name) continue;
    await client.query(`insert into product_catalog(category,name,price,active) values($1,$2,$3,$4)
      on conflict(name) do update set category=excluded.category,price=excluded.price,active=excluded.active`, [String(raw.Category || ''), name, number(raw.Price), enabled(raw.Active)]);
  }
  for (const { raw } of sheet('Users')) {
    const username = String(raw.Username || '').trim();
    if (!username) continue;
    await client.query(`insert into users(username,password_hash,salt,role,active) values($1,$2,$3,$4,$5)
      on conflict ((lower(trim(username)))) do update set password_hash=excluded.password_hash,salt=excluded.salt,role=excluded.role,active=excluded.active`,
    [username, String(raw.Password_Hash || ''), String(raw.Salt || ''), String(raw.Role || 'staff'), enabled(raw.Active)]);
  }
  const historyJson = JSON.stringify(sheet('Inventory_History').map(({ raw }) => raw));
  await client.query(`with source as (
      select distinct on (trim("Product")) trim("Product") product, coalesce("Unit",'') unit,
        coalesce(nullif(replace("Threshold_Limit",',',''),''),'0')::numeric threshold
      from jsonb_to_recordset($1::jsonb) as x("Product" text,"Unit" text,"Threshold_Limit" text)
      where trim(coalesce("Product",'')) <> '' order by trim("Product")
    ) insert into inventory_items(product,unit,threshold_limit)
      select product,unit,threshold from source on conflict(product) do nothing`, [historyJson]);
  await client.query(`with source as (
      select left("Date",10)::date business_date,
        bool_or(upper(trim(coalesce("Is_Closed",''))) in ('Y','YES','TRUE','1')) is_closed
      from jsonb_to_recordset($1::jsonb) as x("Date" text,"Is_Closed" text)
      where left(coalesce("Date",''),10) ~ '^\\d{4}-\\d{2}-\\d{2}$' group by 1
    ) insert into inventory_days(business_date,is_closed) select business_date,is_closed from source
      on conflict(business_date) do update set is_closed=inventory_days.is_closed or excluded.is_closed`, [historyJson]);
  await client.query(`with source as (
      select left("Date",10)::date business_date,trim("Product") product,
        coalesce(nullif(replace("Current_Qty",',',''),''),'0')::numeric current_qty,
        coalesce(nullif(replace("In_Stock",',',''),''),'0')::numeric in_stock,
        coalesce(nullif(replace("Out_Stock",',',''),''),'0')::numeric out_stock,
        coalesce(nullif(replace("Closing_Qty",',',''),''),'0')::numeric closing_qty,
        coalesce("Unit",'') unit_snapshot,
        coalesce(nullif(replace("Threshold_Limit",',',''),''),'0')::numeric threshold_snapshot
      from jsonb_to_recordset($1::jsonb) as x("Date" text,"Product" text,"Current_Qty" text,"In_Stock" text,"Out_Stock" text,"Closing_Qty" text,"Unit" text,"Threshold_Limit" text)
      where trim(coalesce("Product",'')) <> '' and left(coalesce("Date",''),10) ~ '^\\d{4}-\\d{2}-\\d{2}$'
    ) insert into inventory_day_items(inventory_day_id,inventory_item_id,current_qty,in_stock,out_stock,closing_qty,unit_snapshot,threshold_snapshot)
      select d.id,i.id,s.current_qty,s.in_stock,s.out_stock,s.closing_qty,s.unit_snapshot,s.threshold_snapshot
      from source s join inventory_days d on d.business_date=s.business_date join inventory_items i on i.product=s.product
      on conflict(inventory_day_id,inventory_item_id) do update set current_qty=excluded.current_qty,in_stock=excluded.in_stock,
      out_stock=excluded.out_stock,closing_qty=excluded.closing_qty,unit_snapshot=excluded.unit_snapshot,threshold_snapshot=excluded.threshold_snapshot`, [historyJson]);
  for (const { raw } of sheet('Sales_Finance')) {
    const businessDate = day(raw.Date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) continue;
    await client.query(`insert into sales_ledgers(business_date,raw_row,takoyaki_sales,expenses_total,total_cash_calculated,previous_cash_added,final_total_cash,remaining_balance)
      values($1,$2,$3,$4,$5,$6,$7,$8) on conflict(business_date) do update set raw_row=excluded.raw_row,takoyaki_sales=excluded.takoyaki_sales,
      expenses_total=excluded.expenses_total,total_cash_calculated=excluded.total_cash_calculated,previous_cash_added=excluded.previous_cash_added,final_total_cash=excluded.final_total_cash,remaining_balance=excluded.remaining_balance`,
    [businessDate, JSON.stringify(raw), number(raw.Takoyaki_Sales), number(raw.Expenses_Total), number(raw.Total_Cash_Calculated), number(raw.Previous_Cash_Added), number(raw.Final_Total_Cash), number(raw.Remaining_Balance)]);
  }
  for (const { raw } of sheet('Needs_Replenish')) {
    const product = String(raw.Product || '').trim(); const businessDate = day(raw.Date);
    if (!product || !/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) continue;
    await client.query(`insert into replenishment_needs(business_date,product,inventory_item_id,current_closing_qty,status)
      values($1,$2,(select id from inventory_items where product=$2),$3,$4)
      on conflict(business_date,product,status) do update set inventory_item_id=excluded.inventory_item_id,current_closing_qty=excluded.current_closing_qty`,
    [businessDate, product, number(raw.Current_Closing_Qty), String(raw.Status || '')]);
  }
  for (const { raw } of sheet('Config')) {
    const key = String(raw.Key || '').trim(); if (!key) continue;
    await client.query(`insert into app_config(key,value) values($1,$2) on conflict(key) do update set value=excluded.value`, [key, JSON.stringify(raw.Value)]);
  }
  for (const { raw } of sheet('Attendance')) {
    const staff = String(raw.Staff || '').trim(); const businessDate = day(raw.Date);
    if (!staff || !/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) continue;
    const member = await client.query(`insert into staff_members(display_name) values($1) on conflict(display_name) do update set display_name=excluded.display_name returning id`, [staff]);
    await client.query(`insert into attendance(business_date,staff_id,on_duty) values($1,$2,$3)
      on conflict(business_date,staff_id) do update set on_duty=excluded.on_duty`, [businessDate, member.rows[0].id, enabled(raw.On_Duty)]);
  }
}
try {
  await client.query('begin');
  await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [`xlsx:${profile.workbookHash}`]);
  const run = await client.query("insert into migration_runs(workbook_hash,source_file,status) values($1,$2,'running') returning id", [profile.workbookHash, profile.sourceFile]);
  await loadNormalized();
  await client.query(`insert into migration_records(run_id,workbook_hash,sheet_name,source_row,logical_key,fingerprint,raw_row,disposition,reason)
    select $1,$2,x.sheet_name,x.source_row,x.logical_key,x.fingerprint,x.raw_row,x.disposition,x.reason
    from jsonb_to_recordset($3::jsonb) as x(sheet_name text,source_row integer,logical_key text,fingerprint text,raw_row jsonb,disposition text,reason text)
    on conflict(workbook_hash,sheet_name,source_row) do update set logical_key=excluded.logical_key,fingerprint=excluded.fingerprint,
    raw_row=excluded.raw_row,disposition=excluded.disposition,reason=excluded.reason`, [run.rows[0].id, profile.workbookHash,
    JSON.stringify(profile.records.map((row) => ({ sheet_name: row.sheetName, source_row: row.sourceRow, logical_key: row.logicalKey, fingerprint: row.fingerprint, raw_row: row.raw, disposition: row.disposition, reason: row.reason })))]);
  await client.query("update migration_runs set status='completed',completed_at=now(),report=$2 where id=$1", [run.rows[0].id, JSON.stringify({ rowCount: profile.rowCount, dispositions: profile.dispositions })]);
  await client.query('commit');
  console.log(JSON.stringify({ runId: String(run.rows[0].id), workbookHash: profile.workbookHash, rowCount: profile.rowCount, dispositions: profile.dispositions }, null, 2));
} catch (error) { await client.query('rollback').catch(() => {}); throw error; }
finally { await client.end(); }
