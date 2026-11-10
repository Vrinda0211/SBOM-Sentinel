# Advanced database concepts

This mapping separates code that exists from execution evidence. The
automated database tests use mocks; they do not prove that the local MySQL
instance applied the schema or executed the statements.

| Concept | Implementation | Actual execution method | Expected result | Current test/evidence |
|---|---|---|---|---|
| ACID-style transactions and rollback | [`inTransaction`](../../src/server/database.ts); [`importSbomContent`](../../src/server/sboms/import.ts); SBOM and vulnerability create operations | App server obtains one MySQL connection, begins a transaction, commits on success, rolls back on failure. Unit tests exercise mocked begin/commit/rollback calls; the live suite verifies a rollback against MySQL. | All related SBOM rows commit together; an insert failure rolls back the import. | Mocked tests passed; the live suite requires the local MySQL environment. |
| Relational view | [`views.sql`](../../database/mysql/views.sql): `V_OPEN_VULNERABILITY_FINDINGS`; consumed by [`vulnerabilities`](../../src/server/vulnerabilities/index.ts) | `npm run db:init` applies the view against the configured local MySQL DB. | The view joins findings to versions/components and excludes `resolved` and `wont_fix`. | Source and query tests exist; live view output is not available in this checkout. |
| Integrity constraints and indexes | [`schema.sql`](../../database/mysql/schema.sql) | `npm run db:init` applies table definitions and ensures two named secondary indexes on existing databases. | PK/unique/FK/check constraints reject invalid identities, references, severities, remediation states, and self-dependencies. Secondary indexes support component matching and reverse vulnerability lookup. | Schema and validation tests exist; live applied-index verification remains outstanding. |
| Stored procedure | [`procedures.sql`](../../database/mysql/procedures.sql): `SP_APPLICATION_RISK_SUMMARY` | `npm run db:init` replaces the project-managed procedure; call via `CALL SP_APPLICATION_RISK_SUMMARY(?)` or `getApplicationRiskSummary`. | Returns component/SBOM counts, open/critical findings, weighted `SUM`/`AVG` severity scores, and `MIN`/`MAX` publication dates. | Server function tests cover parameterization; live procedure output is not available in this checkout. |
| Parameterized SQL | Server-side functions under [`src/server/`](../../src/server/) | Next.js Server Actions call server-only functions using `mysql2` bound parameters. | User-controlled values are bound separately from SQL text; input checks reject invalid UUID/date/length values. | Query/validation unit tests use mocked pools; live behavior is unverified. |
| Relational joins, aggregates, and subqueries | [`submission_queries.sql`](../../database/mysql/demonstrations/submission_queries.sql) and server listing functions | Run the SQL demo in an approved MySQL 8 session; use a seeded or approved sample dataset. | Relate applications/SBOMs/components/findings and compute counts, `GROUP BY`, `HAVING`, `ORDER BY`, and `IN`/`EXISTS`/correlated subquery results. | Query text is present; live result sets must be captured after configuring MySQL. |
| Directed graph traversal | [`graph/index.ts`](../../src/server/graph/index.ts) | Server graph operations use parameterized Neo4j Cypher through the official driver. | Return direct/transitive dependency or dependent results, shortest dependency paths, and applications affected by a version. Depth and result limits are validated and capped. | Graph analysis tests use mocked Neo4j records; live query output remains outstanding. |

## Not present

- No triggers are used; application timestamps and remediation changes are
  already maintained by normal inserts/updates, so a trigger would duplicate
  behavior.
- A view is an implemented concept, not evidence that the view has been
  created in a particular running database.
- No live MySQL outputs or screenshots are available in this checkout because
  the MySQL credentials are not configured.
