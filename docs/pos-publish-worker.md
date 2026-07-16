# Offline POS Publish Worker Foundation

This branch contains an offline, dependency-injected worker foundation for the `update_price` publishing job only. It is not connected to the production connector, StorePulse production APIs, Supabase, or Commander.

## Boundaries

- The existing Windows connector, service configuration, heartbeat behavior, and Commander integration are untouched.
- The Commander adapter is an interface with mocked implementations in tests. It contains no networking, authentication, cookies, URLs, certificate handling, XML, commands, or browser-session reuse.
- The API client accepts injected `fetch` only. Tests use local mock responses and never contact Supabase or Commander.
- Production deployment order remains: database migration, Edge Functions, local/CI validation, then a separately approved controlled connector upgrade.

## State Flow

For at most one job per worker execution, the worker performs:

1. Claim one `update_price` job.
2. Report `sending`.
3. Call `adapter.updatePrice({ upc, price })`.
4. Report `verifying`.
5. Call `adapter.readProduct({ upc })`.
6. Require an exact UPC and two-decimal price match.
7. Report `completed` with only the verified UPC and price.

Expected failures report only allowlisted codes: `commander_auth_failed`, `commander_unreachable`, `commander_tls_failed`, `plu_not_found`, `plu_identity_mismatch`, `update_rejected`, `verification_failed`, `job_expired`, or `internal_connector_error`.

The worker reports these safe outcomes without exposing transport or adapter exceptions:

- `idle`: the API returned 204/no work.
- `invalid_claim`: an injected or received claim did not meet the strict local contract; no status report or Commander call occurs.
- `commander_failed`: Commander work or verified readback failed; the worker attempts one safe `failed` report.
- `status_report_failed`: a StorePulse status report failed. A failed `sending` report prevents Commander work; a failed `verifying` report prevents readback; a failed `completed` report never triggers a later `failed` report or a second update.
- `completed`: the completed status was successfully reported.
- `internal_error`: a safe local initialization/internal failure, such as an injected clock failure. No Commander operation or status report occurs, no internal details are exposed, and the active guard is released so a later cycle can run.

## API Client Safety

- Remote base URLs must be HTTPS regardless of URL-scheme casing. HTTP is accepted only for these exact literal test origins, with an optional valid port: `localhost`, `127.0.0.1`, and `[::1]`. Alternate/encoded loopback spellings, credentials, paths, queries, and fragments are rejected.
- Requests use fixed claim/report paths, `redirect: 'manual'`, `credentials: 'omit'`, and an abort-based timeout.
- JSON responses must be `application/json` with an optional charset. `Content-Length` is checked before streaming and the stream is still bounded before parsing.
- Claim and report shapes are strict allowlists. Price values must be positive strings with exactly two decimal places. Publish UPCs are JSON strings containing exactly 14 ASCII digits; leading zeros are significant and a PLU may never substitute for a UPC. Claim timestamps must be strict RFC3339 values with date, time, seconds, and a timezone.
- Connector tokens are supplied only as a request header, never returned, logged, or included in thrown error text.

## Logging and Idempotency

Logs are structured and limited to event, job ID, operation, attempt, status, safe error code, and duration. UPCs are intentionally omitted. Logger failures are swallowed completely: they cannot alter queue state, trigger a failure report, escape the worker cycle, or retry Commander work. Raw request/response bodies, headers, credentials, tokens, URLs, XML, stack traces, and Commander output are never logged.

The database/API contract remains the durable idempotency boundary. The worker also revalidates every injected claim before logging, status reporting, guards, or Commander work. Its in-flight guard is released in `finally` on every outcome, including an injected clock failure. The process-lifetime job guard is added only after `sending` succeeds and immediately before Commander work, so a failed `sending` report does not suppress a later retry. Once Commander work may have begun, the job remains guarded for the process lifetime. This foundation intentionally has no retry or backoff loop; a future runner must inject and control that behavior.

## Local Tests

Run only the offline test suites:

```powershell
npm run test:pos-publish-api-client
npm run test:pos-publish-worker
```

Neither command starts the worker, calls Commander, or sends requests to a real StorePulse endpoint.
