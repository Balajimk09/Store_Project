# Commander Catalog Page-One Evidence

Classification: supported historical request contract; not yet live-proven.

The fixed request is `vPLUs` with this exact XML:

```xml
<domain:PLUSelect xmlns:domain="urn:vfi-sapphire:np.domain.2001-07-01"><pageSize>100</pageSize><page>1</page></domain:PLUSelect>
```

It requests page 1 with page size 100. `query` and `where` are absent. Earlier
packages failed in a separate authentication path before vPLUs. The installed
PowerShell-first authentication path and selected-product vPLUs request are
independently live-proven.

Response schema, pagination, page two, full catalog synchronization, imports,
and writes remain unproven and blocked.

## Live Proof: 2026-07-29

The request above was previously classified as supported but not live-proven.
It became live-proven on 2026-07-29 using package SHA-256
`569FE0CD3728D0288E3FCF06A7EF8CB74CAE860D705836696E998DA8B1A1137D`.

The response root was `PLUs`, the structural record candidate was `PLU`, and
the expected namespace matched. Structural pagination candidate names were
`page` and `ofPages`; their values and page-two behavior remain unproven.

The complete sanitized proof is recorded in
`COMMANDER_CATALOG_PAGE1_LIVE_PROOF.md`.
