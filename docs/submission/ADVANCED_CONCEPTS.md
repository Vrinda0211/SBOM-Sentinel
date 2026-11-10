# Advanced database concepts

This mapping separates code that exists from execution evidence. The
automated database tests use mocks; they do not prove that the local MySQL
instance applied the schema or executed the statements.

| Concept | Implementation | Actual execution method | Expected result | Current test/evidence |
|---|---|---|---|---|
| ACID-style transactions and rollback | [`inTransaction`](../../src/server/database.ts); [`importSbomContent`](../../src/server/sboms/import.ts); SBOM and vulnerability create operations | App server obtains one MySQL connection, begins a transaction, commits on success, rolls back on failure. Unit tests exercise mocked begin/commit/rollback calls. | All related SBOM rows commit together; an insert failure rolls back the import. | Transaction/import tests passed using mocks; live MySQL execution still required. |
| Relational view | [`views.sql`](../../database/mysql/views.sql): `V_OPEN_VULNERABILITY_FINDINGS`; consumed by [`vulnerabilities`](../../src/server/vulnerabilities/index.ts) | `npm run db:init` applies the view against the configured local MySQL DB. | The view joins findings to versions/components and excludes `resolved` and `wont_fix`. | Source and query tests exist; no live view query has been captured. |
| Integrity constraints and indexes | [`schema.sql`](../../database/mysql/schema.sql) | `npm run db:init` applies table definitions; SQL demo reads the related tables. | PK/unique/FK/check constraints reject invalid identities, references, severities, remediation states, and self-dependencies. PK, unique, and FK support indexes are available. | Schema and validation tests exist; verify the applied schema with Person 1. No standalone index DDL, trigger, or stored routine is supplied. |
| Parameterized SQL | Server-side functions under [`src/server/`](../../src/server/) | Next.js Server Actions call server-only functions using `mysql2` bound parameters. | User-controlled values are bound separately from SQL text; input checks reject invalid UUID/date/length values. | Query/validation unit tests use mocked pools; live behavior is unverified. |
| Relational joins, aggregates, and subqueries | [`submission_queries.sql`](../../database/mysql/demonstrations/submission_queries.sql) and server listing functions | Run the SQL demo in an approved MySQL 8 session; use a seeded or approved sample dataset. | Relate applications/SBOMs/components/findings and compute counts, `GROUP BY`, `HAVING`, `ORDER BY`, and correlated subquery results. | Query text is present; live result sets must be captured manually. |
| Directed graph traversal | [`graph/index.ts`](../../src/server/graph/index.ts) | Server graph operations use parameterized Neo4j Cypher through the official driver. | Return direct/transitive dependency or dependent results, shortest dependency paths, and applications affected by a version. Depth and result limits are validated and capped. | Graph analysis tests use mocked Neo4j records; live query output remains outstanding. |

## Not present

- No stored procedures or triggers were found in the project SQL.
- No additional explicit secondary-index DDL was found. Before adding an
  index, Person 1 should review the query workload and agree to the schema
  change.
- A view is an implemented concept, not evidence that the view has been
  created in a particular running database.
