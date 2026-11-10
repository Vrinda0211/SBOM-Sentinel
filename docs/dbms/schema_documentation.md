# MySQL schema documentation

The canonical schema is [`database/mysql/schema.sql`](../../database/mysql/schema.sql).
`SBOM_Sentinel_DDL.sql` is an earlier standalone DDL snapshot; initialize the
application with `npm run db:init`, which applies the canonical schema.

The schema has the original nine tables plus the additive
`COMPONENT_VERSION_LICENSE` junction table (ten total). The junction table is
necessary because CycloneDX and SPDX packages can carry multiple licenses.
`COMPONENT_VERSION.license_id` remains nullable for older records and graph
compatibility. The MySQL readers union the legacy relationship with the
junction relationship and de-duplicate the results.

## Tables and relationships

| Table | Primary key | Unique/check constraints | Foreign keys and delete behavior |
|---|---|---|---|
| `APPLICATION` | `application_id` | None | None |
| `LICENSE` | `license_id` | Unique `spdx_identifier` | None |
| `COMPONENT` | `component_id` | None | None |
| `SBOM` | `sbom_id` | None | `application_id` → `APPLICATION`; cascade |
| `COMPONENT_VERSION` | `component_version_id` | Unique `(component_id, version_number)` | `component_id` → `COMPONENT`; cascade. `license_id` → `LICENSE`; set null |
| `COMPONENT_VERSION_LICENSE` | `(component_version_id, license_id)` | Pair is unique by primary key | `component_version_id` → `COMPONENT_VERSION`; cascade. `license_id` → `LICENSE`; cascade |
| `VULNERABILITY` | `vulnerability_id` | Unique `cve_id`; severity check | None |
| `SBOM_CONTAINS` | `(sbom_id, component_version_id)` | Pair is unique by primary key | Both parents cascade |
| `DEPENDENCY` | `(component_version_id, depends_on_component_version_id)` | Pair is unique; no-self-dependency check | Both version references cascade |
| `COMPONENT_VERSION_VULNERABILITY` | `(component_version_id, vulnerability_id)` | Pair is unique; remediation-state check | Both references cascade |

All key columns are `NOT NULL` except the explicitly nullable descriptions,
component type, license type, legacy component-version license, release and
publication dates, dependency scope, and identified date. MySQL/InnoDB supplies
supporting indexes for primary, unique, and foreign keys. Two workload indexes
are also declared: `idx_component_lookup` for the importer’s name/type
deduplication lookup, and `idx_cvv_vulnerability_component` for reverse
vulnerability-to-affected-version joins.

The schema has no `ON UPDATE CASCADE` clauses. IDs are stable UUIDs and the
referential constraints use MySQL’s default `NO ACTION` update behavior.
Severity values are `LOW`, `MEDIUM`, `HIGH`, and `CRITICAL`. Remediation
values are `open`, `in_progress`, `resolved`, `wont_fix`, and `accepted_risk`.

## Local inspection statements

Run after setup to verify the objects in the selected database:

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'
ORDER BY table_name;

SHOW CREATE TABLE COMPONENT_VERSION_LICENSE;
SHOW CREATE TABLE COMPONENT_VERSION;
SHOW CREATE VIEW V_OPEN_VULNERABILITY_FINDINGS;
SHOW INDEX FROM COMPONENT;
SHOW INDEX FROM COMPONENT_VERSION_VULNERABILITY;
SHOW PROCEDURE STATUS
WHERE Db = DATABASE() AND Name = 'SP_APPLICATION_RISK_SUMMARY';
```

**Live execution evidence:** not captured in this workspace. The MySQL Windows
service and TCP port are available, but this checkout has no `.env` and none
of `MYSQL_HOST`, `MYSQL_USER`, `MYSQL_PASSWORD`, or `MYSQL_DATABASE` is set.
No live schema/object counts are claimed.
