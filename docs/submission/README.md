# DBMS submission status and navigation

This folder organizes the implementation evidence and manual verification
steps for the SBOM Sentinel DBMS submission. Status is based on repository
inspection and automated tests, not on assumed database connectivity.

## Requirement status

| Requirement | Status | Evidence / remaining work |
|---|---|---|
| Relational entities, keys, foreign keys, and constraints | Implemented; automated coverage is partial | [Schema](../../database/mysql/schema.sql); [ER diagram](ER_DIAGRAM.md). Verify the schema against the approved MySQL instance. |
| Secondary indexes | Partially implemented | Primary, unique, and foreign-key indexes are defined or created by InnoDB. No separately declared secondary index was found. Ask Person 1 to review workload-specific indexes before adding any. |
| SQL DDL and DML examples | Implemented; not executed live | [Safe SQL demo](../../database/mysql/demonstrations/submission_queries.sql). Run only against an approved local/demo DB, in one session, and capture outputs. |
| Sample data and repeatable seed | Implemented; not verified against a live DB in this task | [Seed script](../../database/mysql/seed.sql) uses `ON DUPLICATE KEY UPDATE`. Person 1 should confirm whether it has been run in the submission database. |
| Joins, aggregation, grouping, ordering, and subqueries | Implemented; not executed live | Included in the SQL demo; record actual query outputs as evidence. |
| Transactions and rollback | Implemented and unit-tested with mocks | [Transaction helper](../../src/server/database.ts), import and CRUD operation tests. Actual MySQL transaction behavior still needs a local run. |
| Views | Implemented; not verified live | [`V_OPEN_VULNERABILITY_FINDINGS`](../../database/mysql/views.sql) is used by vulnerability queries. |
| Stored procedures and triggers | Missing / not required by current implementation | No stored procedure or trigger was found. Adding one would change database behavior and needs Person 1 review. |
| CycloneDX and SPDX parsing/validation | Implemented and unit-tested | Parser tests cover accepted formats and malformed/invalid cases. |
| MySQL SBOM import, deduplication, and multi-license persistence | Implemented and unit-tested with mocked MySQL | Transaction, reuse, and rollback behavior have automated test coverage; live DB verification remains outstanding. |
| Neo4j constraints, node/relationship synchronization, and analysis | Implemented and mocked-unit-tested | [Cypher reference](NEO4J.md), graph tests, and sync tests. No live Neo4j execution is claimed. |
| Next.js dashboard and server-side database access | Implemented; mocked action tests and prior build checks passed | [Application guide](APPLICATION_AND_DEMO.md). A live DB-backed browser walkthrough remains outstanding. |
| Authentication and two-role authorization | Not implemented; scope confirmation required | No authentication/role requirements are defined in the current app implementation. Do not invent roles; ask the project owner/course rubric whether this is required. |
| Screenshots, actual SQL output, and live database evidence | Not yet captured | Use [evidence checklist](EVIDENCE_CHECKLIST.md). |
| Individual contribution record | Template only | Each person must supply and verify their own contribution details in [contribution record](CONTRIBUTION_RECORD.md). |

### Advanced concepts mapping

See [advanced database concepts](ADVANCED_CONCEPTS.md) for the implementation
file, invocation, expected outcome, and test/evidence status for transactions,
views, integrity constraints/indexes, parameterized SQL, and graph traversal.

### Person 1 review and joint verification

1. Confirm the current approved MySQL schema includes
   `COMPONENT_VERSION_LICENSE` and all expected constraints before importing
   SBOMs. The current schema file is additive and uses
   `CREATE TABLE IF NOT EXISTS`.
2. Review whether additional explicit indexes are appropriate for the actual
   workload; do not add them without agreement.
3. Execute the SQL demonstration against an approved local/demo database and
   save unaltered outputs. The demo uses a temporary table for DDL and rolls
   back actual-table DML; run the whole file in one session.
4. Confirm whether authentication/two-role authorization is actually part of
   this project's required scope.
5. Jointly verify MySQL import/rollback and Neo4j constraints/synchronization
   against the intended local services. Do not infer success from unit tests.

## Documents

- [Relational ER diagram](ER_DIAGRAM.md)
- [Advanced database concepts](ADVANCED_CONCEPTS.md)
- [Neo4j operations and Cypher](NEO4J.md)
- [Application review and demonstration sequence](APPLICATION_AND_DEMO.md)
- [Evidence capture checklist](EVIDENCE_CHECKLIST.md)
- [Individual contribution record template](CONTRIBUTION_RECORD.md)
- [SQL demonstration script](../../database/mysql/demonstrations/submission_queries.sql)
