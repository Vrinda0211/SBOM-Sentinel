# Evidence capture checklist

No screenshots, SQL outputs, or live database results are fabricated in this
repository. Capture each item manually in the approved local environment and
record the date, software versions, and database name (never credentials).

## Relational database

- [ ] MySQL server/version and selected approved demo database (hide secrets).
- [ ] `SHOW TABLES` output showing the ten project tables and the view.
- [ ] `SHOW CREATE TABLE` for key tables: `APPLICATION`, `SBOM`,
  `COMPONENT_VERSION`, `COMPONENT_VERSION_LICENSE`, `DEPENDENCY`, and
  `COMPONENT_VERSION_VULNERABILITY`.
- [ ] `SHOW INDEX` output for the above tables; distinguish declared keys and
  InnoDB-created foreign-key indexes from any standalone secondary indexes.
- [ ] `SHOW CREATE VIEW V_OPEN_VULNERABILITY_FINDINGS`.
- [ ] Results from
  [`submission_queries.sql`](../../database/mysql/demonstrations/submission_queries.sql),
  including the final persisted demo-row count of `0`.
- [ ] Approved sample seed output and representative application/SBOM,
  component/version/license, dependency, and vulnerability query results.
- [ ] If transaction rollback is shown, capture the failing operation and
  verify the affected demo rows were not persisted.

## Neo4j

- [ ] Neo4j edition/version and selected database (hide credentials).
- [ ] `SHOW CONSTRAINTS` output with all four verified uniqueness constraints.
- [ ] Read-only `MATCH` output proving an application/SBOM/component-version
  graph is present.
- [ ] One directed `DEPENDS_ON` result with source, target, and scope.
- [ ] Direct/transitive or reverse dependency analysis, shortest path, and
  affected application results from a known sample graph.
- [ ] Retry demonstration if the project is expected to show recovery from a
  graph outage.

## Application and quality checks

- [ ] Dashboard showing database-backed application/SBOM counts and findings.
- [ ] Successful CycloneDX and SPDX upload results.
- [ ] Invalid upload validation message and proof no malformed document was
  imported.
- [ ] Component versions/licenses/findings, graph visualization, and analysis
  output.
- [ ] Loading, empty, error, and graph-unavailable/retry states.
- [ ] Output from `npm run typecheck`, `npm run lint`, `npm run test`, and
  `npm run build`, with date and commit/working-tree identifier.
- [ ] Screenshots should be unaltered other than redacting credentials or
  personal information; describe any redaction.

## Evidence log

| Date/time | Item | Environment/version | Evidence filename/link | Verified by |
|---|---|---|---|---|
| | | | | |

Do not store `.env.local`, passwords, tokens, or unredacted connection strings
in the evidence folder or Git.
