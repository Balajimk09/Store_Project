# Existing Catalog-Sync Review

Reviewed source: read-only bundle from the original dirty repository on July 30, 2026.

## Reuse

The following concepts/files are retained:

- bounded generic pagination collector;
- POS-neutral provider scope and normalized product contract;
- deterministic, order-independent hashing;
- connector-authenticated, preview-only architecture;
- no raw XML, cookie, credential, or automatic apply path.

## Replace

The following original work must not be transferred as-is:

- migrations `20260717120000_add_pos_catalog_sync.sql` and `20260717130000_add_connector_catalog_preview_idempotency.sql`;
- direct Commander-specific columns on `products`;
- authenticated-owner insert/update RLS on staging tables;
- `commander_values` and `commander_payload_hash` database column names;
- full-catalog-only runtime requiring `catalog_complete=true`;
- pending Commander publish intents created during browser conflict resolution;
- stale Commander provider shell that predates merged PRs #13 and #14;
- the full dirty Products page patch.

## Why

The initial pilot is a bounded selected-products import, not a complete catalog. It must never create deactivation candidates. Commander identity belongs in `product_source_identities`, not in Commander-specific columns on the generic `products` table. Store owners may read staging rows but cannot directly fabricate or alter source records through the Supabase Data API.

## Current checkpoint scope

This package adds only:

- revised additive staging/source-identity/history migration;
- reusable pagination/provider contracts;
- a bounded selected-products contract and tests;
- selected pilot configuration.

It does not add API routes, UI changes, live Commander execution, product approval, or publishing.
