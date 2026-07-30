# Commander Pagination Metadata Evidence

The page-one live proof completed on 2026-07-29 with response root `PLUs`,
record candidate `PLU`, and structurally discovered candidate names `page` and
`ofPages`. Their values and paths were not retained.

This diagnostic searches bounded XML structure for both local names as either
element text or attribute values. It accepts metadata only when the numeric
values are positive, unambiguous, internally consistent, and `page` is one.
It exposes only an `ofPages` bucket, never an exact total.

It issues the fixed page-one request once. A successful result does not prove
page-two behavior, stable pagination, or full catalog coverage.

## Fixed Request And Safety Boundaries

The fixed read-only command is `vPLUs`. It requests page `1` only with page
size `100`. No query is present and no where clause is present. The maximum
request count is exactly one and the retry count is zero. The page-two request
is prohibited.

The diagnostic retains no raw XML, product values, or exact `ofPages` value. It
does not attempt a Commander write or any Supabase action, and it does not
modify or restart StorePulseConnector.

The supervised live attempt authenticated successfully and attempted one
page-one request. It emitted bounded safe output with empty stderr, disposed the
session successfully, created the pagination run guard, and left the production
service Running with the same PID. Pagination metadata was not proven, and the
actual Commander response shape remains unknown. This does not establish HTTP
success, valid XML, or absence of Commander metadata.
