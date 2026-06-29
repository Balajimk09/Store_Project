# StorePulse AI — Project Standards & Source of Truth

Project name: StorePulse AI

Project path: `C:\Users\kallo\Store_Project`

Purpose: AI-powered convenience store/gas station back-office MVP.

Codex must read this file before writing code. This file is the repo source of truth for route boundaries, database names, table/column rules, Supabase patterns, storage rules, and validation workflow.

Core rules:
- Never guess table names or column names.
- Never invent new database patterns without explicit SQL and approval.
- If something is missing, ask or provide SQL separately.
- Do not refactor unrelated modules while completing a targeted task.
- Do not change app behavior for documentation-only tasks.

## Tech Stack

Framework: Next.js App Router

Language: TypeScript strict

Frontend: React, Tailwind CSS, shadcn/ui, lucide-react, Recharts

Backend: Supabase PostgreSQL, Supabase Auth, Supabase Storage

Repo: GitHub

Supabase client rules:
- Use the shared Supabase browser client from `lib/supabase`.
- Do not create random Supabase clients inline.
- Never use the service role key in client components.
- Service role/admin clients belong only in server-side API/helpers.

## Route Worlds

User-facing route worlds:

`/superadmin`

Platform owner / StorePulse owner area. Manages platform plans, stores, users, permissions, staff, audit logs, revenue, and settings.

`/admin`

StorePulse internal staff/support area. Used by internal employees to support customer stores based on permissions.

`/app`

Store owner workspace. Used by store owners to manage their own store data.

Important file route clarification:
- User-facing route `/superadmin` usually maps to `app/superadmin/*`.
- User-facing route `/admin` usually maps to `app/admin/*`.
- User-facing route `/app` usually maps to `app/(store)/app/*` or `app/account` wrappers depending on current structure.

Rules:
- Never mix `/superadmin`, `/admin`, and `/app` responsibilities.
- Store owner pages must not include superadmin-only logic.
- Superadmin pages must not impersonate store owners silently.
- Admin/superadmin store management uses the selected route `storeId`.
- Admin user id is audit actor only, never `owner_id`.

## Auth and User Metadata

Client components use:

```ts
import { useAuth } from '@/lib/auth'
```

Expected auth/store context values may include:
- `user`
- `session`
- `loading`
- `store`
- `stores`
- `activeStore`
- `activeStoreId`
- `setActiveStoreId`
- `refreshStore`
- `refreshStores`
- `signOut`

Rules:
- `user.id` is the authenticated Supabase Auth user id.
- Store owner self-service account settings use Supabase Auth metadata for MVP.
- Superadmin user management may use `user_profiles` separately.
- Do not expose or read current passwords.
- Password reset/change must use Supabase Auth APIs.
- Never use user-editable metadata for authorization decisions. Use database permissions/app metadata/server checks for authorization.

Current user metadata fields:
- `username`
- `phone_number`
- `auto_logout_minutes`
- `notify_new_login`
- `notify_low_stock_in_app`
- `notify_upload_complete_in_app`
- `notify_support_reply_in_app`
- `notify_vendor_delivery_in_app`
- `notify_new_login_in_app`

## Multi-Store Standard

Definitions:
- `activeStoreId: string | null`
- `activeStoreId === null` means All Stores is selected.
- `activeStoreId` as UUID means one selected store.
- `activeStore = stores.find(s => s.id === activeStoreId) ?? null`

Rules:
- Store-specific tabs/pages must block writes when `activeStoreId` is null.
- All Stores is aggregate/read-only for MVP.
- Selected store queries use `store_id = activeStoreId`.
- All Stores read queries must first get all store ids owned by the user, then query data using `store_id in ownedStoreIds`.
- Write actions must require a selected store.
- Store owner writes must never use an admin user id as `owner_id`.

Standard messages:
- Store Profile: `Select a specific store to edit store profile.`
- Fuel Profile: `Select a specific store to edit fuel profile.`
- Business Hours: `Select a specific store to edit business hours.`
- Licenses: `Select a specific store to manage licenses.`
- Bank & Check: `Select a specific store to manage bank/check setup.`

## Database Contract

Do not use table names that are not listed here unless a new migration SQL is explicitly requested and approved.

### `stores`

Purpose: Primary store table. One row per store.

Columns:
- `id uuid`
- `owner_id uuid`
- `store_name text`
- `store_address text`
- `city text`
- `state text`
- `zip_code text`
- `phone_number text`
- `address_line1 text`
- `address_line2 text`
- `country text`
- `timezone text`
- `store_type text`
- `custom_store_type text`
- `fuel_brand text`
- `business_legal_name text`
- `dba_name text`
- `operating_hours jsonb`
- `pos_type text`
- `has_fuel boolean`
- `register_count integer`
- `store_email text`
- `owner_phone_number text`
- `plan text`
- `subscription_status text`
- `billing_status text`
- `allowed_user_count integer`
- `allowed_store_count integer`
- `created_at timestamptz`

Naming rules:
- Use `business_legal_name`, not `legal_business_name`.
- Use `address_line1`, not `address_line_1`.
- Use `address_line2`, not `address_line_2`.
- Use `operating_hours`, not `business_hours`.
- `phone_number` means store phone.
- `owner_phone_number` means owner personal phone.

### `platform_plans`

Purpose: Real superadmin-created subscription plans table. Billing in `/app/account` must use this table. Do not use `platform_subscription_plans`.

Columns:
- `id uuid`
- `plan_name text`
- `plan_code text`
- `monthly_price numeric`
- `yearly_price numeric`
- `setup_fee numeric`
- `trial_days integer`
- `max_stores integer`
- `max_users_per_store integer`
- `max_products integer`
- `max_uploads_per_month integer`
- `max_ai_requests_per_month integer`
- `features jsonb`
- `is_active boolean`
- `sort_order integer`
- `created_at timestamptz`
- `updated_at timestamptz`

Rules:
- Store owners can read active plans only.
- Store owners cannot edit `platform_plans`.
- Superadmin owns plan creation and updates.

### `store_licenses`

Purpose: License/tax records for a selected store.

Columns:
- `id uuid`
- `store_id uuid`
- `owner_id uuid`
- `license_name text`
- `license_number text`
- `valid_from date nullable`
- `expires_on date nullable`
- `notes text`
- `document_path text nullable`
- `created_at timestamptz`
- `updated_at timestamptz`

Important:
- Forms may use `YYYY-MM-DD` strings.
- Database fields are date/date-like values.

### `store_bank_profiles`

Purpose: Bank/check setup sketch per store.

Columns:
- `id uuid`
- `store_id uuid unique`
- `owner_id uuid`
- `bank_name text`
- `account_holder_name text`
- `account_type text`
- `routing_last4 text`
- `account_last4 text`
- `starting_check_number integer`
- `authorized_signer_name text`
- `default_check_memo text`
- `security_note text`
- `created_at timestamptz`
- `updated_at timestamptz`

Rules:
- Never save full routing number.
- Never save full account number.
- Only save last 4 digits.
- Upsert conflict target is `store_id`.

### `store_fuel_providers`

Purpose: Fuel provider profile per store.

Columns:
- `id uuid`
- `store_id uuid unique`
- `owner_id uuid`
- `provider_name text`
- `provider_company_name text`
- `address text`
- `provider_address text`
- `sales_rep_name text`
- `phone text`
- `email text`
- `website text`
- `notes text`
- `pump_count integer`
- `distributor_type text`
- `created_at timestamptz`
- `updated_at timestamptz`

Rules:
- Keep `provider_name`/`address` and `provider_company_name`/`provider_address` in sync if both exist.
- Upsert conflict target is `store_id`.

### `products`

Purpose: Store products/pricebook records.

Important:
- Products are scoped by `store_id`.
- `/app/products` must support selected store and All Stores mode.
- Selected store shows that store's products.
- All Stores shows products across all owned stores with store name visible.

### `transactions`

Purpose: POS/CSV transaction records.

Important:
- Transactions are scoped by `store_id`.
- Dashboard/Reports/Transactions must use selected store or All Stores owned store ids.

### `upload_batches`

Purpose: Tracks uploads for transactions/products.

Important:
- Must be scoped by `store_id` and `owner_id`.

### Store Settings product defaults

These tables are used by `/app/store-settings` as product default sources. Store-owner writes must be scoped to the selected `activeStoreId`; All Stores mode is read-only for these settings.

#### `store_settings`

Purpose: One-row-per-store operating preferences for tax profile, payment methods, and discount rules.

Confirmed columns:
- `id uuid`
- `store_id uuid`
- `default_tax_rate numeric`
- `default_tax_category text`
- `default_reorder_level integer`
- `currency_code text`
- `price_rounding text`
- `tax_registration_number text`
- `payment_methods jsonb`
- `discount_rules jsonb`
- `created_at timestamptz`
- `updated_at timestamptz`

Rules:
- `payment_methods` stores an array of `{ name, enabled }` values.
- `discount_rules` stores an array of `{ name, percent, enabled }` values.
- This is configuration only; it does not process payments or apply discounts to transactions.

#### `tax_categories`

Purpose: Store-specific tax options used by products, departments, categories, and promotions.

Confirmed columns:
- `id uuid`
- `store_id uuid`
- `name text`
- `rate numeric`
- `description text`
- `is_default boolean`
- `is_active boolean`
- `created_at timestamptz`
- `updated_at timestamptz`

Rule: only one tax category should be default per store.

#### `promotions`

Purpose: Store-specific deal and promotion defaults.

Confirmed columns:
- `id uuid`
- `store_id uuid`
- `name text`
- `deal_type text`
- `quantity_required integer`
- `deal_price numeric`
- `start_date date`
- `end_date date`
- `tax_category_id uuid`
- `is_active boolean`
- `created_at timestamptz`
- `updated_at timestamptz`

#### `promotion_products`

Purpose: Product links for store promotions.

Confirmed columns:
- `id uuid`
- `store_id uuid`
- `promotion_id uuid`
- `product_id uuid`
- `upc text`
- `item_name text`
- `created_at timestamptz`

#### `promotion_departments`

Purpose: Department applicability links for store promotions.

Confirmed columns:
- `id uuid`
- `store_id uuid`
- `promotion_id uuid`
- `department_id uuid`
- `created_at timestamptz`

#### `promotion_categories`

Purpose: Category applicability links for store promotions.

Confirmed columns:
- `id uuid`
- `store_id uuid`
- `promotion_id uuid`
- `category_id uuid`
- `created_at timestamptz`

#### `store_departments`

Purpose: Broad product departments for a store.

Confirmed columns:
- `id uuid`
- `store_id uuid`
- `name text`
- `description text`
- `ebt_eligible boolean`
- `is_active boolean`
- `tax_category_id uuid`
- `age_restriction_id uuid`
- `created_at timestamptz`
- `updated_at timestamptz`

#### `store_categories`

Purpose: Detailed product categories under optional departments.

Confirmed columns:
- `id uuid`
- `store_id uuid`
- `name text`
- `department_id uuid`
- `ebt_eligible boolean`
- `is_active boolean`
- `tax_category_id uuid`
- `age_restriction_id uuid`
- `created_at timestamptz`
- `updated_at timestamptz`

#### `store_vendors`

Purpose: Store-specific vendor records shared by store owner settings and superadmin vendor visibility.

Confirmed columns:
- `id uuid`
- `store_id uuid`
- `vendor_name text`
- `sales_rep_name text`
- `phone text`
- `email text`
- `website text`
- `category text`
- `notes text`
- `order_days text[]`
- `delivery_days text[]`
- `expected_invoice_amount numeric`
- `payment_terms text`
- `notification_enabled boolean`
- `schedule_frequency text`
- `is_active boolean`
- `created_at timestamptz`
- `updated_at timestamptz`

#### `global_vendors`

Purpose: Superadmin-managed vendor templates that store owners can copy into `store_vendors`.

Confirmed columns include the same vendor profile/schedule fields used by `store_vendors`, except `store_id`.

#### `store_age_restriction_presets`

Purpose: Store-specific age restriction presets used by product age verification defaults.

Confirmed columns:
- `id uuid`
- `store_id uuid`
- `name text`
- `minimum_age integer`
- `restriction_type text`
- `is_active boolean`
- `created_at timestamptz`
- `updated_at timestamptz`

#### `vendor_promotions`

Purpose: Superadmin/company global promotion templates that store owners can copy into store-owned `promotions` rows.

Confirmed columns:
- `id uuid`
- `title text`
- `vendor_name text`
- `description text`
- `promotion_type text`
- `status text`
- `product_keywords text[]`
- `target_store_notes text`
- `internal_notes text`
- `starts_at timestamptz`
- `ends_at timestamptz`
- `created_by uuid`
- `created_at timestamptz`
- `updated_at timestamptz`

Rules:
- Imported global promotions are copied into `promotions` as inactive store-owned deals.
- Store promotions are not live-synced to `vendor_promotions`.

### Supporting tables

Known supporting tables. Verify exact schema before writing:
- `user_profiles`
- `user_permissions`
- `admin_audit_logs`
- `store_plan_overrides`

Do not invent columns for supporting tables. If exact schema is not verified, mark as "verify before writing."

## Storage Standard

Current MVP store document storage:

Bucket: `store-documents`

Purpose: Store owner uploaded documents/files from Licenses & Tax IDs.

Access: Private, owner-scoped by `store_id` path.

Path format: `{store_id}/docs/{timestamp}-{safe_filename}`

Allowed types: PDF, PNG, JPG, JPEG, WEBP

Max size: 10 MB

Current MVP rules:
- Use Supabase Storage only for account license/store documents.
- Do not use a `store_documents` metadata table unless explicitly requested later.
- If a metadata table is introduced later, provide SQL and update `AGENTS.md`.

Storage operations:
- List from `store-documents` at `{activeStoreId}/docs`.
- Upload to `store-documents` with validated file type and size.
- View through signed URL.
- Delete from storage.

Future storage note:
- `inventory-invoices`: future bucket, verify design before use.
- Do not document `inventory-invoices` as using a `store-logos` path.

## RLS and SQL Policy Standard

Critical rule: PostgreSQL does not support `CREATE POLICY IF NOT EXISTS`. Use `DROP POLICY IF EXISTS` first, then `CREATE POLICY`.

Pattern:

```sql
drop policy if exists "policy_name" on table_name;

create policy "policy_name"
on table_name
for select
to authenticated
using (...);
```

Owner-direct table pattern:

```sql
auth.uid() = owner_id
```

Child table pattern:

```sql
exists (
  select 1
  from public.stores s
  where s.id = table_name.store_id
  and s.owner_id = auth.uid()
)
```

Storage path pattern for `store-documents`:

```sql
bucket_id = 'store-documents'
and split_part(name, '/', 1) in (
  select id::text
  from public.stores
  where owner_id = auth.uid()
)
```

`platform_plans` read pattern:
- Store owners can read active plans.
- Superadmin can manage through admin/server-side routes.

Supabase Data API note:
- New public tables may require explicit `grant` statements before `supabase-js` can access them.
- Grants are separate from RLS. RLS controls rows after the role can access the table.
- If PostgREST returns `permission denied for table`, add reviewed grants plus RLS/policies.

Store documents bucket and policies template:

```sql
insert into storage.buckets
  (id, name, public)
values
  ('store-documents', 'store-documents', false)
on conflict (id) do nothing;

drop policy if exists "owners_upload_store_documents" on storage.objects;
create policy "owners_upload_store_documents"
on storage.objects
for insert to authenticated
with check (
  bucket_id = 'store-documents'
  and split_part(name, '/', 1) in (
    select id::text from public.stores
    where owner_id = auth.uid()
  )
);

drop policy if exists "owners_read_store_documents" on storage.objects;
create policy "owners_read_store_documents"
on storage.objects
for select to authenticated
using (
  bucket_id = 'store-documents'
  and split_part(name, '/', 1) in (
    select id::text from public.stores
    where owner_id = auth.uid()
  )
);

drop policy if exists "owners_delete_store_documents" on storage.objects;
create policy "owners_delete_store_documents"
on storage.objects
for delete to authenticated
using (
  bucket_id = 'store-documents'
  and split_part(name, '/', 1) in (
    select id::text from public.stores
    where owner_id = auth.uid()
  )
);
```

## TypeScript Type Standard

Shared types should live in `lib/supabase.ts` when used across modules. Local component-only types can remain local if not reused.

Canonical interfaces:

```ts
export interface StoreRow {
  id: string
  owner_id: string
  store_name: string
  store_address: string | null
  address_line1?: string | null
  address_line2?: string | null
  city: string | null
  state: string | null
  zip_code: string | null
  country?: string | null
  phone_number: string | null
  owner_phone_number?: string | null
  store_email?: string | null
  pos_type: string | null
  store_type?: string | null
  custom_store_type?: string | null
  has_fuel: boolean
  fuel_brand?: string | null
  timezone?: string | null
  business_legal_name?: string | null
  dba_name?: string | null
  operating_hours?: Record<string, DayHours> | null
  plan?: string | null
  subscription_status?: string | null
  billing_status?: string | null
  allowed_user_count?: number | null
  allowed_store_count?: number | null
  register_count: number
  created_at: string
}

export interface DayHours {
  closed: boolean
  open: string
  close: string
}

export interface StoreLicense {
  id: string
  store_id: string
  owner_id: string
  license_name: string
  license_number: string | null
  valid_from: string | null
  expires_on: string | null
  notes: string | null
  created_at: string
  updated_at?: string | null
}

export interface StoreFuelProvider {
  id: string
  store_id: string
  owner_id: string
  provider_name: string | null
  provider_company_name: string | null
  address: string | null
  provider_address: string | null
  sales_rep_name: string | null
  phone: string | null
  email: string | null
  website: string | null
  notes: string | null
  pump_count: number | null
  distributor_type: string | null
  created_at: string
  updated_at?: string | null
}

export interface StoreBankProfile {
  id: string
  store_id: string
  owner_id: string
  bank_name: string | null
  account_holder_name: string | null
  account_type: string | null
  routing_last4: string | null
  account_last4: string | null
  starting_check_number: number | null
  authorized_signer_name: string | null
  default_check_memo: string | null
  security_note: string | null
  created_at: string
  updated_at?: string | null
}

export interface PlatformPlan {
  id: string
  plan_name: string
  plan_code: string
  monthly_price: number | null
  yearly_price: number | null
  setup_fee: number | null
  trial_days: number | null
  max_stores: number | null
  max_users_per_store: number | null
  max_products: number | null
  max_uploads_per_month: number | null
  max_ai_requests_per_month: number | null
  features: string[] | Record<string, unknown> | null
  is_active: boolean
  sort_order: number | null
  created_at?: string
  updated_at?: string
}
```

`StoreLicense.valid_from` and `StoreLicense.expires_on` are nullable strings in TypeScript because forms receive `YYYY-MM-DD` strings, but database fields are date values.

## Save Handler Standard

Rules:
- Guard required `user` and `activeStoreId`.
- Clear error/success/debug before save.
- Set saving true.
- Perform Supabase call.
- Throw Supabase error.
- Reload affected data.
- Exit edit mode after success.
- Show success and auto-clear after 3 seconds.
- `console.error` full raw error.
- Show formatted real Supabase error.
- Keep edit mode open on failure.
- Always clear saving in `finally`.

Standard helper:

```ts
export function formatSupabaseError(error: unknown, fallback = 'Operation failed.') {
  if (!error) return fallback
  if (typeof error === 'object' && error !== null) {
    const e = error as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown }
    const formatted = [
      e.message,
      e.details,
      e.hint,
      e.code ? `Code: ${e.code}` : null,
    ].filter(Boolean).map(String).join(' ')
    if (formatted) return formatted
  }
  if (error instanceof Error) return error.message
  return String(error || fallback)
}
```

## Load Data Standard

Rules:
- Load data in `useEffect` based on `activeSection` and `activeStoreId`.
- Reload after successful save/delete/upload.
- On store switch, exit edit mode and reset forms.
- On tab switch, exit edit mode and clear messages.
- Do not load all heavy tables unnecessarily.

## Edit Mode Standard

Rules:
- Settings pages are summary-first.
- Forms appear after Edit.
- Save returns to summary.
- Cancel returns to summary and reloads saved data.
- Switching tabs exits edit mode.
- Switching stores exits edit mode and resets form state.

## Do Not Touch Unless Explicitly Requested

Codex must not modify these unless explicitly requested:
- `app/superadmin/*`
- `app/admin/*`
- Store 360 components/routes
- `lib/auth.tsx`
- `lib/supabase-admin.ts`
- `lib/admin-auth.ts`
- `components/layout/sidebar.tsx`
- `middleware.ts`
- `app/login/*`
- `app/signup/*`
- `app/(store)/app/dashboard/*`
- `app/(store)/app/products/*`
- `app/(store)/app/reports/*`

Important: these are file path protections, not route-world definitions. If a future task targets one of these files, then it may be modified only for that task.

## Development Checklist

Before coding:
1. Read `AGENTS.md`.
2. Identify route world: `/superadmin`, `/admin`, or `/app`.
3. Identify selected store behavior.
4. Identify All Stores behavior.
5. Identify exact tables and columns.
6. Check whether write actions are allowed in All Stores mode.
7. Do not invent names.

During coding:
1. Use exact table names from `AGENTS.md`.
2. Use exact column names.
3. Scope store-owner writes by `owner_id` and/or store ownership.
4. Show real Supabase errors.
5. Do not hide RLS errors.
6. Do not use mock/demo data for real users unless demo mode is explicit.

After coding:
1. Run `npm run typecheck`.
2. Run `npm run build`.
3. Summarize files changed.
4. Mention SQL needed separately.
5. Mention manual browser tests.
