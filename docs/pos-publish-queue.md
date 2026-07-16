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

## Connector publish API contract

`claim-pos-publish-job` and `report-pos-publish-job-status` are connector-authenticated Edge Functions. They use the existing `x-storepulse-connector-token` hash lookup only to resolve the connector server-side. Request bodies never select a connector, store, owner, database URL, command, XML payload, or credential.

The Edge Functions call service-role-only database RPCs. `claim_pos_publish_job` locks the oldest pending row for the authenticated connector with `FOR UPDATE SKIP LOCKED`, verifies the connector/store/product relationship, and returns only the product UPC, two-decimal requested price, and fixed update_price operation. Invalid product relationships, UPCs, or requested prices are safely terminal-failed without returning a job.

`report_pos_publish_job_status` accepts only `sending`, `verifying`, `completed`, or `failed`. Completion requires a canonical UPC and price matching the queued values. Failure codes are allowlisted and messages are short, sanitized, and rejected if they resemble credentials, URLs, XML, or request dumps. The worker never receives a service-role key.

Both connector endpoints accept `POST` with `Content-Type: application/json` only. They read request streams with an 8 KiB limit before JSON parsing, reject empty or malformed input, and require price strings with exactly two decimal places such as `1.25`. Failure messages are limited to 240 printable characters and reject credentials, authorization schemes, tokens, API keys, stack traces, request/response dumps, URLs, XML-like data, JWT-shaped strings, and long secret-shaped values. Rejected input is never echoed or stored.

The claim and report RPCs are executable only by `service_role`; the Edge Functions resolve connector identity from the hashed `x-storepulse-connector-token` server-side and never accept connector, store, or owner identity from a request body. Connector authentication and worker processing are not deployed by this change.

Run the local contract tests after `npx supabase@2.109.1 db reset --local`:

```bash
npm run test:connector-publish-api
npm run test:pos-publish-jobs:rpc-sql
```

The standard RPC tests roll their fixtures back. The concurrency case must use two separately committed local sessions so `FOR UPDATE SKIP LOCKED` can be tested accurately; its uniquely generated auth, store, product, connector, and queue fixtures are removed in a `finally` block and then verified absent. It never contacts a linked or remote database.
