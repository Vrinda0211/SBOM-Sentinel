# Relational ER diagram

The diagram reflects the tables and keys in
[`database/mysql/schema.sql`](../../database/mysql/schema.sql). MySQL is the
source of truth for these entities; Neo4j stores a synchronized dependency
graph and does not replace these relations.

```mermaid
erDiagram
    APPLICATION {
        CHAR application_id PK
        VARCHAR application_name
        TEXT description
        TIMESTAMP created_at
    }
    SBOM {
        CHAR sbom_id PK
        CHAR application_id FK
        VARCHAR format
        TIMESTAMP generated_at
    }
    COMPONENT {
        CHAR component_id PK
        VARCHAR component_name
        VARCHAR component_type
    }
    COMPONENT_VERSION {
        CHAR component_version_id PK
        CHAR component_id FK
        CHAR license_id FK
        VARCHAR version_number
        DATE release_date
    }
    LICENSE {
        CHAR license_id PK
        VARCHAR license_name
        VARCHAR spdx_identifier UK
        VARCHAR license_type
    }
    COMPONENT_VERSION_LICENSE {
        CHAR component_version_id PK, FK
        CHAR license_id PK, FK
    }
    SBOM_CONTAINS {
        CHAR sbom_id PK, FK
        CHAR component_version_id PK, FK
    }
    DEPENDENCY {
        CHAR component_version_id PK, FK
        CHAR depends_on_component_version_id PK, FK
        VARCHAR dependency_scope
    }
    VULNERABILITY {
        CHAR vulnerability_id PK
        VARCHAR cve_id UK
        VARCHAR severity
        DATE published_date
    }
    COMPONENT_VERSION_VULNERABILITY {
        CHAR component_version_id PK, FK
        CHAR vulnerability_id PK, FK
        VARCHAR remediation_status
        DATE identified_date
    }

    APPLICATION ||--o{ SBOM : owns
    SBOM ||--o{ SBOM_CONTAINS : contains
    COMPONENT_VERSION ||--o{ SBOM_CONTAINS : included_as
    COMPONENT ||--o{ COMPONENT_VERSION : has
    LICENSE o|--o{ COMPONENT_VERSION : legacy_license
    COMPONENT_VERSION ||--o{ COMPONENT_VERSION_LICENSE : licensed_by
    LICENSE ||--o{ COMPONENT_VERSION_LICENSE : applies_to
    COMPONENT_VERSION ||--o{ DEPENDENCY : dependent_source
    COMPONENT_VERSION ||--o{ DEPENDENCY : dependency_target
    COMPONENT_VERSION ||--o{ COMPONENT_VERSION_VULNERABILITY : affected
    VULNERABILITY ||--o{ COMPONENT_VERSION_VULNERABILITY : reported_for
```

`COMPONENT_VERSION_LICENSE` is the many-to-many license association used by
imports. `COMPONENT_VERSION.license_id` remains for compatibility; readers
union both sources and de-duplicate them. `DEPENDENCY` is global per component
version pair, not attached to an SBOM. Its direction is from
`component_version_id` (dependent) to `depends_on_component_version_id`
(dependency).

The schema declares primary and unique keys and foreign-key constraints,
including `CHECK` constraints for severity, remediation status, and
self-dependencies. InnoDB provides supporting indexes for key and foreign-key
operations; the schema does not declare separate workload-specific secondary
indexes.
