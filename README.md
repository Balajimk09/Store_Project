# StorePulse AI

StorePulse AI is an AI-powered back-office platform for convenience stores and gas stations. It helps store owners understand sales, fuel performance, cashier activity, inventory, pricebook data, and daily close reports in one dashboard.

The project is built as a startup-style MVP focused on real convenience store workflows such as POS data imports, pricebook management, fuel sales reporting, cashier audit tracking, store settings, and reporting insights.

## What StorePulse AI Does

StorePulse AI gives store owners a simple way to:

* Upload transaction and pricebook CSV files
* Track daily sales, merchandise sales, and fuel sales
* Review cashier performance and exception activity
* Analyze refunds, voids, no-sales, and risky cashier behavior
* Manage product pricing, departments, vendors, tax categories, and EBT eligibility
* Track fuel gallons, fuel sales, fuel cost, and gross profit by fuel grade
* Review payment reports grouped by tender type such as credit, debit, cash, mobile, EBT, and coupons
* Prepare for future POS/register integrations and AI-based reporting

## Key Features

### Dashboard

* Net sales overview
* Merchandise sales
* Fuel sales
* Low-stock product alerts
* Quick business insights

### Upload POS Data

* Manual CSV upload for transaction history
* Manual CSV upload for pricebook/product catalog
* Upload preview and validation
* Upload history tracking
* Designed for future automated POS/register pipeline integration

### Pricebook Management

* Add and edit products
* Manage UPC, product name, department, brand, vendor, cost price, selling price, stock, reorder level, tax category, taxable status, EBT eligibility, active status, and notes
* Compact product table for quick review
* Cloud save using Supabase

### Store Settings

* Manage tax categories
* Manage departments
* Mark departments as EBT eligible
* Manage vendors and sales rep details
* Prepare promotions/deals such as quantity-based offers

### Reports

* Day close report
* Merchandise report
* Fuel report
* Payment report
* Cashier report
* Date range presets including Today, Yesterday, This Month, This Quarter, This Year, Till Date, and Custom Range
* CSV export support

### Fuel Reporting

* Fuel sales by grade
* Gallons sold by grade
* Average selling price
* Average cost
* Fuel cost
* Fuel gross profit
* Supports grades such as Regular, Plus, Premium, Diesel, E10, and 100UL

### Cashier Audit

* Cashier sales summary
* Refund tracking
* Void ticket tracking
* Void line tracking
* Error correct tracking
* No-sale tracking
* Risk factor scoring
* Cashier detail view with filters

## Tech Stack

* Next.js
* React
* TypeScript
* Tailwind CSS
* Recharts
* Supabase
* GitHub

## Database

StorePulse AI uses Supabase for authentication and cloud data storage.

Main tables include:

* stores
* upload_batches
* transactions
* products
* store_settings
* store_departments
* tax_categories
* store_vendors
* promotions
* promotion_products

## Environment Variables

Create a `.env.local` file in the project root.

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

Do not commit `.env.local` to GitHub.

## Run Locally

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Build the project:

```bash
npm run build
```

## Project Status

Current progress:

* Authentication is working
* Store setup is working
* Dashboard is working
* Transaction upload is working
* Pricebook upload is working
* Product management is working
* Store settings foundation is working
* Reports are partially complete and improving
* Fuel reporting and fuel management are in progress
* Cashier audit and cashier detail reporting are in progress

## Roadmap

Planned improvements:

* Add full fuel ordering workflow
* Add tank reading upload and fuel reorder prediction
* Connect live POS/register integrations
* Improve AI assistant with real business insights
* Add promotion/deal builder
* Add vendor ordering workflows
* Add advanced cashier risk detection
* Add role-based access control for store employees
* Add more detailed close-day report matching real gas station reports

## About This Project

StorePulse AI is built as a practical MVP for convenience store and gas station owners. The goal is to reduce manual back-office work, make daily reports easier to understand, and give small store owners better visibility into sales, fuel, inventory, and cashier performance.
