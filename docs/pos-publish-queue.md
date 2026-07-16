# POS Publishing Queue Foundation

## Purpose

`pos_publish_jobs` is an internal queue for future connector-mediated POS changes. This foundation supports only one operation: `update_price`. It does not send Commander requests, manage Commander sessions, produce XML, or support promotions.

## Queue contract

Each row is assigned to exactly one active `store_pos_connectors` record when it is created. The payload is structurally limited to `{ "price": <positive numeric> }`; the table intentionally has no XML, command, Commander URL, credential, cookie, session, or token column.

Jobs are created by the server-side `enqueueUpdatePriceJob` helper. It verifies the requesting owner owns the selected store, verifies that the product belongs to that store, requires exactly one active connector, validates the price, and enforces an idempotency key before inserting a pending job.

The database permits only these transitions:

```text
pending -> claimed -> sending -> verifying -> completed
                                           -> failed
                   -> failed
pending -> cancelled
claimed -> pending  (future retry/release path)
```

The connector claim must name the row's assigned connector. Terminal jobs are immutable except for `audit_metadata`; raw Commander request/response content and credentials are prohibited from that metadata.

## Access model

- Store owners can view jobs for stores they own through RLS.
- Authenticated clients receive no direct insert, update, or delete permission on the queue.
- Admin and superadmin inspection is server-side only through `listPosPublishJobsForAdmin`, which uses the established `getEffectiveStaffAccess` permission model. `connectors.view`, `stores.view`, or superadmin access is required.
- A future connector worker must use a server-side, connector-authenticated claim/completion path. This migration enforces assigned-connector transitions but deliberately does not add connector runtime code.

## Operations deliberately excluded

- Commander login, session handling, URLs, requests, XML, or tokens.
- Promotion, deal, or other pricebook operations.
- Production connector changes, deployments, and polling workers.

## Tests

Run the offline foundation tests with:

```bash
npm run test:pos-publish-jobs
```

The tests cover authorization, price-only payload validation, duplicate idempotency handling, and permitted status transitions. Database RLS and trigger enforcement are represented by the migration and should be exercised in a local Supabase integration test before a connector worker is introduced.

### Local SQL integration tests

The SQL integration runner uses only the already-running local Supabase Postgres instance at `127.0.0.1:54322`. It rejects non-local connection targets, starts one transaction, creates temporary auth/store/product/connector fixtures, and rolls the transaction back after every run. It does not call Supabase CLI, apply migrations, change migration history, or contact a linked or remote project.

```bash
npm run test:pos-publish-jobs:sql
```

Start the local Supabase stack first. The runner verifies the actual `pos_publish_jobs` constraints, trigger transitions, indexes, and owner-scoped RLS policies; it does not print database credentials or fixture data.
