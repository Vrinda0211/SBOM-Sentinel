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
`V_OPEN_VULNERABILITY_FINDINGS` view. The table definitions preserve the nine
tables, keys, relationships, and constraints in `SBOM_Sentinel_DDL.sql`; the
initializer deliberately omits that file's `DROP TABLE` statements so it can
be rerun without deleting existing data. The MySQL user needs permission to
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

The server-only graph API is in `src/server/graph/`. From a trusted Next.js
Server Component or Server Action, call `initializeNeo4jGraph()` once to create
the four idempotent uniqueness constraints. Then use `upsertApplication`,
`upsertSbom`, `upsertComponent`, and `upsertComponentVersion` with IDs from
MySQL, followed by `linkApplicationToSbom`, `linkSbomToComponentVersion`, and
`upsertDependency`. For example:

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

The current MySQL `DEPENDENCY` table stores a source/target component-version
pair and optional `dependency_scope`, without an SBOM association. The graph
API models that shape as global version-to-version edges, but Person 1 must
confirm the final synchronization contract before the databases are integrated.
The graph API does not synchronize MySQL records automatically. Vulnerabilities
remain in MySQL and can later be overlaid in the UI by component-version ID;
they are not duplicated as Neo4j nodes. No live Neo4j operation is performed
by the unit tests; they mock the official driver.

## Server-side database functions

Import these server-only functions from their respective `src/server/`
directories:

- `applications`: register, list, retrieve, update, and delete applications.
- `sboms`: create SBOM metadata and component-version associations atomically;
  list SBOMs for an application. SBOM parsing is intentionally outside this
  API.
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
