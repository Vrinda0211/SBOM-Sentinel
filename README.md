# SBOM Sentinel

SBOM Sentinel is a two-person DBMS mini-project for managing applications,
SBOMs, software components and versions, licenses, dependencies, and known
vulnerabilities.

## Architecture

- **Next.js, TypeScript, and Tailwind CSS** provide the web application.
- **MySQL**, accessed through `mysql2` and parameterized SQL in server-side
  TypeScript, stores the structured records.
- **Neo4j**, accessed through `neo4j-driver`, is reserved for dependency graph
  relationships and impact analysis.
- Database credentials are read from environment variables and must not be
  committed.

The existing PostgreSQL/Prisma files are unused starter scaffolding; they are
not the MySQL data access layer.

## Prerequisites

- Git
- Node.js 20.19+, 22.12+, or 24+ and npm
- MySQL 8.0.16+ for database-backed functionality and enforced `CHECK`
  constraints
- Neo4j when graph functionality is added

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
