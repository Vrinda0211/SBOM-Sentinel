DROP PROCEDURE IF EXISTS SP_APPLICATION_RISK_SUMMARY;

CREATE PROCEDURE SP_APPLICATION_RISK_SUMMARY(
    IN p_application_id CHAR(36)
)
SELECT
    a.application_id,
    a.application_name,
    COUNT(DISTINCT s.sbom_id) AS sbom_count,
    COUNT(DISTINCT sc.component_version_id) AS component_version_count,
    COALESCE(r.open_finding_count, 0) AS open_finding_count,
    COALESCE(r.critical_finding_count, 0) AS critical_finding_count,
    COALESCE(r.total_severity_score, 0) AS total_severity_score,
    r.average_severity_score,
    r.oldest_published_date,
    r.latest_published_date
FROM APPLICATION AS a
LEFT JOIN SBOM AS s
    ON s.application_id = a.application_id
LEFT JOIN SBOM_CONTAINS AS sc
    ON sc.sbom_id = s.sbom_id
LEFT JOIN (
    SELECT
        findings.application_id,
        COUNT(*) AS open_finding_count,
        SUM(findings.severity_score) AS total_severity_score,
        AVG(findings.severity_score) AS average_severity_score,
        SUM(findings.severity = 'CRITICAL') AS critical_finding_count,
        MIN(findings.published_date) AS oldest_published_date,
        MAX(findings.published_date) AS latest_published_date
    FROM (
        SELECT DISTINCT
            s.application_id,
            cvv.component_version_id,
            v.vulnerability_id,
            v.severity,
            v.published_date,
            CASE v.severity
                WHEN 'CRITICAL' THEN 4
                WHEN 'HIGH' THEN 3
                WHEN 'MEDIUM' THEN 2
                WHEN 'LOW' THEN 1
            END AS severity_score
        FROM SBOM AS s
        INNER JOIN SBOM_CONTAINS AS sc
            ON sc.sbom_id = s.sbom_id
        INNER JOIN COMPONENT_VERSION_VULNERABILITY AS cvv
            ON cvv.component_version_id = sc.component_version_id
        INNER JOIN VULNERABILITY AS v
            ON v.vulnerability_id = cvv.vulnerability_id
        WHERE cvv.remediation_status NOT IN ('resolved', 'wont_fix')
    ) AS findings
    GROUP BY findings.application_id
) AS r
    ON r.application_id = a.application_id
WHERE a.application_id = p_application_id
GROUP BY
    a.application_id,
    a.application_name,
    r.open_finding_count,
    r.critical_finding_count,
    r.total_severity_score,
    r.average_severity_score,
    r.oldest_published_date,
    r.latest_published_date;
