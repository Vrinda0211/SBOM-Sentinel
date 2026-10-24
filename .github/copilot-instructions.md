# SBOM Sentinel project instructions

- SBOM Sentinel is a Next.js App Router project using TypeScript, Tailwind CSS,
  PostgreSQL with Prisma, and Neo4j with the official JavaScript driver.
- PostgreSQL is intended for structured application, component, version,
  license, and vulnerability records. Neo4j is intended for dependency
  relationships and graph-based impact queries.
- Keep secrets and connection strings in ignored environment files; use
  `.env.example` for placeholders only.
- Use strict TypeScript, existing project conventions, and small, reviewable
  changes. Prefer focused components and database access helpers.
- Do not introduce application features, data models, or database behavior
  until their requirements are defined. Confirm scope before making broad
  architectural changes.
- Do not claim a database is connected unless a connection has been verified.
