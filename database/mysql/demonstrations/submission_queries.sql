-- SBOM Sentinel DBMS submission demonstration.
-- Run in one MySQL 8 session against an approved local/demo database.
-- The actual-table DML transaction is rolled back at the end.
-- DDL below is limited to a session-scoped TEMPORARY table.

-- CREATE, ALTER, INSERT, UPDATE, SELECT, DELETE, and safe DROP examples.
DROP TEMPORARY TABLE IF EXISTS sbom_submission_ddl_demo;
CREATE TEMPORARY TABLE sbom_submission_ddl_demo (
    demo_id INT NOT NULL PRIMARY KEY,
    demo_label VARCHAR(80) NOT NULL
) ENGINE=InnoDB;

ALTER TABLE sbom_submission_ddl_demo
    ADD COLUMN notes VARCHAR(120) NULL;

INSERT INTO sbom_submission_ddl_demo (demo_id, demo_label, notes)
VALUES (1, 'temporary DDL/DML example', 'session-scoped only');

UPDATE sbom_submission_ddl_demo
SET notes = 'updated in the current session'
WHERE demo_id = 1;

SELECT demo_id, demo_label, notes
FROM sbom_submission_ddl_demo
ORDER BY demo_id;

DELETE FROM sbom_submission_ddl_demo
WHERE demo_id = 1;

SELECT COUNT(*) AS remaining_temporary_rows
FROM sbom_submission_ddl_demo;

DROP TEMPORARY TABLE sbom_submission_ddl_demo;

-- Actual APPLICATION DML example. Keep this entire section in one session;
-- the final ROLLBACK prevents the demonstration row from persisting.
START TRANSACTION;
SET @submission_demo_application_id = UUID();

INSERT INTO APPLICATION (application_id, application_name, description)
VALUES (
    @submission_demo_application_id,
    'Submission DML transaction example',
    'Temporary example; this transaction is rolled back.'
);

SELECT application_id, application_name, description
FROM APPLICATION
WHERE application_id = @submission_demo_application_id;

UPDATE APPLICATION
SET description = 'Updated inside a transaction that will be rolled back.'
WHERE application_id = @submission_demo_application_id;

SELECT application_id, application_name, description
FROM APPLICATION
WHERE application_id = @submission_demo_application_id;

DELETE FROM APPLICATION
WHERE application_id = @submission_demo_application_id;

SELECT COUNT(*) AS rows_after_demo_delete
FROM APPLICATION
WHERE application_id = @submission_demo_application_id;

ROLLBACK;

-- Expected result: 0. This verifies that no demo APPLICATION row persisted.
SELECT COUNT(*) AS persisted_demo_rows_after_rollback
FROM APPLICATION
WHERE application_id = @submission_demo_application_id;

-- Applications and their SBOM metadata (preserves applications without SBOMs).
SELECT
    a.application_id,
    a.application_name,
    s.sbom_id,
    s.format,
    s.generated_at
FROM APPLICATION AS a
LEFT JOIN SBOM AS s
    ON s.application_id = a.application_id
ORDER BY a.application_name, s.generated_at DESC;

-- Components, versions, and all associated licenses for each SBOM.
-- UNION removes duplicate representation where the legacy single-license
-- column and the multi-license junction both contain the same association.
WITH version_licenses AS (
    SELECT component_version_id, license_id
    FROM COMPONENT_VERSION_LICENSE
    UNION
    SELECT component_version_id, license_id
    FROM COMPONENT_VERSION
    WHERE license_id IS NOT NULL
)
SELECT
    s.sbom_id,
    a.application_name,
    c.component_name,
    cv.version_number,
    GROUP_CONCAT(
        DISTINCT l.spdx_identifier
        ORDER BY l.spdx_identifier
        SEPARATOR ', '
    ) AS licenses
FROM SBOM AS s
JOIN APPLICATION AS a
    ON a.application_id = s.application_id
JOIN SBOM_CONTAINS AS sc
    ON sc.sbom_id = s.sbom_id
JOIN COMPONENT_VERSION AS cv
    ON cv.component_version_id = sc.component_version_id
JOIN COMPONENT AS c
    ON c.component_id = cv.component_id
LEFT JOIN version_licenses AS vl
    ON vl.component_version_id = cv.component_version_id
LEFT JOIN LICENSE AS l
    ON l.license_id = vl.license_id
GROUP BY
    s.sbom_id,
    a.application_name,
    c.component_name,
    cv.version_number
ORDER BY a.application_name, c.component_name, cv.version_number;

-- Open vulnerability findings grouped by severity.
SELECT
    severity,
    COUNT(DISTINCT vulnerability_id) AS vulnerability_count,
    COUNT(*) AS affected_component_version_count
FROM V_OPEN_VULNERABILITY_FINDINGS
GROUP BY severity
ORDER BY FIELD(severity, 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW');

-- Applications with at least two distinct open vulnerability findings.
SELECT
    a.application_id,
    a.application_name,
    COUNT(DISTINCT f.vulnerability_id) AS open_finding_count
FROM APPLICATION AS a
JOIN SBOM AS s
    ON s.application_id = a.application_id
JOIN SBOM_CONTAINS AS sc
    ON sc.sbom_id = s.sbom_id
JOIN V_OPEN_VULNERABILITY_FINDINGS AS f
    ON f.component_version_id = sc.component_version_id
GROUP BY a.application_id, a.application_name
HAVING COUNT(DISTINCT f.vulnerability_id) >= 2
ORDER BY open_finding_count DESC, a.application_name;

-- Correlated subquery: each application and its count of open findings.
SELECT
    a.application_id,
    a.application_name,
    (
        SELECT COUNT(DISTINCT f.vulnerability_id)
        FROM SBOM AS s
        JOIN SBOM_CONTAINS AS sc
            ON sc.sbom_id = s.sbom_id
        JOIN V_OPEN_VULNERABILITY_FINDINGS AS f
            ON f.component_version_id = sc.component_version_id
        WHERE s.application_id = a.application_id
    ) AS open_finding_count
FROM APPLICATION AS a
WHERE EXISTS (
    SELECT 1
    FROM SBOM AS s
    JOIN SBOM_CONTAINS AS sc
        ON sc.sbom_id = s.sbom_id
    JOIN V_OPEN_VULNERABILITY_FINDINGS AS f
        ON f.component_version_id = sc.component_version_id
    WHERE s.application_id = a.application_id
)
ORDER BY open_finding_count DESC, a.application_name;

-- Directed dependencies: the source version depends on the target version.
SELECT
    source_component.component_name AS dependent_component,
    source_version.version_number AS dependent_version,
    target_component.component_name AS dependency_component,
    target_version.version_number AS dependency_version,
    d.dependency_scope
FROM DEPENDENCY AS d
JOIN COMPONENT_VERSION AS source_version
    ON source_version.component_version_id = d.component_version_id
JOIN COMPONENT AS source_component
    ON source_component.component_id = source_version.component_id
JOIN COMPONENT_VERSION AS target_version
    ON target_version.component_version_id =
        d.depends_on_component_version_id
JOIN COMPONENT AS target_component
    ON target_component.component_id = target_version.component_id
ORDER BY dependent_component, dependent_version,
    dependency_component, dependency_version;

-- Component counts by license, including multiple license associations.
WITH version_licenses AS (
    SELECT component_version_id, license_id
    FROM COMPONENT_VERSION_LICENSE
    UNION
    SELECT component_version_id, license_id
    FROM COMPONENT_VERSION
    WHERE license_id IS NOT NULL
)
SELECT
    l.spdx_identifier,
    l.license_name,
    COUNT(DISTINCT cv.component_version_id) AS licensed_version_count,
    COUNT(DISTINCT cv.component_id) AS component_count
FROM LICENSE AS l
JOIN version_licenses AS vl
    ON vl.license_id = l.license_id
JOIN COMPONENT_VERSION AS cv
    ON cv.component_version_id = vl.component_version_id
GROUP BY l.license_id, l.spdx_identifier, l.license_name
HAVING COUNT(DISTINCT cv.component_version_id) > 0
ORDER BY licensed_version_count DESC, l.spdx_identifier;
