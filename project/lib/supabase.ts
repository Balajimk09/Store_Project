import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  // Surface a clear runtime error only when actually used by the browser.
  // eslint-disable-next-line no-console
  console.warn('Supabase env vars missing. Cloud mode unavailable.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export interface StoreRow {
  id: string;
  owner_id: string;
  store_name: string;
  store_address: string | null;
  pos_type: string | null;
  has_fuel: boolean;
  register_count: number;
  created_at: string;
}

export interface UploadBatchRow {
  id: string;
  store_id: string;
  owner_id: string;
  upload_type: 'transactions' | 'products';
  file_name: string;
  row_count: number;
  valid_count: number;
  invalid_count: number;
  created_at: string;
}

export interface TransactionRow {
  id: string;
  store_id: string;
  owner_id: string;
  txn_id: string;
  timestamp: string;
  item: string | null;
  category: string | null;
  cashier_id: string | null;
  cashier_name: string | null;
  register: number;
  payment_type: string | null;
  amount: number;
  txn_type: string;
  upc: string | null;
  quantity: number;
  unit_price: number;
  discount_amount: number;
  created_at: string;
}

export interface ProductRow {
  id: string;
  store_id: string;
  owner_id: string;
  upc: string;
  name: string | null;
  category: string | null;
  brand: string;
  cost_price: number;
  selling_price: number;
  stock: number;
  reorder_level: number;
  vendor: string | null;
  created_at: string;
}
