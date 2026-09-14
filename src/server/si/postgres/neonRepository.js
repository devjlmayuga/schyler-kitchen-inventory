import { dbClient } from './client.js';

const HEADERS = {
  Inventory: ['Product', 'Current_Qty', 'In_Stock', 'Out_Stock', 'Closing_Qty', 'Unit', 'Threshold_Limit'],
  Inventory_History: ['Date', 'Product', 'Current_Qty', 'In_Stock', 'Out_Stock', 'Closing_Qty', 'Unit', 'Threshold_Limit', 'Is_Closed'],
  Sales_Finance: ['Date', 'Takoyaki_Sales', 'Expenses_Total', 'Total_Cash_Calculated', 'Previous_Cash_Added', 'Final_Total_Cash', 'Remaining_Balance'],
  Needs_Replenish: ['Date', 'Product', 'Current_Closing_Qty', 'Status'],
  Config: ['Key', 'Value'],
  Users: ['Username', 'Password_Hash', 'Salt', 'Role', 'Active'],
  Products: ['Category', 'Name', 'Price', 'Active'],
  Attendance: ['Date', 'Staff', 'On_Duty'],
};

const json = (rows) => JSON.stringify(rows || []);

export async function ensureSheet() {}
export async function ensureHeaders(name) { return HEADERS[name] || []; }
export async function getHeaders(name) { return HEADERS[name] || []; }
export async function getSheetTitles() { return Object.keys(HEADERS); }
export function getAuthDebugInfo() { return { storageBackend: 'postgres', authMode: 'database', schema: 'schyler_kitchen' }; }

export async function readSheetAsObjects(name, filter = {}) {
  let result;
  switch (name) {
    case 'Inventory':
      result = await dbClient().query(`select product "Product",0 "Current_Qty",0 "In_Stock",0 "Out_Stock",0 "Closing_Qty",unit "Unit",threshold_limit "Threshold_Limit" from schyler_kitchen.inventory_items order by id`);
      break;
    case 'Inventory_History':
      result = await dbClient().query(`select d.business_date::text "Date",i.product "Product",x.current_qty "Current_Qty",x.in_stock "In_Stock",x.out_stock "Out_Stock",x.closing_qty "Closing_Qty",x.unit_snapshot "Unit",x.threshold_snapshot "Threshold_Limit",case when d.is_closed then 'Y' else '' end "Is_Closed" from schyler_kitchen.inventory_day_items x join schyler_kitchen.inventory_days d on d.id=x.inventory_day_id join schyler_kitchen.inventory_items i on i.id=x.inventory_item_id where ($1::date is null or d.business_date=$1::date) order by d.business_date,x.inventory_item_id`, [filter.date || null]);
      break;
    case 'Sales_Finance':
      result = await dbClient().query(`select raw_row from schyler_kitchen.sales_ledgers where ($1::date is null or business_date >= $1::date) and ($2::date is null or business_date <= $2::date) order by business_date`, [filter.from || filter.date || null, filter.to || filter.date || null]);
      result.rows = result.rows.map((row) => row.raw_row);
      break;
    case 'Needs_Replenish':
      result = await dbClient().query(`select business_date::text "Date",product "Product",current_closing_qty "Current_Closing_Qty",status "Status" from schyler_kitchen.replenishment_needs where ($1::date is null or business_date=$1::date) order by business_date,id`, [filter.date || null]);
      break;
    case 'Config':
      result = await dbClient().query(`select key "Key",case when jsonb_typeof(value)='string' then value#>>'{}' else value::text end "Value" from schyler_kitchen.app_config order by key`);
      break;
    case 'Users':
      result = await dbClient().query(`select username "Username",password_hash "Password_Hash",salt "Salt",role "Role",case when active then 'Y' else 'N' end "Active" from schyler_kitchen.users order by id`);
      break;
    case 'Products':
      result = await dbClient().query(`select category "Category",name "Name",price "Price",case when active then 'Y' else 'N' end "Active" from schyler_kitchen.product_catalog order by id`);
      break;
    case 'Attendance':
      result = await dbClient().query(`select a.business_date::text "Date",s.display_name "Staff",case when a.on_duty then 'Y' else 'N' end "On_Duty" from schyler_kitchen.attendance a join schyler_kitchen.staff_members s on s.id=a.staff_id where ($1::date is null or a.business_date >= $1::date) and ($2::date is null or a.business_date <= $2::date) order by a.business_date,s.id`, [filter.from || null, filter.to || null]);
      break;
    default:
      throw new Error(`Unknown PostgreSQL entity: ${name}`);
  }
  return { headers: HEADERS[name] || [], values: result.rows };
}

export async function replaceAttendanceWeek(weekStart, weekEnd, rows) {
  const payload = json(rows);
  await dbClient().query(`with source as (
    select left("Date",10)::date business_date,trim("Staff") staff,upper(trim(coalesce("On_Duty",''))) in ('Y','YES','TRUE','1') duty
    from jsonb_to_recordset($3::jsonb) x("Date" text,"Staff" text,"On_Duty" text)
    where trim(coalesce("Staff",''))<>'' and left("Date",10)::date between $1::date and $2::date
  ), deleted as (
    delete from schyler_kitchen.attendance where business_date between $1::date and $2::date
  ), members as (
    insert into schyler_kitchen.staff_members(display_name)
    select distinct staff from source on conflict(display_name) do update set display_name=excluded.display_name
    returning id,display_name
  )
  insert into schyler_kitchen.attendance(business_date,staff_id,on_duty)
  select s.business_date,m.id,s.duty from source s join members m on m.display_name=s.staff
  on conflict(business_date,staff_id) do update set on_duty=excluded.on_duty`, [weekStart, weekEnd, payload]);
}

export async function replaceInventoryDay(date, rows) {
  const payload = json(rows);
  await dbClient().query(`with day_row as (
    insert into schyler_kitchen.inventory_days(business_date,is_closed)
    values($1::date,coalesce((select bool_or(upper(trim(coalesce("Is_Closed",''))) in ('Y','YES','TRUE','1')) from jsonb_to_recordset($2::jsonb) x("Is_Closed" text)),false))
    on conflict(business_date) do update set is_closed=excluded.is_closed returning id
  ), source as (
    select trim("Product") product,coalesce(nullif(replace("Current_Qty",',',''),''),'0')::numeric current_qty,
      coalesce(nullif(replace("In_Stock",',',''),''),'0')::numeric in_stock,coalesce(nullif(replace("Out_Stock",',',''),''),'0')::numeric out_stock,
      coalesce(nullif(replace("Closing_Qty",',',''),''),'0')::numeric closing_qty,coalesce("Unit",'') unit,
      coalesce(nullif(replace("Threshold_Limit",',',''),''),'0')::numeric threshold
    from jsonb_to_recordset($2::jsonb) x("Product" text,"Current_Qty" text,"In_Stock" text,"Out_Stock" text,"Closing_Qty" text,"Unit" text,"Threshold_Limit" text)
    where trim(coalesce("Product",''))<>''
  )
  insert into schyler_kitchen.inventory_day_items(inventory_day_id,inventory_item_id,current_qty,in_stock,out_stock,closing_qty,unit_snapshot,threshold_snapshot)
  select d.id,i.id,s.current_qty,s.in_stock,s.out_stock,s.closing_qty,s.unit,s.threshold
  from source s cross join day_row d join schyler_kitchen.inventory_items i on i.product=s.product
  on conflict(inventory_day_id,inventory_item_id) do update set current_qty=excluded.current_qty,in_stock=excluded.in_stock,out_stock=excluded.out_stock,closing_qty=excluded.closing_qty,unit_snapshot=excluded.unit_snapshot,threshold_snapshot=excluded.threshold_snapshot`, [date, payload]);
  await dbClient().query(`delete from schyler_kitchen.inventory_day_items x using schyler_kitchen.inventory_days d
    where x.inventory_day_id=d.id and d.business_date=$1::date
      and not exists(select 1 from jsonb_to_recordset($2::jsonb) s("Product" text) join schyler_kitchen.inventory_items i on i.product=trim(s."Product") where i.id=x.inventory_item_id)`, [date, payload]);
}

export async function deleteInventoryDay(date) {
  const result = await dbClient().query(`with target as (
    select id from schyler_kitchen.inventory_days where business_date=$1::date
  ), counted as (
    select count(*)::int count from schyler_kitchen.inventory_day_items where inventory_day_id=(select id from target)
  ), deleted as (
    delete from schyler_kitchen.inventory_days where id=(select id from target)
  ) select count from counted`, [date]);
  return result.rows[0]?.count || 0;
}

export async function getInventoryDayOrSeed(date) {
  const result = await dbClient().query(`with requested_day as (
    select d.id,d.is_closed from schyler_kitchen.inventory_days d
    where d.business_date=$1::date
      and exists(select 1 from schyler_kitchen.inventory_day_items x where x.inventory_day_id=d.id)
  ), seed_day as (
    select d.id,d.business_date from schyler_kitchen.inventory_days d
    where d.business_date < $1::date
      and exists(select 1 from schyler_kitchen.inventory_day_items x where x.inventory_day_id=d.id)
    order by d.is_closed asc,d.business_date desc limit 1
  )
  select i.product "Product",
    coalesce(x.current_qty,p.closing_qty,0) "Current_Qty",
    coalesce(x.in_stock,0) "In_Stock",
    coalesce(x.out_stock,0) "Out_Stock",
    coalesce(x.closing_qty,p.closing_qty,0) "Closing_Qty",
    coalesce(x.unit_snapshot,i.unit) "Unit",
    coalesce(x.threshold_snapshot,i.threshold_limit) "Threshold_Limit",
    case when coalesce(r.is_closed,false) then 'Y' else '' end "Is_Closed",
    (r.id is null) seeded,
    s.business_date::text seeded_from,
    coalesce(r.is_closed,false) closed
  from schyler_kitchen.inventory_items i
  left join requested_day r on true
  left join schyler_kitchen.inventory_day_items x on x.inventory_day_id=r.id and x.inventory_item_id=i.id
  left join seed_day s on r.id is null
  left join schyler_kitchen.inventory_day_items p on p.inventory_day_id=s.id and p.inventory_item_id=i.id
  where r.id is null or x.inventory_item_id is not null
  order by i.id`, [date]);
  const first = result.rows[0];
  return {
    date,
    seeded: first?.seeded ?? true,
    seededFrom: first?.seeded_from || null,
    closed: first?.closed ?? false,
    items: result.rows.map(({ seeded, seeded_from, closed, ...row }) => row),
  };
}

export async function getInventorySeedTemplate(date) {
  const result = await dbClient().query(`with seed_day as (
    select d.id,d.business_date from schyler_kitchen.inventory_days d
    where d.business_date < $1::date
      and exists(select 1 from schyler_kitchen.inventory_day_items x where x.inventory_day_id=d.id)
    order by d.is_closed asc,d.business_date desc limit 1
  )
  select i.product "Product",coalesce(p.closing_qty,0) "Current_Qty",0 "In_Stock",0 "Out_Stock",
    coalesce(p.closing_qty,0) "Closing_Qty",i.unit "Unit",i.threshold_limit "Threshold_Limit",'' "Is_Closed",
    s.business_date::text seeded_from
  from schyler_kitchen.inventory_items i left join seed_day s on true
  left join schyler_kitchen.inventory_day_items p on p.inventory_day_id=s.id and p.inventory_item_id=i.id
  order by i.id`, [date]);
  return { date, seededFrom: result.rows[0]?.seeded_from || null, items: result.rows.map(({ seeded_from, ...row }) => row) };
}

export async function findUser(username) {
  const result = await dbClient().query(`select username "Username",password_hash "Password_Hash",salt "Salt",role "Role",case when active then 'Y' else 'N' end "Active" from schyler_kitchen.users where lower(trim(username))=lower(trim($1)) limit 1`, [username]);
  return result.rows[0] || null;
}

export async function upsertUser(row) {
  const result = await dbClient().query(`insert into schyler_kitchen.users(username,password_hash,salt,role,active)
    values($1,$2,$3,$4,upper(trim($5)) in ('Y','YES','TRUE','1'))
    on conflict ((lower(trim(username)))) do update set password_hash=excluded.password_hash,salt=excluded.salt,role=excluded.role,active=excluded.active
    returning (xmax <> 0) updated`, [row.Username, row.Password_Hash, row.Salt, row.Role, row.Active]);
  return Boolean(result.rows[0]?.updated);
}

export async function upsertInventoryItems(rows) {
  const result = await dbClient().query(`with source as materialized (
    select trim("Product") product,coalesce("Unit",'') unit,coalesce(nullif(replace("Threshold_Limit",',',''),''),'0')::numeric threshold
    from jsonb_to_recordset($1::jsonb) x("Product" text,"Unit" text,"Threshold_Limit" text) where trim(coalesce("Product",''))<>''
  ), existing as materialized (select s.product from source s join schyler_kitchen.inventory_items i on i.product=s.product),
  saved as (insert into schyler_kitchen.inventory_items(product,unit,threshold_limit) select product,unit,threshold from source
    on conflict(product) do update set unit=excluded.unit,threshold_limit=excluded.threshold_limit returning product)
  select (select count(*)::int from existing) updated,(select count(*)::int from source)-(select count(*)::int from existing) inserted`, [json(rows)]);
  return result.rows[0] || { updated: 0, inserted: 0 };
}

export async function deleteInventoryItem(product) {
  const result = await dbClient().query(`with target as materialized (select id from schyler_kitchen.inventory_items where product=$1),
    history_count as (select count(*)::int count from schyler_kitchen.inventory_day_items where inventory_item_id=(select id from target)),
    needs_count as (select count(*)::int count from schyler_kitchen.replenishment_needs where product=$1),
    history_deleted as (delete from schyler_kitchen.inventory_day_items where inventory_item_id=(select id from target)),
    needs_deleted as (delete from schyler_kitchen.replenishment_needs where product=$1),
    item_deleted as (delete from schyler_kitchen.inventory_items where id=(select id from target) returning id)
  select (select count(*)::int from item_deleted) inventory,(select count from history_count) "inventoryHistory",(select count from needs_count) needs`, [product]);
  return result.rows[0] || { inventory: 0, inventoryHistory: 0, needs: 0 };
}

export async function updateInventoryThreshold(product, threshold) {
  const result = await dbClient().query('update schyler_kitchen.inventory_items set threshold_limit=$2 where product=$1 returning id', [product, threshold]);
  return result.rowCount;
}

export async function upsertManualNeed(date, item) {
  await dbClient().query(`insert into schyler_kitchen.replenishment_needs(business_date,product,inventory_item_id,current_closing_qty,status)
    values($1::date,$2,(select id from schyler_kitchen.inventory_items where product=$2),$3,'NEEDS_MANUAL')
    on conflict(business_date,product,status) do update set inventory_item_id=excluded.inventory_item_id,current_closing_qty=excluded.current_closing_qty`,
  [date, item.Product, item.Current_Closing_Qty]);
}

export async function deleteManualNeed(date, product) {
  const result = await dbClient().query(`delete from schyler_kitchen.replenishment_needs where business_date=$1::date and product=$2 and status='NEEDS_MANUAL'`, [date, product]);
  return result.rowCount;
}

export async function saveConfig(key, value) {
  await dbClient().query(`insert into schyler_kitchen.app_config(key,value) values($1,$2::jsonb) on conflict(key) do update set value=excluded.value`, [key, JSON.stringify(value)]);
}

export async function upsertProducts(rows) {
  const result = await dbClient().query(`with source as materialized (
    select coalesce("Category",'') category,trim("Name") name,coalesce(nullif(replace("Price",',',''),''),'0')::numeric price,
      upper(trim(coalesce("Active",'Y'))) in ('Y','YES','TRUE','1') active
    from jsonb_to_recordset($1::jsonb) x("Category" text,"Name" text,"Price" text,"Active" text) where trim(coalesce("Name",''))<>''
  ), existing as materialized (select s.name from source s join schyler_kitchen.product_catalog p on p.name=s.name),
  saved as (insert into schyler_kitchen.product_catalog(category,name,price,active) select category,name,price,active from source
    on conflict(name) do update set category=excluded.category,price=excluded.price,active=excluded.active returning name)
  select (select count(*)::int from existing) upserts,(select count(*)::int from source)-(select count(*)::int from existing) appends`, [json(rows)]);
  return result.rows[0] || { upserts: 0, appends: 0 };
}

export async function deleteProduct(name) {
  const result = await dbClient().query('delete from schyler_kitchen.product_catalog where name=$1', [name]);
  return result.rowCount;
}

export async function getSalesBootstrapData(date) {
  const result = await dbClient().query(`select
    (select value from schyler_kitchen.app_config where key='sales_config') config,
    coalesce((select jsonb_agg(jsonb_build_object('Category',category,'Name',name,'Price',price,'Active',case when active then 'Y' else 'N' end) order by id) from schyler_kitchen.product_catalog),'[]'::jsonb) products,
    (select raw_row from schyler_kitchen.sales_ledgers where business_date=$1::date) row`, [date]);
  const data = result.rows[0] || {};
  let config = data.config;
  if (typeof config === 'string') {
    try { config = JSON.parse(config); } catch { config = null; }
  }
  return { config, products: data.products || [], row: data.row || null };
}

export async function getAutoAttendanceWeek(weekStart, weekEnd) {
  const result = await dbClient().query(`select
    (select value from schyler_kitchen.app_config where key='sales_config') config,
    coalesce((select jsonb_agg(business_date::text order by business_date) from schyler_kitchen.sales_ledgers where business_date between $1::date and $2::date),'[]'::jsonb) open_dates`, [weekStart, weekEnd]);
  const data = result.rows[0] || {};
  let config = data.config;
  if (typeof config === 'string') {
    try { config = JSON.parse(config); } catch { config = null; }
  }
  return { config, openDates: data.open_dates || [] };
}

export async function upsertSalesDay(date, row) {
  await dbClient().query(`insert into schyler_kitchen.sales_ledgers(business_date,raw_row,takoyaki_sales,expenses_total,total_cash_calculated,previous_cash_added,final_total_cash,remaining_balance)
    values($1::date,$2::jsonb,$3,$4,$5,$6,$7,$8)
    on conflict(business_date) do update set raw_row=excluded.raw_row,takoyaki_sales=excluded.takoyaki_sales,expenses_total=excluded.expenses_total,total_cash_calculated=excluded.total_cash_calculated,previous_cash_added=excluded.previous_cash_added,final_total_cash=excluded.final_total_cash,remaining_balance=excluded.remaining_balance`,
  [date, JSON.stringify(row), row.Takoyaki_Sales, row.Expenses_Total, row.Total_Cash_Calculated, row.Previous_Cash_Added, row.Final_Total_Cash, row.Remaining_Balance]);
}

export async function deleteSalesDay(date) {
  const result = await dbClient().query('delete from schyler_kitchen.sales_ledgers where business_date=$1::date returning id', [date]);
  return result.rowCount;
}

export async function overwriteSheetFromObjects(name, headers, rows) {
  const payload = json(rows);
  await dbClient().query('select pg_advisory_xact_lock(hashtextextended($1,0))', [`entity:${name}`]);
  switch (name) {
    case 'Inventory':
      await dbClient().query(`with source as (select trim("Product") product,coalesce("Unit",'') unit,coalesce(nullif(replace("Threshold_Limit",',',''),''),'0')::numeric threshold from jsonb_to_recordset($1::jsonb) as x("Product" text,"Unit" text,"Threshold_Limit" text) where trim(coalesce("Product",''))<>''), removed as (delete from schyler_kitchen.inventory_day_items where inventory_item_id in (select id from schyler_kitchen.inventory_items where product not in (select product from source))), cleared as (update schyler_kitchen.replenishment_needs set inventory_item_id=null where inventory_item_id in (select id from schyler_kitchen.inventory_items where product not in (select product from source))), deleted as (delete from schyler_kitchen.inventory_items where product not in (select product from source)) insert into schyler_kitchen.inventory_items(product,unit,threshold_limit) select product,unit,threshold from source on conflict(product) do update set unit=excluded.unit,threshold_limit=excluded.threshold_limit`, [payload]);
      break;
    case 'Inventory_History':
      await dbClient().query('delete from schyler_kitchen.inventory_day_items');
      await dbClient().query('delete from schyler_kitchen.inventory_days');
      await dbClient().query(`with source as (select left("Date",10)::date business_date,bool_or(upper(trim(coalesce("Is_Closed",''))) in ('Y','YES','TRUE','1')) closed from jsonb_to_recordset($1::jsonb) as x("Date" text,"Is_Closed" text) where left(coalesce("Date",''),10) ~ '^\\d{4}-\\d{2}-\\d{2}$' group by 1) insert into schyler_kitchen.inventory_days(business_date,is_closed) select business_date,closed from source`, [payload]);
      await dbClient().query(`with source as (select left("Date",10)::date business_date,trim("Product") product,coalesce(nullif(replace("Current_Qty",',',''),''),'0')::numeric current_qty,coalesce(nullif(replace("In_Stock",',',''),''),'0')::numeric in_stock,coalesce(nullif(replace("Out_Stock",',',''),''),'0')::numeric out_stock,coalesce(nullif(replace("Closing_Qty",',',''),''),'0')::numeric closing_qty,coalesce("Unit",'') unit,coalesce(nullif(replace("Threshold_Limit",',',''),''),'0')::numeric threshold from jsonb_to_recordset($1::jsonb) as x("Date" text,"Product" text,"Current_Qty" text,"In_Stock" text,"Out_Stock" text,"Closing_Qty" text,"Unit" text,"Threshold_Limit" text) where trim(coalesce("Product",''))<>'' and left(coalesce("Date",''),10) ~ '^\\d{4}-\\d{2}-\\d{2}$') insert into schyler_kitchen.inventory_day_items(inventory_day_id,inventory_item_id,current_qty,in_stock,out_stock,closing_qty,unit_snapshot,threshold_snapshot) select d.id,i.id,s.current_qty,s.in_stock,s.out_stock,s.closing_qty,s.unit,s.threshold from source s join schyler_kitchen.inventory_days d on d.business_date=s.business_date join schyler_kitchen.inventory_items i on i.product=s.product`, [payload]);
      break;
    case 'Sales_Finance':
      await dbClient().query('delete from schyler_kitchen.sales_ledgers');
      await dbClient().query(`insert into schyler_kitchen.sales_ledgers(business_date,raw_row,takoyaki_sales,expenses_total,total_cash_calculated,previous_cash_added,final_total_cash,remaining_balance) select left(x->>'Date',10)::date,x,coalesce(nullif(replace(x->>'Takoyaki_Sales',',',''),''),'0')::numeric,coalesce(nullif(replace(x->>'Expenses_Total',',',''),''),'0')::numeric,coalesce(nullif(replace(x->>'Total_Cash_Calculated',',',''),''),'0')::numeric,coalesce(nullif(replace(x->>'Previous_Cash_Added',',',''),''),'0')::numeric,coalesce(nullif(replace(x->>'Final_Total_Cash',',',''),''),'0')::numeric,coalesce(nullif(replace(x->>'Remaining_Balance',',',''),''),'0')::numeric from jsonb_array_elements($1::jsonb) x where left(coalesce(x->>'Date',''),10) ~ '^\\d{4}-\\d{2}-\\d{2}$'`, [payload]);
      break;
    case 'Needs_Replenish':
      await dbClient().query('delete from schyler_kitchen.replenishment_needs');
      await dbClient().query(`insert into schyler_kitchen.replenishment_needs(business_date,product,inventory_item_id,current_closing_qty,status) select left("Date",10)::date,trim("Product"),i.id,coalesce(nullif(replace("Current_Closing_Qty",',',''),''),'0')::numeric,coalesce("Status",'') from jsonb_to_recordset($1::jsonb) x("Date" text,"Product" text,"Current_Closing_Qty" text,"Status" text) left join schyler_kitchen.inventory_items i on i.product=trim("Product") where trim(coalesce("Product",''))<>''`, [payload]);
      break;
    case 'Config':
      await dbClient().query('delete from schyler_kitchen.app_config');
      await dbClient().query(`insert into schyler_kitchen.app_config(key,value) select trim("Key"),to_jsonb(coalesce("Value",'')) from jsonb_to_recordset($1::jsonb) x("Key" text,"Value" text) where trim(coalesce("Key",''))<>''`, [payload]);
      break;
    case 'Users':
      await dbClient().query(`insert into schyler_kitchen.users(username,password_hash,salt,role,active) select trim("Username"),coalesce("Password_Hash",''),coalesce("Salt",''),coalesce(nullif("Role",''),'staff'),upper(trim(coalesce("Active",'Y'))) in ('Y','YES','TRUE','1') from jsonb_to_recordset($1::jsonb) x("Username" text,"Password_Hash" text,"Salt" text,"Role" text,"Active" text) where trim(coalesce("Username",''))<>'' on conflict ((lower(trim(username)))) do update set password_hash=excluded.password_hash,salt=excluded.salt,role=excluded.role,active=excluded.active`, [payload]);
      break;
    case 'Products':
      await dbClient().query('delete from schyler_kitchen.product_catalog');
      await dbClient().query(`insert into schyler_kitchen.product_catalog(category,name,price,active) select coalesce("Category",''),trim("Name"),coalesce(nullif(replace("Price",',',''),''),'0')::numeric,upper(trim(coalesce("Active",'Y'))) in ('Y','YES','TRUE','1') from jsonb_to_recordset($1::jsonb) x("Category" text,"Name" text,"Price" text,"Active" text) where trim(coalesce("Name",''))<>''`, [payload]);
      break;
    case 'Attendance':
      await dbClient().query('delete from schyler_kitchen.attendance');
      await dbClient().query(`with source as (select left("Date",10)::date business_date,trim("Staff") staff,upper(trim(coalesce("On_Duty",''))) in ('Y','YES','TRUE','1') duty from jsonb_to_recordset($1::jsonb) x("Date" text,"Staff" text,"On_Duty" text) where trim(coalesce("Staff",''))<>''), members as (insert into schyler_kitchen.staff_members(display_name) select distinct staff from source on conflict(display_name) do update set display_name=excluded.display_name returning id,display_name) insert into schyler_kitchen.attendance(business_date,staff_id,on_duty) select s.business_date,m.id,s.duty from source s join members m on m.display_name=s.staff`, [payload]);
      break;
    default:
      throw new Error(`Unknown PostgreSQL entity: ${name}`);
  }
}

export async function appendRows(name, headers, rows) {
  const current = await readSheetAsObjects(name);
  await overwriteSheetFromObjects(name, headers || current.headers, current.values.concat(rows || []));
}
