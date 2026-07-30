# Commander Pagination Metadata Live Failure Analysis

Date: 2026-07-29

## Scope And Provenance

This is an offline source and synthetic-fixture analysis of the single supervised
pagination-metadata run. It does not reconstruct, retain, or describe the
Commander response body.

- Package: `StorePulse-Connector-Commander-Pagination-Metadata-eddb077.zip`
- Package SHA-256: `8FB42C0E6ACE53C518EF50B3F8D18C35E7AF435DDAB63441F743AC9297BFFB52`
- Package size: `7461` bytes
- Runner SHA-256: `DFEDA8C1244A665D26E5EB4144329163C26EDFE64940413957C4CD1A03908817`
- Node client SHA-256: `D634A0C414C430BF44F62C5498D224FAD23A39445881E39BEAD3CDA948D7CEA5`

The run did not reach its outer timeout. It exited `1`, emitted bounded stdout
and no stderr, disposed its session, created the separate pagination marker,
and left the production service Running with the same PID. The existing page-one
marker remained intact. Neither diagnostic may be rerun and neither marker may
be deleted, bypassed, or reused.

## Sanitized Live Result

```json
{
  "operation": "discover_commander_pagination_metadata",
  "authentication_succeeded": true,
  "pagination_request_attempted": true,
  "pagination_request_succeeded": false,
  "request_page": 1,
  "request_page_size": 100,
  "query_present": false,
  "where_present": false,
  "response_structure_valid": false,
  "page_field_present": false,
  "of_pages_field_present": false,
  "page_source_kind": "none",
  "of_pages_source_kind": "none",
  "page_value_unambiguous": false,
  "of_pages_value_unambiguous": false,
  "current_page_is_one": null,
  "of_pages_bucket": "unknown",
  "more_pages_present": null,
  "pagination_metadata_valid": false,
  "raw_response_retained": false,
  "product_values_retained": false,
  "write_attempted": false,
  "session_disposed": true,
  "error_code": "pagination_metadata_invalid",
  "failure_stage": "pagination_metadata_validate",
  "exception_type": null
}
```

The prior page-one structure run live-proved root `PLUs`, the expected namespace,
record candidate `PLU`, and structural candidate names `page` and `ofPages`.
It did not retain their paths, representations, values, or response body.

## Failure Path Trace

| Boundary | Source block | Input and output | Failure behavior | Live reachability |
| --- | --- | --- | --- | --- |
| Fixed request | pagination client `PAGE1_XML`, `buildPage1Body` | Fixed page-one XML and in-memory cookie become one `vPLUs` body | Invalid input throws a safe Node code | Reached: the runner set request attempted after authentication |
| HTTP acquisition | `requestPage1` | HTTPS response bytes enter the bounded collector | Transport, timeout, CA, input, oversized response, or non-success status yield a safe empty result or throw to CLI handling | Not proven successful by the live result |
| Byte and UTF-8 validation | `analyzePagination` | Bounded bytes become strict UTF-8 text | Oversize and invalid UTF-8 throw safe codes | Not proven reached |
| XML inspection | `inspect` | XML tags produce bounded stack/name/attribute observations | Unsafe, malformed, or over-limit XML throws a safe code | Not proven reached |
| Candidate discovery | `inspect` and element-text regular expression | `page` and `ofPages` attribute candidates plus direct-text element candidates | Missing candidates return metadata-missing from `analyzePagination` | Not proven reached |
| Numeric and ambiguity checks | `number`, `values`, `bucket`, `analyzePagination` | Candidate text becomes positive normalized integers and a safe bucket | Missing, ambiguous, or invalid metadata returns a Node safe code | Not proven reached |
| Node result construction | `empty`, `analyzePagination`, CLI catch | Exactly fifteen bounded fields | CLI catch replaces thrown analysis/transport failure with `empty(safe-code)` | Live result is consistent with this empty-result path |
| PowerShell child validation | runner `Invoke-Child` | Ordered fifteen-field JSON becomes a child object | Child start/stream/JSON/contract failure maps to a transport or parse stage | Reached sufficiently to return bounded public JSON |
| Public request-success assignment | runner main `try` block | `$success` copies only `child.request_succeeded` | It is not independently recomputed | Live `false` proves only that the child object carried `false` |
| Public failure mapping | runner main `try` block | Any child with false metadata becomes public metadata-invalid | The child `safe_error_code` is not propagated | Reached: this created the observed public pair |
| Cleanup and final result | runner `finally`, `Result` | Runner-owned safe state becomes twenty-six public fields | Cleanup can override with disposal failure | Reached: session disposed true |

## Client Comparison

| Topic | Page-one structural client | Pagination metadata client |
| --- | --- | --- |
| Parser model | Tag tokenization plus bounded tree of root/direct children | Tag tokenization for attributes and stack safety, plus a second direct-text element scan |
| Prefix handling | `local(name)` removes a prefix | Same `local(name)` for attributes; element expression accepts an optional prefix |
| Structural scope | Root attributes, direct-child names, and direct-child attributes | Attributes at every parsed depth; element text only when no child markup exists |
| Candidate rule | Direct root-child name or root/direct-child attribute name matching a pagination-like pattern | Exact local name `page` or `ofPages` only |
| Self-closing elements | Direct-child names are visible | Element text scan cannot observe them; only attributes whose names are `page` or `ofPages` are candidates |
| Nested elements | Not included in pagination candidate names | Direct text can be found at bounded nested depth |
| Whitespace | Names only; no numeric parsing | Numeric text is strict decimal with no whitespace |
| Duplicates | Deduplicated names | Deduplicated normalized numeric values; distinct values are ambiguous |
| Root validation | Root name and expected namespace are reported | No root-name or namespace validation is performed |
| Bounds | Depth 8, elements 5000, attributes 5000, names 128 | Same bounds |

## Synthetic Differential Results

All fixtures were invented locally and were not treated as Commander evidence.

| Synthetic shape | Structural client candidate names | Metadata client outcome | Classification |
| --- | --- | --- | --- |
| Direct-text metadata elements | Both names | Present and valid | No differential behavior |
| Root attributes with exact names | Both names | Present from attributes and valid | No differential behavior |
| Nested metadata elements | Not reported structurally | Present and valid | Metadata client is broader here |
| Prefixed or unprefixed direct-text elements | Both names | Present and valid | No differential behavior |
| Direct self-closing elements named `page` and `ofPages` | Both names | Both absent, metadata-missing | PROVEN POSSIBLE FROM SOURCE |
| Direct named containers whose numeric data is in differently named attributes | Both names | Both absent, metadata-missing | PROVEN POSSIBLE FROM SOURCE |
| Direct named containers with child numeric elements | Both names | Both absent, metadata-missing | PROVEN POSSIBLE FROM SOURCE |
| Metadata before or after records | Both names | Present and valid | No differential behavior |
| Whitespace-only numeric mismatch, conflicts, or excessive depth | Names may be structural candidates or parsing may fail | Invalid, ambiguous, or bounded structural failure | PLAUSIBLE BUT UNPROVEN for the live response |

These source-proven differential shapes establish that the earlier structural
candidate-name result does not prove the metadata client would discover usable
numeric values. They do not establish that any such shape occurred live.

## Request-Success And Error Semantics

`analyzePagination` sets `request_succeeded` and `response_structure_valid` to
true before metadata validation. A metadata-only failure therefore retains a
true request result in the Node object. The PowerShell runner copies that value
unchanged; it does not later turn it false.

By contrast, `requestPage1` returns an `empty` result for non-success HTTP
status, and the Node CLI catch returns `empty(safe-code)` for thrown transport,
byte, UTF-8, XML, or structure failures. Those empty results have both request
and structure false. The observed live values are therefore consistent with an
empty child result, not with the Node metadata-only missing/ambiguous/invalid
return path.

The runner then sees `pagination_metadata_valid=false` and unconditionally
publishes `pagination_metadata_invalid` at `pagination_metadata_validate`. It
does not use the Node child `safe_error_code`. This means the public pair is not
unique to absent fields: it can mask HTTP rejection, transport, timeout, CA,
response-size, UTF-8, XML, structure-limit, and other child safe failures.

Classification: **RESULT-CONTRACT DEFECT IDENTIFIED**. `pagination_request_succeeded`
is internally consistent with the current code, but the final public error
mapping conflates child failure classes with metadata validation. The live result
does not prove a successful HTTP response, a parsed XML response, or absent
metadata.

## Supported Conclusion And Next Action

Classifications:

- **A. PARSER DEFECT IDENTIFIED:** source and synthetic fixtures prove concrete
  shapes where page-one structural discovery reports both names while the
  metadata parser finds neither usable candidate.
- **D. RESULT-CONTRACT DEFECT IDENTIFIED:** source proves the public metadata
  error overwrites the Node child safe error for every invalid-metadata result.
- **B. RESPONSE FORMAT STILL UNKNOWN:** the live sanitized output cannot choose
  between the child empty-result paths or an unobserved response shape.

Smallest safe next action: make an offline, narrowly scoped result-contract
correction so the runner preserves an approved Node child safe error and keeps
request success distinct from metadata validity. Then re-evaluate whether a new,
separately guarded one-time structural-path diagnostic is justified. Do not
build or execute that diagnostic in this checkpoint.

Page two, exact page count, full synchronization, StorePulse import, and all
Commander writes remain blocked.

## Offline Result-Contract Correction (2026-07-29)

The PowerShell runner previously copied the validated child fields and then
unconditionally replaced every non-valid metadata result with public
`pagination_metadata_invalid` at `pagination_metadata_validate`. That overwrote
the child safe error and made the live result non-specific.

The runner now accepts only this exact, case-sensitive child safe-error
allowlist after validating the ordered fifteen-field contract:

| Child safe error | Public failure stage |
| --- | --- |
| `invalid_input` | `pagination_transport_start` |
| `invalid_origin` | `pagination_transport_start` |
| `ca_file_invalid` | `pagination_transport_start` |
| `transport_failed` | `pagination_transport` |
| `timeout` | `pagination_transport` |
| `response_too_large` | `pagination_transport` |
| `http_rejected` | `pagination_transport` |
| `invalid_utf8` | `pagination_response_parse` |
| `xml_invalid` | `pagination_response_parse` |
| `xml_unsafe` | `pagination_response_parse` |
| `structure_limit_exceeded` | `pagination_response_parse` |
| `pagination_metadata_missing` | `pagination_metadata_validate` |
| `pagination_metadata_ambiguous` | `pagination_metadata_validate` |
| `pagination_metadata_invalid` | `pagination_metadata_validate` |
| `result_too_large` | `pagination_response_parse` |
| `unexpected_failure` | `pagination_response_parse` |

Unknown, wrong-case, empty, numeric, object, and array child error values are
not copied. They fail closed as the runner-owned
`pagination_response_parse` classification. A null child error retains null on
valid success; only a null child error combined with invalid metadata receives
the generic metadata-validation result.

The correction also separates the independently validated child
`response_structure_valid` value from `pagination_metadata_valid` in the public
result. It does not change the request, Node client, TLS behavior, guard,
cleanup, response parsing, or pagination extraction.

Temporary-copy executable tests exercised every allowlisted code, every rejected
error form, null-code success and metadata-invalid paths, independent request /
structure / metadata fields, existing overflow and timeout paths, field-order
validation, guard behavior, null-child handling, and cleanup precedence.

This correction does not identify the actual live Commander response or choose
between the separately identified parser mismatch and the previously ambiguous
child failure paths. Neither existing diagnostic may be rerun. Any future live
diagnostic requires a new identifier and a new guard.

## Closure Boundaries

The fixed command is `vPLUs`, with page `1`, page size `100`, no query, and no
where clause. It permits a maximum of one request and zero retries. The
page-two request is prohibited. No Supabase action or Commander write is performed, and no raw XML
or product values are retained.

The live attempt proved authentication and child entry, bounded safe output,
pagination-guard creation, and session cleanup. It did not prove HTTP success,
parsed XML, missing metadata, metadata location, or element-versus-attribute
representation. Parser differential shapes were proven only by synthetic
offline fixtures; no synthetic shape is claimed to be the live response. The
offline result-contract correction likewise does not reveal the live response
shape.

Neither the page-one structure diagnostic nor the pagination-metadata diagnostic
may be rerun. Both existing guards must remain intact. Any future diagnostic
requires a new identifier and a new guard. Exact page count, page two, full
synchronization, StorePulse import, and all writes remain blocked.
