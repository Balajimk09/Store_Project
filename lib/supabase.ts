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
  city: string | null;
  state: string | null;
  zip_code: string | null;
  phone_number: string | null;
  pos_type: string | null;
  has_fuel: boolean;
  register_count: number;
  created_at: string;
}
export interface UploadBatchRow {
  id: string;
  store_id: string;
  upload_type: 'transactions' | 'products';
  file_name: string;
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  created_at: string;
}

export interface TransactionRow {
  id: string;
  store_id: string;
  batch_id: string | null;
  transaction_id: string;
  transaction_time: string;
  register_id: number | null;
  cashier_id: string | null;
  upc: string | null;
  item_name: string | null;
  category: string | null;
  quantity: number;
  unit_price: number;
  discount_amount: number;
  total_amount: number;
  payment_type: string | null;
  transaction_type: string;
  created_at: string;
}

export interface ProductRow {
  id: string;
  store_id: string;
  batch_id: string | null;
  upc: string;
  item_name: string | null;
  category: string | null;
  brand: string | null;
  cost_price: number;
  selling_price: number;
  stock: number;
  reorder_level: number;
  vendor: string | null;
  created_at: string;
  updated_at: string;
}
