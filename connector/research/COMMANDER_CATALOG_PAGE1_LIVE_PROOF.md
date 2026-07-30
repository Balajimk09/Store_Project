# Commander Catalog Page-One Live Proof

Date: 2026-07-29

Source branch: `research/commander-catalog-discovery`
Source HEAD: `93c4cbc5c712f4f325511a4beceb4e28aab65a37`

## Executed Package

- ZIP: `StorePulse-Connector-Commander-Catalog-Page1-Structure-93c4cbc.zip`
- ZIP SHA-256: `569FE0CD3728D0288E3FCF06A7EF8CB74CAE860D705836696E998DA8B1A1137D`
- ZIP size: `7681` bytes
- Runner SHA-256: `536136C405828F304DAC88ED930E54F2C58C42C837670F14FDACCDB8013B1AF0`
- Node client SHA-256: `654C2EE62B403B9AF0D8A77A0AE949F803FF8A03A2F9AD43ED3D4F9829A08356`

## Fixed Request Classification

The supervised run used one authenticated, read-only `vPLUs` request with page
`1`, page size `100`, and no `query` or `where`. It had one-request maximum
and no retry behavior.

## Execution Safety Record

- Service before: `Running`, PID `4400`
- Service after: `Running`, PID `4400`
- Outer timeout: `false`
- Runner exit code: `0`
- Stdout: `647` bytes
- Stderr: `0` bytes
- Run guard before: `false`
- Run guard after: `true`

## Sanitized Result

```json
{
  "operation": "discover_catalog_page1_structure",
  "authentication_succeeded": true,
  "catalog_request_attempted": true,
  "catalog_request_succeeded": true,
  "request_page": 1,
  "request_page_size": 100,
  "query_present": false,
  "where_present": false,
  "response_structure_valid": true,
  "response_size_bucket": "16385-65536",
  "root_local_name": "PLUs",
  "root_namespace_matches_expected": true,
  "record_element_candidate": "PLU",
  "record_count_bucket": "51-100",
  "pagination_candidate_names": ["page", "ofPages"],
  "raw_response_retained": false,
  "product_values_retained": false,
  "write_attempted": false,
  "session_disposed": true,
  "error_code": null,
  "failure_stage": null,
  "exception_type": null
}
```

## Live-Proven Facts

- Installed PowerShell-first authentication and one authenticated session worked.
- The exact unfiltered page-one request completed once without retry.
- The response root was `PLUs` in the expected namespace, with `PLU` as the
  structural record candidate.
- The response exposed structural candidate names `page` and `ofPages`.
- No raw response or product values were retained, no write was attempted, and
  session disposal succeeded.
- The production service was not restarted and its PID did not change.

## Remaining Unproven Facts

- The values of `page` and `ofPages`, total page count, page-two availability,
  page-two request behavior, record ordering, and pagination stability.
- Inactive or deleted product representation, complete catalog coverage, full
  catalog synchronization, StorePulse import, and all Commander writes.

The candidate names `page` and `ofPages` are not complete pagination proof.

## Rerun Prohibition

Do not rerun this page-one diagnostic. The existing HUB run guard must not be
deleted merely to permit another page-one execution.
