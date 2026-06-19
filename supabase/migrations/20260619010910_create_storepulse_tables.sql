/*
# StorePulse AI — core tables

1. New Tables
- `stores`
  - `id` (uuid, PK)
  - `owner_id` (uuid, owner = auth user, DEFAULT auth.uid())
  - `store_name` (text, not null)
  - `store_address` (text)
  - `pos_type` (text, e.g. "Verifone", "Clover", "Other")
  - `has_fuel` (boolean, default false)
  - `register_count` (integer, default 1)
  - `created_at` (timestamptz)
- `upload_batches`
  - `id` (uuid, PK)
  - `store_id` (uuid, FK -> stores ON DELETE CASCADE)
  - `owner_id` (uuid, DEFAULT auth.uid())
  - `upload_type` (text: 'transactions' | 'products')
  - `file_name` (text)
  - `row_count` (integer, default 0)
  - `valid_count` (integer, default 0)
  - `invalid_count` (integer, default 0)
  - `created_at` (timestamptz)
- `transactions`
  - `id` (uuid, PK, default gen_random_uuid())
  - `store_id` (uuid, FK -> stores ON DELETE CASCADE)
  - `owner_id` (uuid, DEFAULT auth.uid())
  - `txn_id` (text, source transaction_id from CSV)
  - `timestamp` (timestamptz, not null)
  - `item` (text)
  - `category` (text)
  - `cashier_id` (text)
  - `cashier_name` (text)
  - `register` (integer)
  - `payment_type` (text)
  - `amount` (numeric)
  - `txn_type` (text: 'Sale', 'Refund', 'Void', 'No-Sale')
  - `upc` (text)
  - `quantity` (numeric, default 1)
  - `unit_price` (numeric, default 0)
  - `discount_amount` (numeric, default 0)
  - `created_at` (timestamptz)
- `products`
  - `id` (uuid, PK, default gen_random_uuid())
  - `store_id` (uuid, FK -> stores ON DELETE CASCADE)
  - `owner_id` (uuid, DEFAULT auth.uid())
  - `upc` (text, not null)
  - `name` (text)
  - `category` (text)
  - `brand` (text, default 'Unknown')
  - `cost_price` (numeric, default 0)
  - `selling_price` (numeric, default 0)
  - `stock` (numeric, default 0)
  - `reorder_level` (numeric, default 10)
  - `vendor` (text)
  - `created_at` (timestamptz)
  - UNIQUE (store_id, upc)

2. Security (RLS)
- All four tables get RLS enabled.
- Owner-scoped CRUD on each table: authenticated users only access rows for stores they own.
  - `stores`: direct owner check (auth.uid() = owner_id).
  - Child tables (`upload_batches`, `transactions`, `products`): check EXISTS
    a matching `stores` row with the same store_id owned by the current user.
- `owner_id` columns DEFAULT auth.uid() so inserts that omit the owner
  still satisfy the WITH CHECK policy.
- 4 separate policies per table (SELECT/INSERT/UPDATE/DELETE), no FOR ALL.

3. Indexes
- `transactions` (store_id, timestamp DESC) for dashboard time queries.
- `transactions` (store_id, cashier_id) for cashier audit.
- `products` (store_id) and UNIQUE (store_id, upc) for upserts.
- `upload_batches` (store_id, created_at DESC) for history lists.
*/

CREATE TABLE IF NOT EXISTS stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  store_name text NOT NULL,
  store_address text,
  pos_type text,
  has_fuel boolean NOT NULL DEFAULT false,
  register_count integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS upload_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  upload_type text NOT NULL CHECK (upload_type IN ('transactions','products')),
  file_name text NOT NULL,
  row_count integer NOT NULL DEFAULT 0,
  valid_count integer NOT NULL DEFAULT 0,
  invalid_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  txn_id text NOT NULL,
  timestamp timestamptz NOT NULL DEFAULT now(),
  item text,
  category text,
  cashier_id text,
  cashier_name text,
  register integer NOT NULL DEFAULT 1,
  payment_type text,
  amount numeric NOT NULL DEFAULT 0,
  txn_type text NOT NULL DEFAULT 'Sale',
  upc text,
  quantity numeric NOT NULL DEFAULT 1,
  unit_price numeric NOT NULL DEFAULT 0,
  discount_amount numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  upc text NOT NULL,
  name text,
  category text,
  brand text NOT NULL DEFAULT 'Unknown',
  cost_price numeric NOT NULL DEFAULT 0,
  selling_price numeric NOT NULL DEFAULT 0,
  stock numeric NOT NULL DEFAULT 0,
  reorder_level numeric NOT NULL DEFAULT 10,
  vendor text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, upc)
);

ALTER TABLE stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE upload_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

-- stores: owner-scoped CRUD
DROP POLICY IF EXISTS "select_own_stores" ON stores;
CREATE POLICY "select_own_stores" ON stores FOR SELECT
  TO authenticated USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS "insert_own_stores" ON stores;
CREATE POLICY "insert_own_stores" ON stores FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "update_own_stores" ON stores;
CREATE POLICY "update_own_stores" ON stores FOR UPDATE
  TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "delete_own_stores" ON stores;
CREATE POLICY "delete_own_stores" ON stores FOR DELETE
  TO authenticated USING (auth.uid() = owner_id);

-- upload_batches: owner-scoped via parent store
DROP POLICY IF EXISTS "select_own_upload_batches" ON upload_batches;
CREATE POLICY "select_own_upload_batches" ON upload_batches FOR SELECT
  TO authenticated USING (EXISTS (SELECT 1 FROM stores WHERE stores.id = upload_batches.store_id AND stores.owner_id = auth.uid()));

DROP POLICY IF EXISTS "insert_own_upload_batches" ON upload_batches;
CREATE POLICY "insert_own_upload_batches" ON upload_batches FOR INSERT
  TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM stores WHERE stores.id = upload_batches.store_id AND stores.owner_id = auth.uid()));

DROP POLICY IF EXISTS "update_own_upload_batches" ON upload_batches;
CREATE POLICY "update_own_upload_batches" ON upload_batches FOR UPDATE
  TO authenticated USING (EXISTS (SELECT 1 FROM stores WHERE stores.id = upload_batches.store_id AND stores.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM stores WHERE stores.id = upload_batches.store_id AND stores.owner_id = auth.uid()));

DROP POLICY IF EXISTS "delete_own_upload_batches" ON upload_batches;
CREATE POLICY "delete_own_upload_batches" ON upload_batches FOR DELETE
  TO authenticated USING (EXISTS (SELECT 1 FROM stores WHERE stores.id = upload_batches.store_id AND stores.owner_id = auth.uid()));

-- transactions: owner-scoped via parent store
DROP POLICY IF EXISTS "select_own_transactions" ON transactions;
CREATE POLICY "select_own_transactions" ON transactions FOR SELECT
  TO authenticated USING (EXISTS (SELECT 1 FROM stores WHERE stores.id = transactions.store_id AND stores.owner_id = auth.uid()));

DROP POLICY IF EXISTS "insert_own_transactions" ON transactions;
CREATE POLICY "insert_own_transactions" ON transactions FOR INSERT
  TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM stores WHERE stores.id = transactions.store_id AND stores.owner_id = auth.uid()));

DROP POLICY IF EXISTS "update_own_transactions" ON transactions;
CREATE POLICY "update_own_transactions" ON transactions FOR UPDATE
  TO authenticated USING (EXISTS (SELECT 1 FROM stores WHERE stores.id = transactions.store_id AND stores.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM stores WHERE stores.id = transactions.store_id AND stores.owner_id = auth.uid()));

DROP POLICY IF EXISTS "delete_own_transactions" ON transactions;
CREATE POLICY "delete_own_transactions" ON transactions FOR DELETE
  TO authenticated USING (EXISTS (SELECT 1 FROM stores WHERE stores.id = transactions.store_id AND stores.owner_id = auth.uid()));

-- products: owner-scoped via parent store
DROP POLICY IF EXISTS "select_own_products" ON products;
CREATE POLICY "select_own_products" ON products FOR SELECT
  TO authenticated USING (EXISTS (SELECT 1 FROM stores WHERE stores.id = products.store_id AND stores.owner_id = auth.uid()));

DROP POLICY IF EXISTS "insert_own_products" ON products;
CREATE POLICY "insert_own_products" ON products FOR INSERT
  TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM stores WHERE stores.id = products.store_id AND stores.owner_id = auth.uid()));

DROP POLICY IF EXISTS "update_own_products" ON products;
CREATE POLICY "update_own_products" ON products FOR UPDATE
  TO authenticated USING (EXISTS (SELECT 1 FROM stores WHERE stores.id = products.store_id AND stores.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM stores WHERE stores.id = products.store_id AND stores.owner_id = auth.uid()));

DROP POLICY IF EXISTS "delete_own_products" ON products;
CREATE POLICY "delete_own_products" ON products FOR DELETE
  TO authenticated USING (EXISTS (SELECT 1 FROM stores WHERE stores.id = products.store_id AND stores.owner_id = auth.uid()));

-- Indexes
CREATE INDEX IF NOT EXISTS idx_transactions_store_time ON transactions (store_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_store_cashier ON transactions (store_id, cashier_id);
CREATE INDEX IF NOT EXISTS idx_products_store ON products (store_id);
CREATE INDEX IF NOT EXISTS idx_products_store_upc ON products (store_id, upc);
CREATE INDEX IF NOT EXISTS idx_upload_batches_store_created ON upload_batches (store_id, created_at DESC);
