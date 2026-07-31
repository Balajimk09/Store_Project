# Commander Pagination Representation Diagnostic Design

Date: 2026-07-30

## Background

The completed page-one structural diagnostic live-proved a bounded authenticated
read-only request and structurally observed the fixed target names `page` and
`ofPages`. The completed pagination-metadata diagnostic also authenticated,
attempted one request, emitted bounded output, created its guard, and disposed
its session, but did not prove HTTP success, XML parsing, usable metadata, or
the actual response representation.

Offline comparison proved only synthetic differential shapes: self-closing
target elements, target containers with differently named attributes, and
target containers with child elements. No synthetic shape is asserted to be the
live response.

## Objective And Non-Goals

The proposed diagnostic distinguishes transport/parse failure from a bounded
description of how the two fixed target names are represented. It never exposes
response text, XML, paths, dynamic names, values, products, or exact counts.

It does not request page two, traverse a catalog, import, synchronize, write,
publish, alter authentication, copy production modules, or modify the service.
It does not expose the page value, `ofPages` value, page count, record count,
or a claim that a structural class identifies the prior live response.

## Fixed Request And Reusable Architecture

The request remains exactly one read-only `vPLUs` request for page `1` with page
size `100`, no query, no where clause, and zero retries. No caller input changes
the command, body, endpoint, certificate path, or limits.
No Supabase action, Commander write, or StorePulseConnector modification or
restart is permitted.

```text
direct PowerShell runner
  -> installed machine config and secrets modules
  -> installed current-shift authentication/session functions
  -> one bounded Node HTTPS child using stdin-only session material
  -> bounded in-memory representation analysis
  -> session cleanup
  -> one sanitized JSON result
```

TLS, CA trust, hostname verification, certificate validation, request timeout,
child deadline, stdout/stderr draining, single stdin close, and COM cleanup
reuse the merged pagination implementation. The old direct-text-only element
expression must not be the sole discovery mechanism.

## Pinned Executable Transport Contract

The representation child must use a small diagnostic-specific Node wrapper that
imports `resolveCommanderTlsTrust` from
`lib/commander/session/commander-tls-trust.mjs` and `sendCommanderNaxml` from
`lib/commander/commander-naxml-client.mjs`. It must not duplicate TLS,
certificate parsing, hostname verification, or peer-pin logic.

The child stdin contract is exactly one ordered JSON property:

1. `session_cookie`: a nonempty string of at most 4096 characters that contains
   no C0/C1 control character, `&`, or `=`. It is retained only in memory,
   passed only to `sendCommanderNaxml`, and never emitted.

The wrapper reads no trust material from stdin. It loads only
`C:\\ProgramData\\StorePulse\\config.json`, validates the source-proven
`commander_ip` host shape, and derives the origin as
`https://{commander_ip}`. It calls `resolveCommanderTlsTrust` with that fixed
configuration and `C:\\ProgramData`. The resolver accepts only the fixed
certificate files `StorePulse\\certificates\\commander-ca.pem` and
`StorePulse\\certificates\\commander-server.pem`; it rejects missing,
reparse, nonregular, oversized, malformed, or hash-mismatched files.

The resolver validates configured `commander_tls_server_name`,
`commander_tls_peer_sha256`, and `commander_tls_ca_bundle_sha256`. It hashes the
configured server-certificate PEM's decoded DER with SHA-256, normalizes the
expected peer hash to uppercase hexadecimal, and returns an in-memory trust
object. `sendCommanderNaxml` uses that object unchanged: its HTTPS agent keeps
`rejectUnauthorized: true`, validates the supplied CA chain, applies Node's
`checkServerIdentity` to the configured server name, hashes the live peer
certificate `raw` DER with SHA-256 uppercase hexadecimal, and compares it by
exact string equality to `peerSha256`. A peer mismatch is internally reported
as `commander_tls_peer_mismatch`; hostname mismatch is internally reported as
`commander_tls_hostname_invalid`.

The public 21-field representation contract does not admit either internal TLS
literal. The wrapper must normalize all trust-loading, peer-pin, hostname, and
other TLS transport failures to the existing allowlisted `transport_failed`
without exposing their internal code, path, certificate, host, or exception
text. Existing source supplies the fixed safe generic transport code and the
underlying precise internal errors; this normalization is only at the
diagnostic-result boundary.

The wrapper constructs the fixed `vPLUs` page-one XML internally, invokes
`sendCommanderNaxml` once with the fixed 15000 ms timeout, and supplies the
bounded returned response text to the representation parser as UTF-8 bytes.
There is no retry, HTTP fallback, caller-controlled request field, or alternate
trust path. Importing the wrapper must have no stdin, filesystem, network, or
stdout side effect; only direct execution may read stdin and write one compact
21-field result.

The future package closure must include the diagnostic wrapper, the
representation parser client, `commander-naxml-client.mjs`, and
`commander-tls-trust.mjs`. Their imports are Node built-ins only. Runtime also
requires the fixed ProgramData config and certificate files above plus the
installed Node runtime. Existing small diagnostic package builders use explicit
runtime-file manifests and do not automatically compute this transitive
closure, so a future package builder must list and hash every file explicitly.

Earlier selected-product, page-one, and pagination-metadata diagnostic Node
clients used CA trust and normal hostname validation, but source does not show
explicit peer-fingerprint comparison in those clients. Their PowerShell COM
authentication connection does not protect a separate Node HTTPS connection.
Neither completed diagnostic may be rerun; this representation diagnostic must
not repeat that unpinned Node transport model.

## New Identifier And Guard

- Identifier: `commander-pagination-representation-v1`
- Guard identity: `commander-pagination-representation`
- Guard directory: `C:\ProgramData\StorePulse\diagnostics\commander-pagination-representation`

The new runner atomically creates only its own marker before authentication.
It neither deletes, reuses, renames, bypasses, inspects for mutation, nor writes
into `commander-catalog-page1-structure` or `commander-pagination-metadata`.
Those guards remain intact. The new marker remains after success or failure.

## Representation And Location Classes

The parser tracks only fixed local names `page` and `ofPages`. Each target gets
one fixed, case-sensitive representation class:

| Class | Meaning |
| --- | --- |
| `none` | No bounded target candidate was observed. |
| `root_attribute` | The target name occurred as a root attribute. |
| `descendant_attribute` | It occurred as a non-root attribute. |
| `direct_text_element` | A target element had direct text and no child element. |
| `empty_element` | An explicit start/end target had no attributes, children, or direct text. |
| `self_closing_element` | A self-closing target element was observed. |
| `element_with_attributes` | A target element had attributes only. |
| `element_with_children` | A target element had child elements only. |
| `element_with_attributes_and_children` | A target element had attributes and children. |
| `mixed_locations` | More than one compatible representation occurred. |
| `ambiguous` | Incompatible representations or conflicting normalized numeric evidence occurred. |
| `structure_unavailable` | Analysis could not safely produce a class. |

Additional per-target fixed metadata:

- depth bucket: `root`, `depth_1`, `depth_2_to_3`, `depth_4_to_6`, `over_6`,
  `none`, or `unknown`;
- candidate-count bucket: `none`, `one`, `two`, `three_to_five`, `over_five`,
  or `unknown`;
- numeric class: `no_candidate`, `empty`, `whitespace_only`,
  `unsigned_decimal`, `zero`, `negative_or_signed`, `non_numeric`, `overflow`,
  `conflicting`, or `unknown`;
- conflicting-candidates boolean.

Numeric classification is necessary to distinguish empty containers, numeric
direct text, numeric evidence in a container, and conflict without retaining
text, length, value, or range. The parser uses strict bounded positive unsigned
decimal validation internally and emits only the fixed class.

## Proposed Node Contract

The Node child emits one compact JSON object in exactly this order:

1. `request_succeeded` boolean
2. `bounded_response_received` boolean
3. `utf8_valid` boolean
4. `xml_parse_succeeded` boolean
5. `response_root_valid` boolean
6. `representation_analysis_completed` boolean
7. `page_target_detected` boolean
8. `of_pages_target_detected` boolean
9. `page_representation` fixed class
10. `of_pages_representation` fixed class
11. `page_depth_bucket` fixed bucket
12. `of_pages_depth_bucket` fixed bucket
13. `page_candidate_count_bucket` fixed bucket
14. `of_pages_candidate_count_bucket` fixed bucket
15. `page_numeric_class` fixed class
16. `of_pages_numeric_class` fixed class
17. `page_conflicting_candidates` boolean
18. `of_pages_conflicting_candidates` boolean
19. `raw_response_retained` literal `false`
20. `product_values_retained` literal `false`
21. `safe_error_code` approved literal or JSON null

## Proposed PowerShell Contract

The public runner emits one compact JSON object in exactly this order:

1. `operation` = `discover_commander_pagination_representation`
2. `authentication_succeeded` boolean
3. `representation_request_attempted` boolean
4. `representation_request_succeeded` boolean
5. `bounded_response_received` boolean
6. `utf8_valid` boolean
7. `xml_parse_succeeded` boolean
8. `response_root_valid` boolean
9. `representation_analysis_completed` boolean
10. `page_target_detected` boolean
11. `of_pages_target_detected` boolean
12. `page_representation` fixed class
13. `of_pages_representation` fixed class
14. `page_depth_bucket` fixed bucket
15. `of_pages_depth_bucket` fixed bucket
16. `page_candidate_count_bucket` fixed bucket
17. `of_pages_candidate_count_bucket` fixed bucket
18. `page_numeric_class` fixed class
19. `of_pages_numeric_class` fixed class
20. `page_conflicting_candidates` boolean
21. `of_pages_conflicting_candidates` boolean
22. `request_page` = `1`
23. `request_page_size` = `100`
24. `query_present` = `false`
25. `where_present` = `false`
26. `raw_response_retained` = `false`
27. `product_values_retained` = `false`
28. `write_attempted` = `false`
29. `session_disposed` boolean
30. `error_code` approved literal or null
31. `failure_stage` approved literal or null
32. `exception_type` allowlisted short type or null

The runner validates child field count, order, names, types, and literal domains
before copying any field. Null-child defaults use only `false`, `none`,
`unknown`, or null. Cleanup failure overrides earlier result state.

## Errors, Stages, And Exit Semantics

Existing fixed child codes remain allowed: `invalid_input`, `invalid_origin`,
`ca_file_invalid`, `transport_failed`, `timeout`, `response_too_large`,
`http_rejected`, `invalid_utf8`, `xml_invalid`, `xml_unsafe`,
`structure_limit_exceeded`, `result_too_large`, and `unexpected_failure`.
The representation client may add only `response_root_invalid` and
`representation_analysis_failed`. Arbitrary child strings fail closed.

Fixed stages are `representation_payload_build`,
`representation_transport_start`, `representation_transport`,
`representation_response_parse`, `representation_root_validate`,
`representation_analyze`, and `session_dispose`, plus existing runner, guard,
machine, connection, and authentication stages. Input/CA errors map to start;
transport/timeout/HTTP/size errors map to transport; UTF-8/XML/structure errors
map to parse; root failure maps to root validation; analysis failure maps to
representation analysis.

Exit `0` requires successful authentication, one successful bounded request,
valid UTF-8/XML/root, completed analysis, no public error, no retained data or
write, and successful cleanup. A valid structural observation with `none`,
`mixed_locations`, or `ambiguous` must have explicitly tested success semantics
before implementation. All transport, parse, contract, guard, and cleanup
failures exit `1`.

## PowerShell Public Failure Contract

`error_code` is `null` only on success. Its complete allowlist is the child
codes `invalid_input`, `invalid_origin`, `ca_file_invalid`, `transport_failed`,
`timeout`, `response_too_large`, `http_rejected`, `invalid_utf8`, `xml_invalid`,
`xml_unsafe`, `structure_limit_exceeded`, `response_root_invalid`,
`representation_analysis_failed`, `result_too_large`, and `unexpected_failure`,
plus runner-owned `preflight_failed`, `guard_already_exists`,
`guard_create_failed`, `authentication_failed`, `session_cookie_failed`,
`child_start_failed`, `child_stdin_failed`, `child_timeout`,
`child_stdout_overflow`, `child_stderr_overflow`, `child_output_missing`,
`child_output_invalid`, `child_contract_invalid`, `child_process_failed`,
`public_result_too_large`, and `cleanup_failed`.

The complete `failure_stage` allowlist is `null`, `preflight`, `guard_check`,
`guard_create`, `authentication`, `session_cookie`, `child_start`,
`child_stdin`, `child_wait`, `child_stdout`, `child_stderr`,
`child_output_parse`, `child_contract_validate`, `child_process`, `transport`,
`response_receive`, `utf8_validate`, `xml_parse`, `response_root_validate`,
`representation_analyze`, `child_output_serialize`,
`public_result_serialize`, `cleanup`, and `runner`.

| Child error | Public error | Failure stage |
| --- | --- | --- |
| `invalid_input`, `invalid_origin`, `ca_file_invalid` | same | `child_contract_validate` |
| `transport_failed`, `timeout`, `http_rejected` | same | `transport` |
| `response_too_large` | same | `response_receive` |
| `invalid_utf8` | same | `utf8_validate` |
| `xml_invalid`, `xml_unsafe` | same | `xml_parse` |
| `response_root_invalid` | same | `response_root_validate` |
| `structure_limit_exceeded`, `representation_analysis_failed` | same | `representation_analyze` |
| `result_too_large` | same | `child_output_serialize` |
| `unexpected_failure` | same | `child_process` |

Runner mappings are fixed: `preflight_failed/preflight`,
`guard_already_exists/guard_check`, `guard_create_failed/guard_create`,
`authentication_failed/authentication`, `session_cookie_failed/session_cookie`,
`child_start_failed/child_start`, `child_stdin_failed/child_stdin`,
`child_timeout/child_wait`, `child_stdout_overflow/child_stdout`,
`child_stderr_overflow/child_stderr`, `child_output_missing/child_output_parse`,
`child_output_invalid/child_output_parse`,
`child_contract_invalid/child_contract_validate`,
`child_process_failed/child_process`,
`public_result_too_large/public_result_serialize`, `cleanup_failed/cleanup`,
and runner-owned `unexpected_failure/runner`.

Child exit `0` requires a success-shaped valid contract with null child error;
exit `1` requires a valid failure-shaped contract with a non-null allowed error.
An exit/result mismatch is `child_contract_invalid/child_contract_validate`. A
nonzero exit with a valid safe child failure preserves that mapping; without a
valid child result it is `child_process_failed/child_process`.

For competing observations the first applicable result wins: child start,
stdin, timeout, stdout overflow, stderr overflow, missing output, invalid
output, invalid contract, valid child failure, then child process failure.
Timeout remains primary after forced termination. Bounded nonempty stderr with
no more-specific valid child result is `child_process_failed`; stderr contents
are never public.

The first substantive failure is preserved through cleanup. Cleanup failure
alone is `cleanup_failed/cleanup`; after an earlier failure it sets only
`session_disposed=false`. Guards are never removed. `exception_type` is exactly
`null`, `runner_exception`, or `cleanup_exception`: only unexpected primary
runner failure uses the first, and only primary cleanup failure uses the second.

Success requires null error/stage/exception, child exit 0, a valid exact child
contract with null safe error, all representation success criteria,
`session_disposed=true`, and all retained/write flags false. A guard refusal is
`guard_already_exists/guard_check` with null exception and begins neither
authentication nor child execution; atomic creation failure is
`guard_create_failed/guard_create`.

## Representation Classification Success Semantics

Diagnostic success is separate from pagination usability. It requires a
successful bounded fixed page-one request, valid UTF-8/XML/root, completed
representation analysis, an approved bounded classification, null child safe
error, and child exit `0`. It uses public `error_code=null`,
`failure_stage=null`, and `exception_type=null` after successful cleanup.

Every allowlisted classification is a diagnostic success when the exact child
contract and parser consistency rules hold. In particular, `none` is success
when its target was not detected; `mixed_locations` is success when approved
candidates occur across bounded location categories; and `ambiguous` is success
when bounded evidence cannot select one representation, including approved
conflicting-candidate evidence. None of these completed classifications is an
analysis failure or creates a public error.

`representation_analysis_failed` remains a failure only when analysis itself
could not safely complete; it is never synthesized because a completed result
is `none`, `mixed_locations`, or `ambiguous`. A completed, otherwise valid
classification with child exit `1` is
`child_contract_invalid/child_contract_validate`. A result with analysis false
and null child error, a non-allowlisted representation, or parser-inconsistent
target, candidate, numeric, depth, or conflict fields is also
`child_contract_invalid/child_contract_validate`. The runner enforces the
parser-defined consistency rules without redefining them.

Diagnostic success does not prove a page value, page count, another page,
pagination usability, traversal readiness, or synchronization readiness. It
never triggers another request. A successful inconclusive classification still
consumes the one-time guard permanently. The guard also remains after every
other success or failure; retries and page-two requests are prohibited.

Cleanup precedence is unchanged: successful cleanup produces full success; if
cleanup is the only failure after an analyzed success, the public result is
`cleanup_failed/cleanup`, `cleanup_exception`, and `session_disposed=false`.

## PowerShell Preflight and Stage Boundary Contract

Preflight occurs before guard handling, authentication, cookie acquisition, and
child creation. In order it resolves the established Node executable; validates
that the fixed package-relative pinned child is a regular file; validates its
SHA-256 as `C6EA5492EE8F982DAAC75C55BA98250E7F7641B46E58588BB099E2C63F485884`;
validates every fixed authentication/session module is a regular file; loads
those modules under terminating error handling; verifies
`New-StorePulseCommanderConnection` and
`Get-StorePulseCommanderSessionCookie`; then constructs fixed child
`ProcessStartInfo` without starting it.

Preflight never creates or inspects a guard, creates guard directories,
authenticates, reads credentials, invokes COM, launches Node, contacts a
network, reads child TLS/config/certificate material, validates connectivity,
or parses a response. It adds no version, architecture, or config-size check.
Every failure in those seven checks, including missing/nonregular dependencies,
hash mismatch, module load/function resolution, or local ProcessStartInfo
construction, is `preflight_failed/preflight`, null exception, and
`session_disposed=true`; it creates no guard or child. Unexpected exceptions
outside those checks remain `unexpected_failure/runner_exception`.

Only successful preflight enters guard handling. An existing representation
guard is `guard_already_exists/guard_check`, null exception, and
`session_disposed=true`; it starts neither authentication nor child. Guard
creation includes fixed-parent-directory creation and atomic marker creation:
ordinary failure is `guard_create_failed/guard_create`; a concurrency loser
whose peer created the marker is `guard_already_exists/guard_check`.

After guard creation, connection-function failures are
`authentication_failed/authentication`; cookie-function failures or an invalid
bounded cookie are `session_cookie_failed/session_cookie`. Actual Process.Start
failure after successful preflight, including a TOCTOU dependency change, is
`child_start_failed/child_start`; a later stdin-write failure is
`child_stdin_failed/child_stdin`.

No preflight, guard refusal, or guard creation failure consumes the guard. Once
atomically created, it remains permanently for every later outcome. Before a
session exists, `session_disposed=true` means no resource remains outstanding;
after partial creation it reflects actual cleanup. PowerShell never duplicates
child-owned ProgramData trust, CA, certificate, hostname, or peer-pin work;
those failures retain the child mapping.

## PowerShell Protected Authentication Invocation Contract

After successful preflight and atomic guard creation, the runner uses only the
fixed installed files `C:\Program Files\StorePulse\Connector\service\storepulse-machine-config.ps1`,
`storepulse-machine-secrets.ps1`, and `storepulse-current-shift-worker.ps1`.
They were loaded during preflight. It invokes
`Read-StorePulseMachineConfig -Path 'C:\ProgramData\StorePulse\config.json'`,
then requires `commander_install_path` and `commander_ip`; it invokes
`Read-StorePulseMachineSecrets -Path 'C:\ProgramData\StorePulse\secrets.json'`,
then requires `commander_username` and `commander_password`.

It invokes exactly once:
`New-StorePulseCommanderConnection -CommanderInstallPath ([string]$config.commander_install_path) -CommanderIp ([string]$config.commander_ip) -Username ([string]$secrets.commander_username) -Password ([string]$secrets.commander_password)`.
It retains that resulting connection and invokes exactly once:
`Get-StorePulseCommanderSessionCookie -Connection $connection`. The cookie must
be a nonempty string of at most 4096 characters with no C0/C1 control
characters, `&`, or `=`.

The order is config read and validation, secret read and validation, one
connection creation, then one cookie acquisition. Reader, field, argument,
connection, or partial COM failures are `authentication_failed/authentication`;
cookie invocation or validation failures are `session_cookie_failed/session_cookie`.
All occur after guard creation and retain it. Preflight only verifies module
files, loads them, and verifies functions; it never reads config or secrets.

Credentials and cookie remain memory-only: never arguments, environment,
files, logs, stdout, stderr, exceptions, public output, or guard content.
There is no alternate parser, path, environment credential, Node login,
second connection, second cookie, or authentication retry. Every actually
created connection/session/COM resource is retained for final cleanup without
dereferencing uninitialized objects; cleanup failure preserves the primary
authentication or cookie failure and makes `session_disposed=false`.

## Limits And Leakage Analysis

Preserve at least: HTTPS only; request timeout at most 15 seconds; child deadline
at most 30 seconds; post-kill wait at most 5 seconds; response at most 1 MiB;
stdout at most 8192 bytes; stderr at most 4096 bytes; depth at most 8; elements
at most 5000; attributes at most 5000; unique local names at most 128; and
child/public JSON at most 8192 bytes.

DTD, entity declarations, external entities, malformed XML, invalid UTF-8,
excessive structure, malformed child output, and stream overflow fail closed.
Raw bytes, XML text, payload, session material, and errors are cleared after
result construction. Child stdout/stderr never enter public JSON.

Every public field is either a fixed status boundary or a fixed class for one of
two schema-defined targets. It proves only that bounded condition; it cannot
contain a product, path, XML name, attribute name, child name, value, count, or
exception message.

## Offline Fixture And Test Plan

Fixtures contain invented non-product XML and no credentials. Required cases:

| Fixture family | Expected sanitized outcome |
| --- | --- |
| Root and nested target attributes | `root_attribute` or `descendant_attribute` with a depth bucket |
| Direct numeric text | `direct_text_element` and `unsigned_decimal` |
| Empty and self-closing targets | `empty_element` or `self_closing_element` |
| Containers with attributes or child numeric text | corresponding container class and numeric class only |
| Mixed locations, equal duplicates, conflicts | `mixed_locations` or `ambiguous`, count bucket, conflict boolean |
| Deep targets and no targets | depth bucket or `none`, never a path |
| Invalid UTF-8, malformed XML, DTD/entity, bound overflow | safe parse code and unavailable defaults |
| Child overflow, stderr, nonzero, timeout, null child, bad count/order | safe runner code, bounded output, cleanup attempt |
| Guard repeat/concurrency and cleanup failure | one winner, safe loser, cleanup precedence |
| Leakage sentinels | no sentinel in JSON, stderr, marker, manifest, or runbook |

Tests must also prove fixed request bytes, one request, zero retries, no page-two
construction, strict TLS, stdin-only session material, exact field order and
domains, and unchanged existing-guard behavior. Temporary runner copies may
substitute only test-owned installed module paths, client paths, and new guard.

## Package And Supervised-Run Gates

Before a package: parser, package, and executable orchestration suites pass with
no skips; deterministic build and manifest/ZIP staging equality pass;
prohibited-content scans pass; the new identifier/guard and existing-guard
noninterference are source-proven.

Before one supervised run: record the exact package identity; verify installed
modules/runtime and service state/PID; use an outer supervisor timeout; verify
the new guard absent before and present after; confirm one request/no retry; and
verify service state/PID afterwards. It runs once only. Any failure returns to
offline analysis, never a rerun.

## Remaining Blocks

Exact page count, page two, traversal, stable ordering, full synchronization,
StorePulse import, Supabase publishing, Commander writes, and production
deployment remain blocked.
