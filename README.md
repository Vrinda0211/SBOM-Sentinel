# SBOM Sentinel

SBOM Sentinel is a two-person DBMS mini-project for managing applications,
SBOMs, software components and versions, licenses, dependencies, and known
vulnerabilities.

## Architecture

- **Next.js, TypeScript, and Tailwind CSS** provide the web application.
- **MySQL**, accessed through `mysql2` and parameterized SQL in server-side
  TypeScript, stores the structured records.
- **Neo4j**, accessed through the official `neo4j-driver`, stores dependency
  graph relationships and supports impact analysis. MySQL remains the source
  of truth for structured records.
- Database credentials are read from environment variables and must not be
  committed.

The existing PostgreSQL/Prisma files are unused starter scaffolding; they are
not the MySQL data access layer.

## Prerequisites

- Git
- Node.js 20.19+, 22.12+, or 24+ and npm
- MySQL 8.0.16+ for database-backed functionality and enforced `CHECK`
  constraints
- Neo4j Community or Enterprise 5+ when using graph functionality

## Get started

From PowerShell:

```powershell
git clone https://github.com/Vrinda0211/SBOM-Sentinel.git
cd SBOM-Sentinel
Copy-Item .env.example .env
notepad .env
# Set your local MySQL and Neo4j values
npm ci
npm run db:init
npm run db:seed
npm run dev
```

Open <http://localhost:3000>.

The MySQL pool reads `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`,
`MYSQL_PASSWORD`, and `MYSQL_DATABASE`. `MYSQL_PORT` defaults to `3306`.
`src/lib/mysql.ts` exports a lazily created, reusable pool and is marked
server-only. Configuration is validated when the pool is first requested.
`npm run db:init` creates the configured database if needed and applies the
non-destructive DDL in `database/mysql/schema.sql`, followed by the
`V_OPEN_VULNERABILITY_FINDINGS` view. The schema preserves the original
relational tables, keys, relationships, and constraints and adds
`COMPONENT_VERSION_LICENSE` so one version can retain multiple licenses. The
initializer deliberately omits destructive `DROP TABLE` statements and can be
rerun without deleting existing data. The MySQL user needs permission to
create the database when it does not yet exist.

`npm run db:seed` loads repeatable local sample applications, SBOMs,
components, versions, licenses, and vulnerability findings from
`database/mysql/seed.sql`. It makes no external API calls.

### Local Neo4j

Start a local Neo4j 5+ instance (for example, with Neo4j Desktop or Docker),
then set `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD`, and optionally
`NEO4J_DATABASE` in `.env`. The default database name is `neo4j`; the example
environment file contains placeholders only. The driver and sessions are
created on the server, and each session is closed after its operation.

The server-only graph API is in `src/server/graph/`. The upload workflow calls
`initializeNeo4jGraph()` before synchronization, creating the four idempotent
uniqueness constraints. It then uses `upsertApplication`, `upsertSbom`,
`upsertComponent`, and `upsertComponentVersion` with IDs from MySQL, followed
by `linkApplicationToSbom`, `replaceSbomContents`, and
`replaceDependenciesForVersion`. For example:

```ts
import {
  initializeNeo4jGraph,
  upsertComponentVersion,
  upsertDependency,
} from "@/server/graph";

await initializeNeo4jGraph();
await upsertComponentVersion({
  componentVersionId: componentVersion.component_version_id,
  componentId: componentVersion.component_id,
  versionNumber: componentVersion.version_number,
  licenseId: componentVersion.license_id,
  releaseDate: componentVersion.release_date,
});
await upsertDependency(sourceVersionId, {
  dependsOnComponentVersionId: targetVersionId,
  dependencyScope: "runtime",
});
```

The IDs in this example must come from existing MySQL records; it does not
create relational records. Graph reads include `getApplicationSbomGraph`,
`getDirectDependencies`, `getTransitiveDependencies`,
`getTransitiveDependents`, `findShortestDependencyPaths`, and
`findAffectedApplications`. Traversal depth defaults to 5 and is capped at 12;
results default to 100 and are capped at 500. `replaceSbomContents` and
`replaceDependenciesForVersion` update only the named relationships in a
Neo4j transaction and roll back if referenced graph records are missing.

The MySQL `DEPENDENCY` table stores a source/target component-version pair and
optional `dependency_scope`, without an SBOM association. Graph synchronization
therefore models dependencies as global version-to-version edges and updates
only source versions represented in the imported SBOM. Referenced targets
outside the SBOM are also upserted using their existing MySQL IDs. If MySQL
processing succeeds but Neo4j is unavailable, the dashboard reports the
partial outcome and offers an SBOM-specific retry; it does not undo committed
relational data. Vulnerabilities remain in MySQL and are not duplicated as
Neo4j nodes. Graph operations are mocked in unit tests; a running Neo4j service
is required for live verification.

## Server-side database functions

Import these server-only functions from their respective `src/server/`
directories:

- `applications`: register, list, retrieve, update, and delete applications.
- `sboms`: create SBOM metadata and component-version associations atomically;
  list SBOMs for an application; parse and transactionally import CycloneDX or
  SPDX JSON using `importSbomContent`; and synchronize or retry graph data.
- `components`: list components, versions, and licenses; create licenses,
  components, and versions; find applications that use a component.
- `dependencies`: add, list, and remove dependency edges using the
  `DEPENDENCY` composite key and schema constraints.
- `vulnerabilities`: record a vulnerability and affected versions atomically,
  update remediation status, list findings with affected applications, and
  retrieve active finding data for graph integration.

Functions validate identifiers and user input, bind values as SQL parameters,
and let database errors (including foreign-key and uniqueness failures)
propagate to their callers. Application deletion follows the schema's
`ON DELETE CASCADE` relationship for SBOM data.

The dashboard at `/` reads application summaries, SBOMs, component versions,
license associations, and vulnerability findings from MySQL. Uploads are
server-side JSON imports capped at 5 MB. Components are reused by name and
type, versions by component ID and version string, and licenses by SPDX
identifier. Ambiguous pre-existing application or component matches fail
clearly rather than creating duplicate records. Missing package versions use
the explicit `UNKNOWN` value required by the existing non-null version column.
CycloneDX vulnerability entries are imported when they include a supported
severity (`LOW`, `MEDIUM`, `HIGH`, or `CRITICAL`) and `affects` references to
declared components. The importer maps those references to component-version
records and stores the CVE and affected-version links in the same MySQL
transaction as the SBOM. Re-imports reuse matching CVE records and preserve
existing remediation states; a conflicting severity for an existing CVE
aborts the import. SPDX vulnerability extensions, vulnerability descriptions,
sources, and numeric CVSS scores are not imported.
See [the integration contract](./docs/INTEGRATION_CONTRACT.md) for transaction
and matching details.

## Database concepts demonstrated

- **Transactions:** SBOM metadata and its component associations, and
  vulnerability metadata and affected-version links, commit or roll back as a
  unit.
- **Views:** `V_OPEN_VULNERABILITY_FINDINGS` centralizes the join and
  remediation filter used by vulnerability and graph queries.
- **Indexes:** primary keys, unique constraints, and foreign keys in the
  supplied schema provide indexes for identity, uniqueness, joins, and
  referential checks.
- **Joins and aggregation:** application and component listing queries use
  joins, `LEFT JOIN`, grouped counts, and deterministic ordering to preserve
  records without related SBOMs or versions.
- SQL operations also demonstrate parameterized `INSERT`, `UPDATE`, `DELETE`,
  and `SELECT`.

## DBMS submission materials

The [submission guide](./docs/submission/README.md) contains the relational ER
diagram, an audited requirement-status matrix, advanced-concept mapping,
Neo4j/Cypher reference, application demonstration sequence, and manual
evidence checklist. The safe MySQL DDL/DML and query examples are in
[`database/mysql/demonstrations/submission_queries.sql`](./database/mysql/demonstrations/submission_queries.sql).
The SQL file has not been run against the configured database; its actual
outputs must be captured in an approved local/demo environment.

`.env` and other `.env*` files are ignored by Git; `.env.example` contains
placeholders only. Never put real credentials in committed files.

## Useful checks

```powershell
npm run lint
npm run typecheck
npm run test
npm run build
```

Database operation tests use a mocked `mysql2` pool; they do not require a
running MySQL service. The old Prisma `db:generate` script is for unused
PostgreSQL starter scaffolding and does not initialize the MySQL schema. No
database connection is claimed unless explicitly verified against a running
service.
