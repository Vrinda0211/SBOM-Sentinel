# Embedded SQL and query requirements

Application queries are in server-only TypeScript modules under
[`src/server/`](../../src/server/). They use the configured `mysql2` pool and
bound parameters. The reusable SQL demonstration is
[`submission_queries.sql`](../../database/mysql/demonstrations/submission_queries.sql).

## Requirement mapping

| SQL concept | Application or demonstration |
|---|---|
| INSERT | `registerApplication`, `createComponent`, `addComponentVersion`, `createLicense`, `createSbom`, `addDependency`, `createVulnerability`, and the SBOM import pipeline |
| SELECT | Application, SBOM, component/version/license, dependency, vulnerability, and graph-export readers |
| UPDATE | `updateApplication`, `updateRemediationStatus`, and dependency-scope update during import reuse |
| DELETE | `deleteApplication` (SBOMs and their containment rows cascade); `removeDependency` |
| INNER and LEFT JOIN | Application/component listings, vulnerability findings, and graph export |
| Multiple-table JOIN | Dependency/graph export and the vulnerability view |
| GROUP BY / HAVING / ORDER BY | Application and component listings; vulnerable-application filtering |
| COUNT | SBOM/component/finding counts and the risk summary |
| SUM / AVG / MIN / MAX | `SP_APPLICATION_RISK_SUMMARY`: weighted finding score, average severity score, and oldest/latest finding dates |
| `IN` subquery | Application SBOMs containing open HIGH/CRITICAL findings in the SQL demo |
| `EXISTS` subquery | `listApplicationsWithOpenVulnerabilities` |
| Scalar/correlated subquery | Per-application open-finding count in the SQL demo |

The risk score maps LOW/MEDIUM/HIGH/CRITICAL to 1/2/3/4 and aggregates unique
application-version-vulnerability findings. This gives `SUM` and `AVG` a
domain meaning instead of applying them to arbitrary identifiers or dates.
The date extrema refer to publication dates of unremediated findings.

## Representative statements

This useful left-join query keeps applications with no SBOMs in its result:

```sql
SELECT a.application_id, a.application_name, s.sbom_id, s.format
FROM APPLICATION AS a
LEFT JOIN SBOM AS s ON s.application_id = a.application_id
ORDER BY a.application_name, s.generated_at DESC;
```

This grouped query filters by a bound minimum vulnerable-version count:

```sql
SELECT a.application_id, a.application_name,
       COUNT(DISTINCT cv.component_version_id) AS vulnerable_version_count
FROM APPLICATION AS a
JOIN SBOM AS s ON s.application_id = a.application_id
JOIN SBOM_CONTAINS AS sc ON sc.sbom_id = s.sbom_id
JOIN COMPONENT_VERSION AS cv
  ON cv.component_version_id = sc.component_version_id
JOIN COMPONENT_VERSION_VULNERABILITY AS cvv
  ON cvv.component_version_id = cv.component_version_id
WHERE cvv.remediation_status NOT IN ('resolved', 'wont_fix')
GROUP BY a.application_id, a.application_name
HAVING COUNT(DISTINCT cv.component_version_id) >= ?
ORDER BY vulnerable_version_count DESC, a.application_name;
```

The application binds the `?` value; user-controlled values are not
interpolated into query text. The remaining meaningful examples (including
multi-license selection and graph dependencies) are in the SQL demo.

**Execution results:** SQL result sets against the configured application
database are not available because database credentials are not configured in
this checkout. Do not treat query examples as live execution evidence.
