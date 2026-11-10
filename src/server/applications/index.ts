import "server-only";

import { randomUUID } from "node:crypto";
import type {
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";
import { getMySqlPool } from "@/lib/mysql";
import { requireUuid } from "@/server/database";

export interface ApplicationInput {
  applicationName: string;
  description?: string | null;
}

export interface ApplicationRecord extends RowDataPacket {
  application_id: string;
  application_name: string;
  description: string | null;
  created_at: Date;
  sbom_count?: number;
  vulnerable_version_count?: number;
}

export interface ApplicationRiskSummary extends RowDataPacket {
  application_id: string;
  application_name: string;
  sbom_count: number;
  component_version_count: number;
  open_finding_count: number;
  critical_finding_count: number;
  total_severity_score: number;
  average_severity_score: number | null;
  oldest_published_date: Date | null;
  latest_published_date: Date | null;
}

type SqlExecutor = Pick<PoolConnection, "execute">;

function validateInput(input: ApplicationInput): void {
  if (
    typeof input.applicationName !== "string" ||
    input.applicationName.trim().length === 0 ||
    input.applicationName.length > 255
  ) {
    throw new TypeError("Application name must contain 1 to 255 characters.");
  }
  if (
    input.description !== undefined &&
    input.description !== null &&
    typeof input.description !== "string"
  ) {
    throw new TypeError("Application description must be a string or null.");
  }
}

function validateId(applicationId: string): void {
  requireUuid(applicationId, "Application ID");
}

export async function registerApplication(
  input: ApplicationInput,
): Promise<string> {
  return registerApplicationWithExecutor(getMySqlPool(), input);
}

export async function registerApplicationInTransaction(
  connection: PoolConnection,
  input: ApplicationInput,
): Promise<string> {
  return registerApplicationWithExecutor(connection, input);
}

async function registerApplicationWithExecutor(
  executor: SqlExecutor,
  input: ApplicationInput,
): Promise<string> {
  validateInput(input);
  const applicationId = randomUUID();
  await executor.execute<ResultSetHeader>(
    `INSERT INTO APPLICATION (application_id, application_name, description)
     VALUES (?, ?, ?)`,
    [applicationId, input.applicationName.trim(), input.description ?? null],
  );
  return applicationId;
}

export async function listApplications(): Promise<ApplicationRecord[]> {
  const [rows] = await getMySqlPool().execute<ApplicationRecord[]>(
    `SELECT
       a.application_id,
       a.application_name,
       a.description,
       a.created_at,
       COUNT(DISTINCT s.sbom_id) AS sbom_count,
       COUNT(DISTINCT CASE
         WHEN v.vulnerability_id IS NOT NULL
           AND cvv.remediation_status NOT IN ('resolved', 'wont_fix')
         THEN cv.component_version_id
       END) AS vulnerable_version_count
     FROM APPLICATION AS a
     LEFT JOIN SBOM AS s ON s.application_id = a.application_id
     LEFT JOIN SBOM_CONTAINS AS sc ON sc.sbom_id = s.sbom_id
     LEFT JOIN COMPONENT_VERSION AS cv
       ON cv.component_version_id = sc.component_version_id
     LEFT JOIN COMPONENT_VERSION_VULNERABILITY AS cvv
       ON cvv.component_version_id = cv.component_version_id
     LEFT JOIN VULNERABILITY AS v
       ON v.vulnerability_id = cvv.vulnerability_id
     GROUP BY a.application_id, a.application_name, a.description, a.created_at
     ORDER BY a.created_at DESC, a.application_name ASC`,
  );
  return rows;
}

export async function listApplicationsWithAtLeastVulnerableVersions(
  minimumCount: number,
): Promise<ApplicationRecord[]> {
  if (!Number.isInteger(minimumCount) || minimumCount < 0) {
    throw new TypeError("Minimum vulnerable version count must be a non-negative integer.");
  }
  const [rows] = await getMySqlPool().execute<ApplicationRecord[]>(
    `SELECT
       a.application_id,
       a.application_name,
       a.description,
       a.created_at,
       COUNT(DISTINCT cv.component_version_id) AS vulnerable_version_count
     FROM APPLICATION AS a
     INNER JOIN SBOM AS s ON s.application_id = a.application_id
     INNER JOIN SBOM_CONTAINS AS sc ON sc.sbom_id = s.sbom_id
     INNER JOIN COMPONENT_VERSION AS cv
       ON cv.component_version_id = sc.component_version_id
     INNER JOIN COMPONENT_VERSION_VULNERABILITY AS cvv
       ON cvv.component_version_id = cv.component_version_id
     WHERE cvv.remediation_status NOT IN ('resolved', 'wont_fix')
     GROUP BY a.application_id, a.application_name, a.description, a.created_at
     HAVING COUNT(DISTINCT cv.component_version_id) >= ?
     ORDER BY vulnerable_version_count DESC, a.application_name ASC`,
    [minimumCount],
  );
  return rows;
}

export async function getApplication(
  applicationId: string,
): Promise<ApplicationRecord | null> {
  validateId(applicationId);
  const [rows] = await getMySqlPool().execute<ApplicationRecord[]>(
    `SELECT
       a.application_id,
       a.application_name,
       a.description,
       a.created_at,
       COUNT(DISTINCT s.sbom_id) AS sbom_count,
       COUNT(DISTINCT CASE
         WHEN v.vulnerability_id IS NOT NULL
           AND cvv.remediation_status NOT IN ('resolved', 'wont_fix')
         THEN cv.component_version_id
       END) AS vulnerable_version_count
     FROM APPLICATION AS a
     LEFT JOIN SBOM AS s ON s.application_id = a.application_id
     LEFT JOIN SBOM_CONTAINS AS sc ON sc.sbom_id = s.sbom_id
     LEFT JOIN COMPONENT_VERSION AS cv
       ON cv.component_version_id = sc.component_version_id
     LEFT JOIN COMPONENT_VERSION_VULNERABILITY AS cvv
       ON cvv.component_version_id = cv.component_version_id
     LEFT JOIN VULNERABILITY AS v
       ON v.vulnerability_id = cvv.vulnerability_id
     WHERE a.application_id = ?
     GROUP BY a.application_id, a.application_name, a.description, a.created_at`,
    [applicationId],
  );
  return rows[0] ?? null;
}

export async function getApplicationRiskSummary(
  applicationId: string,
): Promise<ApplicationRiskSummary | null> {
  validateId(applicationId);
  const [results] = await getMySqlPool().execute<
    ApplicationRiskSummary[][]
  >("CALL SP_APPLICATION_RISK_SUMMARY(?)", [applicationId]);
  return results[0]?.[0] ?? null;
}

export async function updateApplication(
  applicationId: string,
  input: ApplicationInput,
): Promise<boolean> {
  validateId(applicationId);
  validateInput(input);
  const [result] = await getMySqlPool().execute<ResultSetHeader>(
    `UPDATE APPLICATION
     SET application_name = ?, description = ?
     WHERE application_id = ?`,
    [input.applicationName.trim(), input.description ?? null, applicationId],
  );
  return result.affectedRows === 1;
}

export async function deleteApplication(
  applicationId: string,
): Promise<boolean> {
  validateId(applicationId);
  const [result] = await getMySqlPool().execute<ResultSetHeader>(
    "DELETE FROM APPLICATION WHERE application_id = ?",
    [applicationId],
  );
  return result.affectedRows === 1;
}
