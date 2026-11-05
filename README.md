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
- MySQL for database-backed functionality
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
npm run dev
```

Open <http://localhost:3000>.

The MySQL pool reads `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`,
`MYSQL_PASSWORD`, and `MYSQL_DATABASE`. `MYSQL_PORT` defaults to `3306`.
`src/lib/mysql.ts` exports a lazily created, reusable pool and is marked
server-only. Configuration is validated when the pool is first requested.

The pool and placeholder environment configuration are the current MySQL
backend setup. The schema initialization SQL and database operations are not
implemented yet; the authoritative DDL is needed before adding them. No
database connection is claimed or verified by starting the web application.

`.env` and other `.env*` files are ignored by Git; `.env.example` contains
placeholders only. Never put real credentials in committed files.

## Useful checks

```powershell
npm run lint
npm run typecheck
npm run build
```

The old Prisma `db:generate` script is for the unused PostgreSQL starter
configuration; it does not initialize or generate the MySQL schema.
