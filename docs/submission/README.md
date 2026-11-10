# DBMS submission status and navigation

This folder organizes the implementation evidence and manual verification
steps for the SBOM Sentinel DBMS submission. Status is based on repository
inspection and automated tests, not on assumed database connectivity.

## Requirement status

| Requirement | Status | Evidence / remaining work |
|---|---|---|
| Relational entities, keys, foreign keys, and constraints | Implemented; automated coverage is partial | [Schema](../../database/mysql/schema.sql); [ER diagram](ER_DIAGRAM.md). Verify the schema against the approved MySQL instance. |
| Secondary indexes | Implemented; not verified live | [`schema.sql`](../../database/mysql/schema.sql) declares importer and vulnerability reverse-lookup indexes; initializer ensures them on existing databases. |
| SQL DDL and DML examples | Implemented; not executed live | [SQL demo](../../database/mysql/demonstrations/submission_queries.sql) uses a temporary table and rolls back actual-table DML. |
| Sample data and repeatable seed | Implemented; not verified live | [Seed script](../../database/mysql/seed.sql) uses deterministic fixture IDs and upserts; it is intended for local/demo databases. |
| Joins, aggregation, grouping, ordering, and subqueries | Implemented; not executed live | [DBMS query guide](../dbms/sql_queries.md) maps each category to application queries and the SQL demo. |
| Transactions and rollback | Implemented and unit-tested with mocks; live suite added | [Transaction helper](../../src/server/database.ts) and [live integration suite](../../src/server/mysql-live.integration.test.ts). |
| Views | Implemented; not verified live | [`V_OPEN_VULNERABILITY_FINDINGS`](../../database/mysql/views.sql) is used by vulnerability queries. |
| Stored procedure | Implemented; not verified live | [`SP_APPLICATION_RISK_SUMMARY`](../../database/mysql/procedures.sql) is installed by `db:init` and called by the server. |
| CycloneDX and SPDX parsing/validation | Implemented and unit-tested | Parser tests cover accepted formats and malformed/invalid cases. |
| MySQL SBOM import, deduplication, and multi-license persistence | Implemented and unit-tested with mocked MySQL | Transaction, reuse, and rollback behavior have automated test coverage; live DB verification remains outstanding. |
| Neo4j constraints, node/relationship synchronization, and analysis | Implemented and mocked-unit-tested | [Cypher reference](NEO4J.md), graph tests, and sync tests. No live Neo4j execution is claimed. |
| Next.js dashboard and server-side database access | Implemented; mocked action tests and prior build checks passed | [Application guide](APPLICATION_AND_DEMO.md). A live DB-backed browser walkthrough remains outstanding. |
| Authentication and two-role authorization | Not implemented; scope confirmation required | No authentication/role requirements are defined in the current app implementation. Do not invent roles; ask the project owner/course rubric whether this is required. |
| Screenshots, actual SQL output, and live database evidence | Not yet captured | Use the [DBMS evidence checklist](../dbms/screenshots/README.md). |
| Individual contribution record | Template only | Each person must supply and verify their own contribution details in [contribution record](CONTRIBUTION_RECORD.md). |

### Advanced concepts mapping

See [advanced database concepts](ADVANCED_CONCEPTS.md) and the
[DBMS feature guide](../dbms/advanced_mysql_features.md) for invocation and
evidence status.

### Person 1 review and joint verification

1. Configure the local MySQL credentials in `.env`, initialize, and run the
   live suite using the [DBMS setup guide](../dbms/database_setup.md).
2. Execute the SQL demonstration against an approved local/demo database and
   save unaltered outputs. The demo uses a temporary table for DDL and rolls
   back actual-table DML; run the whole file in one session.
3. Confirm whether authentication/two-role authorization is actually part of
   this project's required scope.
4. Jointly verify MySQL import/rollback and Neo4j synchronization
   against the intended local services. Do not infer success from unit tests.

## Documents

- [Relational ER diagram](ER_DIAGRAM.md)
- [Advanced database concepts](ADVANCED_CONCEPTS.md)
- [Neo4j operations and Cypher](NEO4J.md)
- [Application review and demonstration sequence](APPLICATION_AND_DEMO.md)
- [Evidence capture checklist](EVIDENCE_CHECKLIST.md)
- [Individual contribution record template](CONTRIBUTION_RECORD.md)
- [SQL demonstration script](../../database/mysql/demonstrations/submission_queries.sql)
