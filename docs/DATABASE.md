# StorePulse AI Database Notes

## Current Supabase Tables

The current MVP uses these public tables:

* stores
* upload_batches
* transactions
* products

## Important Schema Note

The current database does not appear to use `user_id` on every table.

From the Supabase error message, the `stores` table appears to use:

* `owner_id`

instead of:

* `user_id`

Because of this, backend integration code must use the actual column names from Supabase, not assumed column names.

## Known Foreign Keys

Current foreign key checks show:

* products.batch_id → upload_batches.id
* products.store_id → stores.id
* transactions.batch_id → upload_batches.id
* transactions.store_id → stores.id
* upload_batches.store_id → stores.id

## Current Backend Integration Plan

### Demo Mode

When the user is logged out:

CSV upload → parse CSV → save to localStorage → display local data

### Cloud Mode

When the user is logged in:

CSV upload → parse CSV → get authenticated user → get user's store → create upload batch → insert rows into Supabase → display cloud data

## Tables Needed for Transaction Upload

### stores

Used to find the current user's store.

Important likely fields:

* id
* owner_id
* store_name
* created_at

### upload_batches

Used to track each CSV upload.

Important likely fields:

* id
* store_id
* upload_type
* row_count
* status
* created_at

### transactions

Used to store uploaded transaction rows.

Important likely fields:

* id
* store_id
* batch_id
* transaction_date
* upc
* item_name
* quantity
* unit_price
* total_amount
* payment_method
* cashier_name
* raw_row
* created_at

### products

Used to store uploaded product / pricebook rows.

Important likely fields:

* id
* store_id
* batch_id
* upc
* item_name
* category
* cost
* price
* raw_row
* created_at

## Supabase Checks to Run

### Check columns

```sql
select table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
and table_name in ('stores', 'upload_batches', 'transactions', 'products')
order by table_name, ordinal_position;
```

### Check RLS status

```sql
select
  schemaname,
  tablename,
  rowsecurity
from pg_tables
where schemaname = 'public'
and tablename in ('stores', 'upload_batches', 'transactions', 'products')
order by tablename;
```

### Check policies

```sql
select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
and tablename in ('stores', 'upload_batches', 'transactions', 'products')
order by tablename, policyname;
```

### Check foreign keys

```sql
select
  tc.table_name,
  kcu.column_name,
  ccu.table_name as foreign_table_name,
  ccu.column_name as foreign_column_name
from information_schema.table_constraints as tc
join information_schema.key_column_usage as kcu
  on tc.constraint_name = kcu.constraint_name
join information_schema.constraint_column_usage as ccu
  on ccu.constraint_name = tc.constraint_name
where tc.constraint_type = 'FOREIGN KEY'
and tc.table_schema = 'public'
and tc.table_name in ('stores', 'upload_batches', 'transactions', 'products')
order by tc.table_name;
```

## Tomorrow Bolt Instruction

Bolt must inspect the real schema before coding.

Important:

* Do not assume every table has `user_id`
* `stores` appears to use `owner_id`
* `transactions` and `products` appear to use `batch_id`, not `upload_batch_id`
* Use the exact Supabase column names from this document
* Keep localStorage Demo Mode working
* Add Supabase Cloud Mode only after matching the real schema
