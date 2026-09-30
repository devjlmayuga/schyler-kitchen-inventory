import { dbClient } from './client.js';

export async function lockSalesDay(date) {
  await dbClient().query('select pg_advisory_xact_lock(hashtextextended($1,0))', [`sales-day:${date}`]);
}

export async function lockOrder(id) {
  await dbClient().query('select pg_advisory_xact_lock(hashtextextended($1,0))', [`pos-order:${id}`]);
}

export const mapOrder = (row) =>
  row
    ? {
        ...row.details,
        id: row.id,
        number: String(row.order_number),
        date: row.business_date,
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
        cashier: row.created_by,
        revision: Number(row.revision),
        updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
        updatedBy: row.updated_by,
        deletedAt: row.deleted_at instanceof Date ? row.deleted_at.toISOString() : row.deleted_at,
        deletedBy: row.deleted_by,
        deletionReason: row.deletion_reason,
      }
    : null;

export async function findOrder(id) {
  const result = await dbClient().query(
    'select *, business_date::text from schyler_kitchen.pos_orders where id=$1::uuid',
    [id],
  );
  return result.rows[0] || null;
}

export async function insertOrder({ id, date, fingerprint, details, cashier }) {
  const result = await dbClient().query(
    `insert into schyler_kitchen.pos_orders(id,business_date,request_hash,details,total,created_by)
    values($1::uuid,$2::date,$3,$4::jsonb,$5,$6) returning *,business_date::text`,
    [id, date, fingerprint, JSON.stringify(details), details.total, cashier],
  );
  return mapOrder(result.rows[0]);
}

export async function listOrders(date, before = null) {
  const result = await dbClient().query(
    `select *,business_date::text from schyler_kitchen.pos_orders
    where business_date=$1::date and deleted_at is null and ($2::bigint is null or order_number < $2::bigint)
    order by order_number desc limit 31`,
    [date, before],
  );
  const summary = await orderSummary(date);
  const orders = result.rows.slice(0, 30).map(mapOrder);
  return {
    orders,
    nextCursor: result.rows.length > 30 ? orders.at(-1).number : null,
    summary,
  };
}

export async function orderSummary(date) {
  const result = await dbClient().query(
    `select count(*)::int count,coalesce(sum(total),0)::float8 total
    from schyler_kitchen.pos_orders where business_date=$1::date and deleted_at is null`,
    [date],
  );
  return result.rows[0];
}

export async function hasPosOrders(date) {
  const result = await dbClient().query(
    'select 1 from schyler_kitchen.pos_orders where business_date=$1::date and deleted_at is null limit 1',
    [date],
  );
  return result.rowCount > 0;
}

export async function markOrderDeleted({ id, reason, cashier }) {
  const result = await dbClient().query(
    `update schyler_kitchen.pos_orders
    set deleted_at=now(),deleted_by=$2,deletion_reason=$3,revision=revision+1,updated_at=now(),updated_by=$2
    where id=$1::uuid returning *,business_date::text`,
    [id, cashier, reason],
  );
  return mapOrder(result.rows[0]);
}

export async function findOrderEdit(id) {
  const result = await dbClient().query('select * from schyler_kitchen.pos_order_edits where id=$1::uuid', [
    id,
  ]);
  return result.rows[0] || null;
}

export async function updateOrder({ request, fingerprint, details, previous, cashier }) {
  const result = await dbClient().query(
    `update schyler_kitchen.pos_orders set details=$2::jsonb,total=$3,
    revision=revision+1,updated_at=now(),updated_by=$4 where id=$1::uuid returning *,business_date::text`,
    [request.id, JSON.stringify(details), details.total, cashier],
  );
  const order = mapOrder(result.rows[0]);
  await dbClient().query(
    `insert into schyler_kitchen.pos_order_edits
    (id,order_id,request_hash,revision,before_details,after_details,reason,created_by)
    values($1::uuid,$2::uuid,$3,$4,$5::jsonb,$6::jsonb,$7,$8)`,
    [
      request.editId,
      request.id,
      fingerprint,
      order.revision,
      JSON.stringify(previous),
      JSON.stringify(details),
      request.reason,
      cashier,
    ],
  );
  return order;
}
