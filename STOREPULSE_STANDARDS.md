# StorePulse AI — Project Standards

# STOREPULSE_STANDARDS.md

# Last updated: 2026-06-28

# Update this date only when explicitly asked to update this file.

---

## HOW TO USE THIS FILE

This file is the project rulebook for StorePulse AI.
Read this file completely before writing any code.

Instruction priority order:

1. Current task prompt — most specific, wins for scope
2. STOREPULSE_STANDARDS.md — project architecture and rules
3. AGENTS.md — operational repo rules
4. Codex custom instructions — baseline behavior

The current task defines the allowed scope.
Do not touch modules outside the current task
just because they are mentioned here.

Do not modify generated files, build output,
cache folders, node_modules, .next, dist, or
coverage output.

---

## PARTIAL STALENESS RULE

This file may be partially stale.
Some sections match the current code.
Some sections may lag behind.

Treat each section independently:
If a section matches the code → use it
If a section contradicts the code →
use the actual code as source of truth,
report the contradiction,
complete the task using what the code does

Do not discard the entire file because one
section is stale.

Do not update this file unless documentation
updates are explicitly in scope.

---

## MAINTENANCE RULE

Update this file only when:

* Explicitly asked to do so, OR
* A task prompt includes documentation
  updates as part of its scope

This file should be updated when:

* A module moves from pending to complete
* Database schema changes significantly
* New routes are added
* POS parser rules change
* Auth or routing architecture changes
* Important table or storage rules change

Do not update this file as a side effect
of unrelated tasks.

If a module status is stale, report the
mismatch instead of editing this file unless
documentation updates are in scope.

---

## RELATIONSHIP TO AGENTS.md

AGENTS.md contains:

* Codex operational rules
* How to approach tasks
* What to do before and after editing
* Task workflow requirements
* Build/typecheck requirements

STOREPULSE_STANDARDS.md contains:

* What StorePulse AI is
* Route structure and auth rules
* Database conventions and table map
* POS parser rules and column positions
* Module status and build order
* Code standards and product patterns

If AGENTS.md and STOREPULSE_STANDARDS.md
conflict:

1. Report the conflict
2. Follow the current task prompt
3. If still unclear, stop and ask

---

## AGENTS.md WORKTREE RULE

AGENTS.md is frequently modified and may
appear as a pre-existing modified file in
git status. This is expected.

Read the current version as-is.
Do not revert AGENTS.md.
Do not stage, commit, or push AGENTS.md.
Only edit AGENTS.md if the task explicitly
asks for it.

---

## WHAT IS STOREPULSE AI

StorePulse AI is a SaaS platform for
convenience store and gas station owners.

Store owners upload Verifone Commander POS
report files, usually HTML or ZIP, and get
analytics, reporting, cashier auditing,
product management, and AI-powered insights.

End goal: live connection between Verifone
Commander and StorePulse so data flows
automatically without manual uploads.

Current phase: Manual HTML upload → parsed
data → dashboard and reports.

---

## TECH STACK

Framework:    Next.js 14+ App Router with TypeScript
Styling:      Tailwind CSS + shadcn/ui
Database:     Supabase PostgreSQL
Auth:         Supabase Auth
Storage:      Supabase Storage
ORM:          Supabase JS client, no Prisma
Package mgr:  npm
Project path: C:\Users\kallo\Store_Project

---

## ROUTE STRUCTURE AND WORLDS

Route worlds are strict. Never mix them.

/superadmin/* = platform owner / superadmin
/admin/*      = StorePulse internal staff
/app/*        = store owner / employee app

Public routes, no auth required:
/login
/signup
/forgot-password
/reset-password
/admin/login
/admin/forgot-password
/superadmin/login
/superadmin/forgot-password

Protected routes:
/app/*          store owner or employee session
/admin/*        StorePulse staff role
/superadmin/*   superadmin role

---

## ROUTE GROUP RULE

Store app uses a Next.js route group:
app/(store)/app/*

(store) does not appear in the URL.

File:  app/(store)/app/products/page.tsx
URL:   /app/products

Always create new store pages inside:
app/(store)/app/

Never create store pages inside:
app/app/

Superadmin app uses:
app/(superadmin)/superadmin/*

File:  app/(superadmin)/superadmin/team/page.tsx
URL:   /superadmin/team

Always create new superadmin pages inside:
app/(superadmin)/superadmin/

Never create superadmin pages inside:
app/superadmin/

---

## ADMIN ROUTE STRUCTURE

Admin does not use a route group.

Admin files live directly under:
app/admin/

Examples:
app/admin/login/page.tsx
app/admin/forgot-password/page.tsx
app/admin/support-desk/page.tsx

New admin pages follow the existing app/admin/*
pattern.

Do not use app/(admin)/admin/ unless the
project is intentionally refactored.

---

## AUTH RULES

/login             = store owners/employees
/admin/login       = StorePulse staff
/superadmin/login  = platform superadmin

Wrong portal login must sign out the session
before showing any message or redirect.

Do not expose raw Supabase errors in the UI.
Do not use service role keys in client code.
Do not use supabase.auth.admin.* in the browser.

Preserve lib/auth.tsx, AuthProvider, and
useAuth unless explicitly asked to change them.

Allowed auth methods:
supabase.auth.signInWithPassword()
supabase.auth.resetPasswordForEmail()
supabase.auth.updateUser()
supabase.auth.signOut()
supabase.auth.onAuthStateChange()
supabase.auth.getSession()
supabase.auth.getUser()

Reset password page must be 'use client'.
Use onAuthStateChange with PASSWORD_RECOVERY.
Do not manually parse URL hash for tokens.
Unsubscribe onAuthStateChange on unmount.

---

## MULTI-STORE AND ACTIVE STORE RULE

activeStoreId === null = All Stores mode
All Stores mode = read/aggregate only
Writes/imports require a specific store

Always use store_id UUID for store lookups.
Never use store_name as a unique identifier.

Store-level data tables should be scoped by store_id.

Owner-scoped RLS often uses:
stores.owner_id = auth.uid()

However, employee/team access, internal admin access,
and superadmin access may require different existing
membership or permission policies.

Before creating or changing RLS, inspect the actual
current policies and schema.

Do not assume every store-level policy is owner-only.

---

## DATABASE CONVENTIONS

Standard store-level table columns often include:
id          uuid primary key default gen_random_uuid()
store_id    uuid references stores(id)
owner_id    uuid
created_at  timestamptz default now()

Do not assume every table has every column.
Inspect the actual schema before using or changing
tables.

RLS pattern for owner-scoped store tables often uses:

drop policy if exists "name" on table_name;
create policy "name"
on table_name for [action] to authenticated
using (
exists (
select 1 from stores
where stores.id = table_name.store_id
and stores.owner_id = auth.uid()
)
);

After any schema change run:
notify pgrst, 'reload schema';

Never store:
full card numbers
auth codes
EMV cryptograms
PIN data
routing numbers except last 4
full account numbers except last 4

---

## TABLE CONVENTION CLARIFICATION

Most store-level tables include store_id and
owner_id for RLS, ownership, and audit.

Platform/global tables may not have store_id:
platform_plans
global_vendors
platform role/permission tables
superadmin-managed lookup tables

Before assuming a table has store_id or
owner_id, inspect the actual schema or
generated Supabase types.

Do not invent columns.

---

## DUPLICATE STORE NAME BUG

Two stores exist with duplicate names:
classen  lowercase
Classen  uppercase

Until resolved:
Always look up stores by store_id.
Never treat store_name as unique.
Do not query stores by name alone.
If a task needs the Classen store,
ask the developer which store_id to use.

Do not create logic that depends on
case-sensitive store names.

---

## SUPABASE STORAGE

Default bucket:
store-documents

Use this for all store document uploads
unless the task asks for a different bucket.

Do not create new buckets without instruction.

Path pattern:
{store_id}/docs/{timestamp}-{filename}

Rules:
Scope documents by store_id.
Do not expose documents across stores.
Respect existing size/type validation.
Do not assume public bucket access.
If policies are unclear, stop and report.

---

## SHADCN/UI RULE

Use the existing shadcn/ui pattern already
in the codebase.

Before adding a component:
Check components/ui/ for existing components.
Reuse existing components when available.
Match the existing import alias pattern.

Do not install new component libraries.
Do not run shadcn add unless explicitly asked.
Do not use inline styles.
Do not create new CSS files unless asked.

---

## ERROR HELPER RULE

Convert Supabase/Postgres errors to friendly
user-facing messages.

Never show raw error codes or raw Supabase
error text in the UI.

Before using or creating an error formatter,
check these files:
lib/supabase.ts
lib/utils.ts
lib/errors.ts

If formatSupabaseError exists, import and use it.

If no shared helper exists:
Do not create a new utility file unless asked.
Use a small local formatter for the current task.
Report that a shared error helper may be needed.

---

## CODE STANDARDS

Save handler pattern:

1. Clear error state
2. setSaving(true)
3. try block
4. throw on Supabase error
5. Reload data from DB
6. setEditingSection(null)
7. Show success state
   catch: setError(formatSupabaseError(err))
   finally: setSaving(false)

Tab and store switch:
Always exit edit mode when switching tabs.
Always exit edit mode when switching stores.

Supabase .single() safety:
Never use .single() where zero or multiple
rows are possible.
Use .maybeSingle() for zero-row tolerance.
Use .limit(1) for intentional single-row picks.

TypeScript:
No any for return types.
No any for Supabase query results.
Use generated types from lib/supabase.ts.
Use explicit interfaces if types are missing.

---

## TYPECHECK AND BUILD FAILURE RULE

If npm run typecheck or npm run build fails:

1. Determine if caused by current task changes
2. If caused by task: fix before completing
3. If pre-existing or out of scope: report clearly
4. Do not fix unrelated files unless asked
5. Do not run git stash automatically

For risky tasks, run npm run typecheck before
editing to establish a baseline.

---

## DEV SERVER RESTART RULE

After changing any of these, tell the developer
to restart the dev server before browser testing:
middleware.ts
API routes
auth callback or reset routes
route groups or layouts affecting routing
environment variables
next.config files

Restart:
Ctrl+C to stop
npm run dev to restart

Middleware and route changes may not take
effect until the server restarts.

---

## POS IMPORT — PHASE 1

Upload pipeline:
Store owner uploads Verifone HTML files
or ZIP → API parses → inserts into pos_* tables.

Duplicate prevention uses SHA-256 file_hash.

Per-file try/catch means one failure does not
stop remaining ZIP files.

Standard 6 files per day:

1. PLU Report all Cashiers.html
2. Department Report All Cashiers.html
3. Category Report by Cashier.html
4. Tax Report by Register.html
5. Deal Report.html
6. DCR Statistical Report.html

Source system values:
Verifone HTML: source_system = 'verifone_commander'
Manual CSV:    source_system = 'manual_template'

Use pos_* table prefix, not vf_*.

ZIP upload can process many files, but only
supported report types parse into data tables.
Other report files are logged as unknown and skipped.

---

## POS DATABASE TABLES

Tracking:
pos_report_periods    one row per period
pos_report_files      one row per file
upload_batches        high-level batch record

Data tables:
pos_plu_sales         PLU/product sales
pos_department_sales  department sales
pos_category_sales    category sales
pos_tax_summary       tax collected
pos_payment_summary   payment types
pos_fuel_dcr_summary  per-pump fuel stats
pos_deal_sales        promotions/deals
pos_cashier_summary   cashier data

---

## VERIFONE PARSER RULES

Verifone HTML uses spacer columns.

Real data is at even indices:
0, 2, 4, 6, ...

Odd indices are empty spacers.

PLU columns:
[0]  plu_raw
[2]  description
[4]  unit_price
[6]  customer_count integer
[8]  items_sold
[10] total_sales
[12] sales_percent
[14] reason_code clean whitespace
[16] promotion_id

Department columns:
[0]  department_number
[2]  department_name
[4]  customer_count integer
[6]  items_sold
[8]  sales_percent
[10] gross_sales
[12] refunds
[14] discounts
[16] net_sales

Only import All Cashiers aggregate section.
Stop when col[0] starts with Cashier.
Skip Dept#, Description, Totals, Total, Neg, Other.

Category columns:
[0]  category_number
[2]  category_name
[4]  customer_count
[6]  items_sold
[8]  sales_percent
[10] net_sales

Same section rules as department.

Tax:
Import All Registers section only.
Stop at All DCRs or Register X.
register_number = All Registers on rows.
Skip Name, Totals, Total, Receipt, footnotes.

Deal Report has no spacer columns:
[0] promotion_id
[1] description
[2] customer_count
[3] match/combo count
[4] total_sales

Deal sections:
Combo Deals
Mix-Match Deals

DCR Statistical:
[0]  dcr_number
[2]  sale_count
[4]  amount
[6]  volume
[8]  pump_percent
[10] all_dcr_percent
[12] all_fuel_percent

UPC normalization:
lib/pos/upc-normalize.ts
Strip /000 suffix.
Remove non-numeric characters.
Pad to 14 digits using GTIN-14 style.

Integer fields reject decimals and return null.
Numeric fields accept decimals.

---

## PROTECTED POS FILES

Do not open or edit unless the task is
explicitly about POS import/parser/reports:
app/(store)/app/reports/pos-import/page.tsx
app/api/pos-import/route.ts
app/api/pos-import/discovered/route.ts
lib/pos/verifone-html.ts
lib/pos/period-detect.ts
lib/pos/upc-normalize.ts
app/(store)/app/reports/page.tsx

---

## COMPLETED MODULES

Account Center (/app/account):
Horizontal tabs, edit mode per tab.
Licenses, Documents, Billing, Security.
Documents use store-documents bucket.
Billing reads from platform_plans.

Store Settings (/app/store-settings):
Tabs: Tax, Deals, Departments, Categories,
Vendors, Age Restrictions,
Payment Methods, Discount Rules.
All dropdowns and relationships complete.

POS Import (/app/reports/pos-import):
Manual HTML/ZIP upload complete.
Supported report types parse correctly.
Duplicate prevention working.
ZIP processes all files without stopping.

Auth/Login:
/login, /admin/login, /superadmin/login.
/forgot-password for all three portals.
/reset-password client-side v2 flow.
Wrong portal signs out session.

Middleware:
Public auth routes bypass auth check.
Protected routes enforced.

---

## PENDING MODULES — BUILD ORDER

1. Placeholder cleanup
   Files with hardcoded placeholder text:
   app/(store)/app/setup/page.tsx
   app/setup/page.tsx
   app/demo-request/page.tsx
   Values:
   Meridian Mart
   700 S Meridian
   73127
   405-555-1234

2. Penn store import validation
   Test POS import with second store.
   Verify store isolation.

3. Products module (/app/products)
   Prerequisites complete:
   Store Settings data
   pos_plu_sales data
   Build:
   product list
   add/edit/delete
   dropdowns from Store Settings
   import from pos_plu_sales
   bulk actions
   low stock indicator

4. Dashboard connection to pos_* tables
   Current:
   reads from transactions table
   Add:
   pos_department_sales
   pos_tax_summary
   pos_fuel_dcr_summary
   pos_deal_sales
   pos_plu_sales

5. Cashier Audit enhancement
   Add pos_cashier_summary as data source.

6. Reports module enhancement
   Connect pos_* tables to all report tabs.
   Add date range filtering by pos_report_periods.

7. Discovered Setup Items approval flow
   Query pos_plu_sales for new products.
   Show for approval.
   Never auto-insert.

8. Phase 2 POS tables when needed
   pos_hourly_sales
   pos_safe_drops
   pos_paid_ins_outs
   pos_cash_reconciliation
   pos_top_sellers
   pos_network_journal

9. Live POS connector, Phase 2 future
   Windows service watches Report Navigator.
   Auto-uploads HTML files to /api/pos-import.
   Same tables, same parsers, different source.

---

## DO NOT BUILD YET

Receipt OCR
Windows connector agent
Live POS API connection
Official Verifone API
Notification emails
Audit logs
Auto-creation of products/departments/taxes
from POS data

Always require approval before creating products,
departments, categories, taxes, or deals from
discovered POS data.

---

## SIDEBAR NAVIGATION ORDER

Dashboard
Live Transactions
Products
Fuel
Store Settings
Cashier Audit
AI Assistant
Reports
Support
Account

POS Import lives under Reports.
Do not add POS Import as a top-level sidebar item.

---

## STORE SETTINGS TO PRODUCTS DEPENDENCY

Products module depends on Store Settings:

Tax dropdown      → tax_categories
Department        → store_departments
Category          → store_categories
Vendor            → store_vendors
Age restriction   → store_age_restriction_presets
Deal links        → promotion_products

Store Settings must be configured before
Products can be used effectively.

---

## PLATFORM TABLES

Platform tables are superadmin-managed unless
existing code says otherwise.

Known platform/global tables:
platform_plans
global_vendors
vendor_promotions

Known columns may include:
name
code
price_monthly
max_stores
max_users_per_store

Inspect the actual schema before using or changing
platform tables.

Do not invent columns.

Store owners should only read platform plans unless
a task explicitly changes that behavior.

---

## ENVIRONMENT VARIABLES

NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY  server-side only
NEXT_PUBLIC_SITE_URL       for auth redirects

For auth redirectTo URLs use:
process.env.NEXT_PUBLIC_SITE_URL
OR window.location.origin in client components

Never hardcode localhost or production URLs.
Never expose SUPABASE_SERVICE_ROLE_KEY in
client-side code.
