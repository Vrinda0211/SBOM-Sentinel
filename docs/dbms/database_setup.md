# MySQL setup, initialization, and seed data

Configure `.env` from [`.env.example`](../../.env.example). Keep actual
credentials only in the ignored `.env`; do not commit them.

```dotenv
MYSQL_HOST="localhost"
MYSQL_PORT="3306"
MYSQL_USER="your_local_user"
MYSQL_PASSWORD="your_local_password"
MYSQL_DATABASE="sbom_sentinel"
```

## Initialization

```powershell
npm run db:init
```

The initializer creates the configured database if absent, runs the
non-destructive `CREATE TABLE IF NOT EXISTS` schema, replaces the managed
vulnerability view and risk-summary procedure, and adds the two named
secondary indexes only if they are missing. It does not drop tables or delete
application data. Re-running it is intended to be safe. Replacing the named
view/procedure affects only those project-managed objects.

The `COMPONENT_VERSION_LICENSE` table is additive to the original nine tables
and keeps imported multi-license data without removing the legacy nullable
`COMPONENT_VERSION.license_id` relationship.

## Seed data

```powershell
npm run db:seed
```

`database/mysql/seed.sql` inserts deterministic demo IDs using
`ON DUPLICATE KEY UPDATE`. It is repeatable and performs no `DELETE` or
`DROP`, but it can update the fixed fixture records if those IDs or unique
fixture keys already exist. Use it only in a local/demo database, not as a
production migration. A failure midway is not transactional; rerunning
completes/reapplies the fixtures.

The sample rows cover npm and system components, MIT legacy/junction license
links, a dependency edge, and HIGH/MEDIUM/CRITICAL vulnerabilities with
`open`, `in_progress`, `resolved`, and `accepted_risk` statuses. The CRITICAL
sample associates xz-utils 5.6.1 with CVE-2024-3094; the other sample
associations use qs CVE-2022-24999, lodash CVE-2021-23337, and Express
CVE-2024-29041.

## Actual environment check

At the latest verification, the local Windows service `MySQL80` was running
and `127.0.0.1:3306` accepted TCP connections. This repository had no `.env`,
and `MYSQL_HOST`, `MYSQL_USER`, `MYSQL_PASSWORD`, and `MYSQL_DATABASE` were
all unset. Consequently, no authenticated database inspection, initializer
run, or seed run is claimed.
