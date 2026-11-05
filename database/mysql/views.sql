CREATE OR REPLACE VIEW V_OPEN_VULNERABILITY_FINDINGS AS
SELECT
    v.vulnerability_id,
    v.cve_id,
    v.severity,
    v.published_date,
    cv.component_version_id,
    c.component_id,
    c.component_name,
    cv.version_number,
    cvv.remediation_status,
    cvv.identified_date
FROM VULNERABILITY AS v
INNER JOIN COMPONENT_VERSION_VULNERABILITY AS cvv
    ON cvv.vulnerability_id = v.vulnerability_id
INNER JOIN COMPONENT_VERSION AS cv
    ON cv.component_version_id = cvv.component_version_id
INNER JOIN COMPONENT AS c
    ON c.component_id = cv.component_id
WHERE cvv.remediation_status NOT IN ('resolved', 'wont_fix');
