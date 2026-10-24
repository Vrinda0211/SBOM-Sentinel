# SBOM Sentinel

SBOM Sentinel is a software supply-chain intelligence platform being developed
as a team DBMS and software engineering project. The planned application will
organize applications and their Software Bills of Materials (SBOMs), software
components and versions, dependency relationships, licenses, and known
vulnerabilities. The goal is to help teams understand dependency impact and
prioritize remediation.

## Planned architecture

- **Next.js, TypeScript, and Tailwind CSS** provide the web application.
- **PostgreSQL**, accessed through **Prisma**, is planned for structured
  application, component, version, license, and vulnerability data.
- **Neo4j**, accessed through the official `neo4j-driver` JavaScript package,
  is planned for dependency relationships and graph-based impact analysis.
- Connection strings and credentials are supplied through environment
  variables and must not be committed.

The two databases have distinct responsibilities: PostgreSQL stores the
platform's structured records, while Neo4j is intended for traversing
dependency relationships. The project is kept intentionally small to support
a two-person team and a student project.

## Prerequisites

- Git
- Node.js 20.19+, 22.12+, or 24+ and npm
- PostgreSQL and Neo4j will be needed once database-backed features are added;
  they are not required to run the current landing page.

## Get started

From PowerShell, clone the repository and install the locked dependencies:

```powershell
git clone https://github.com/Vrinda0211/SBOM-Sentinel.git
cd SBOM-Sentinel
Copy-Item .env.example .env
notepad .env
# Edit .env and replace the placeholders with local values
npm ci
npm run db:generate
npm run dev
```

Open <http://localhost:3000>.

Edit `.env` with your local database connection settings before using any
database-backed code. The example contains placeholders only:

```dotenv
DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/sbom_sentinel?schema=public"
NEO4J_URI="neo4j://localhost:7687"
NEO4J_USERNAME="replace_with_your_username"
NEO4J_PASSWORD="replace_with_your_local_password"
```

You can also copy `.env.example` to `.env` manually. `.env` and other `.env*`
files are ignored by Git; `.env.example` is intentionally tracked. Never put
real credentials in committed files.

The Prisma client is generated from the empty starter schema with
`npm run db:generate`; no application tables or models are defined yet.

## Useful checks

```powershell
npm run lint
npm run typecheck
npm run build
```

## Current scope

This repository currently contains the web development foundation and
database-client dependencies/configuration only. PostgreSQL and Neo4j services
are not started or verified by the application. The Prisma schema has no
application models yet. SBOM ingestion, vulnerability scanning, dependency
analysis, authentication, and other product features are not implemented.
