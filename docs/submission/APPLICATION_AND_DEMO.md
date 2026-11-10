# Application review and demonstration sequence

## Current application behavior

The Next.js App Router dashboard at `/` loads application and vulnerability
data on the server. MySQL and Neo4j access is in server-only modules and
Server Actions. SBOM upload accepts CycloneDX JSON and SPDX JSON, supports an
optional application-name override, and reports a partial outcome if the
MySQL import commits but Neo4j synchronization fails. A failed graph sync can
be retried for its specific SBOM.

The dashboard provides application/SBOM selection, component versions and
licenses, vulnerability findings/remediation state, dependency graph
visualization, direct/transitive/reverse analysis, shortest paths, and graph
synchronization. Empty/error/loading states are implemented in the app.
Actions and data operations have automated tests; those tests do not establish
live database availability. No authentication or two-role authorization
system is implemented. Confirm whether it is part of the instructor-approved
scope before adding one.

The graph target selector uses version nodes returned by Neo4j, including
targets outside the currently selected SBOM. Upload retry is bound to the
SBOM returned by that upload rather than the current selection.

## Recommended final demonstration sequence

1. Show the architecture and ER diagram; identify MySQL as the relational
   source of truth and Neo4j as the dependency graph.
2. Against an approved local database, show the applied schema and view, and
   confirm constraints/indexes. Do not use a production database for the demo.
3. Run the safe SQL demonstration in one MySQL session. Point out that the
   actual-table DML transaction is rolled back and confirm the final persisted
   row count is zero.
4. Show the seed dataset (if approved and already loaded) and demonstrate
   joins, vulnerability grouping, `HAVING`, correlated subqueries, and
   dependency direction.
5. Upload a small valid CycloneDX JSON SBOM, show server validation and
   persisted data, and then repeat with a small valid SPDX JSON document.
6. Show a validation failure for malformed/unsupported input without
   persisting records.
7. Select an application and SBOM; inspect versions, all licenses, and
   vulnerability/remediation findings.
8. With live Neo4j available, show the four constraints, graph node/edge
   synchronization, a dependency edge's direction, a transitive or reverse
   traversal, a shortest path, and affected applications.
9. If graph sync is deliberately unavailable in a local test, show the
   honest partial-failure state and demonstrate the SBOM-specific retry after
   restoring Neo4j. Do not imply this is live-verified unless recorded.
10. Finish with automated test/build results and identify any manual evidence
    or Person 1 confirmations still outstanding.

## Suggested small demo data

Use the existing repeatable local seed in
[`database/mysql/seed.sql`](../../database/mysql/seed.sql) only in an
approved disposable/local DB. It includes a sample application/SBOM, multiple
component versions, licenses, findings, and a dependency. Do not run the seed
against production or a shared database without authorization.
