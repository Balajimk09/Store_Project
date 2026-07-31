## POS Catalog Pilot Tables

The catalog workflow remains POS-independent. Commander is an adapter, not a permanent top-level application domain.

### `pos_catalog_sync_runs`

Purpose: One row per normalized POS catalog preview/import attempt.

Rules:
- Scope every row by `store_id` and `owner_id`.
- Initial pilot mode is `selected_products` with 1–10 identities.
- `selected_products` runs must use `catalog_complete = false`.
- Only trusted server/service-role code may write.
- Authenticated store owners receive owner-scoped read access.
- Never store credentials, cookies, raw XML, Commander addresses, or raw POS payloads.

### `pos_catalog_sync_items`

Purpose: Normalized source product records awaiting matching and manual approval.

Rules:
- Use POS-neutral names such as `source_values` and `source_payload_hash`.
- Do not create deactivation candidates from selected-products runs.
- Do not insert directly into `products` without an audited approval transaction.
- Transaction data may be stored only as bounded evidence metadata.

### `product_source_identities`

Purpose: Stable mapping between a StorePulse product and a source-system product key.

Rules:
- Unique scope is `store_id + source_system + source_product_key`.
- Commander pilot key is the normalized UPC-plus-modifier identity.
- Repeated imports must use this mapping to prevent duplicate StorePulse products.
- Do not add Commander-only identity columns to `products`.

### `product_history`

Purpose: Append-only product catalog lifecycle and synchronization audit events.

Rules:
- Store bounded change metadata only.
- No raw XML, credentials, cookies, or secrets.
- Publishing events are not permitted until a separately approved guarded-write milestone.
