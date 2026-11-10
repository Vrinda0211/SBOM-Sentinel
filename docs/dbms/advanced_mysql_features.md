# Advanced MySQL features

The implementation provides four distinct, application-relevant concepts:
transactional imports, a relational view, a stored procedure, and explicit
workload indexes. Integrity constraints provide an additional database-level
correctness layer.

## Transactions

`inTransaction` in [`src/server/database.ts`](../../src/server/database.ts)
commits only after the operation succeeds and rolls back before rethrowing an
operation failure. SBOM import, multi-row SBOM creation, and vulnerability
creation use that helper. The mocked unit suite verifies commit/rollback call
behavior. The separate live suite verifies a deliberately thrown error leaves
no application row.

## View

[`V_OPEN_VULNERABILITY_FINDINGS`](../../database/mysql/views.sql) joins
vulnerability, component-version, and component records. It excludes
`resolved` and `wont_fix` findings and is consumed by the vulnerability
readers.

```sql
SHOW CREATE VIEW V_OPEN_VULNERABILITY_FINDINGS;
SELECT severity, COUNT(*) AS finding_count
FROM V_OPEN_VULNERABILITY_FINDINGS
GROUP BY severity
ORDER BY FIELD(severity, 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW');
```

## Stored procedure

`SP_APPLICATION_RISK_SUMMARY(application_id)` returns SBOM and component
version counts, open and critical finding counts, total and average weighted
severity scores, and the oldest/latest publication dates. Its score is
LOW=1, MEDIUM=2, HIGH=3, CRITICAL=4. It is installed/replaced by
`npm run db:init` and called by the parameterized
`getApplicationRiskSummary()` server function.

```sql
CALL SP_APPLICATION_RISK_SUMMARY(
    '00000000-0000-4000-8000-000000000041'
);
```

## Indexing and query plans

`idx_component_lookup(component_name, component_type)` supports SBOM importer
component matching. `idx_cvv_vulnerability_component(vulnerability_id,
component_version_id)` supports finding affected component versions from a
vulnerability. The initializer adds either index to an existing installation
only when missing.

```sql
EXPLAIN
SELECT component_version_id
FROM COMPONENT_VERSION_VULNERABILITY
WHERE vulnerability_id = '00000000-0000-4000-8000-000000000031';
```

Inspect the `key` column in the result for
`idx_cvv_vulnerability_component`. The expected plan is not a substitute for
capturing the actual plan from the target MySQL version and its statistics.

## Verification status

Repository tests cover parameterization, SQL structure, and mocked
transaction/import behavior. In this workspace, no live procedure, view, or
EXPLAIN output has been captured because the configured credentials are
absent. See [`integration_testing.md`](integration_testing.md) for the live
test command and environment status.
