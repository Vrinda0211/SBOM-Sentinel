import "server-only";

import { randomUUID } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getMySqlPool } from "@/lib/mysql";
import {
  inTransaction,
  requireIsoDate,
  requireUuid,
} from "@/server/database";

export const REMEDIATION_STATUSES = [
  "open",
  "in_progress",
  "resolved",
  "wont_fix",
  "accepted_risk",
] as const;

export type RemediationStatus = (typeof REMEDIATION_STATUSES)[number];
export type VulnerabilitySeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface VulnerabilityInput {
  cveId: string;
  severity: VulnerabilitySeverity;
  publishedDate?: string | null;
  affectedComponentVersionIds: string[];
}

export interface VulnerabilityFinding extends RowDataPacket {
  vulnerability_id: string;
  cve_id: string;
  severity: VulnerabilitySeverity;
  published_date: string | null;
  component_version_id: string;
  component_id: string;
  component_name: string;
  version_number: string;
  remediation_status: RemediationStatus;
  identified_date: string | null;
  application_id: string | null;
  application_name: string | null;
}

export interface GraphVulnerabilityRecord extends RowDataPacket {
  vulnerability_id: string;
  cve_id: string;
  severity: VulnerabilitySeverity;
  component_version_id: string;
  component_id: string;
  component_name: string;
  version_number: string;
  remediation_status: RemediationStatus;
}

export interface AffectedApplication extends RowDataPacket {
  application_id: string;
  application_name: string;
  description: string | null;
}

function isSeverity(value: string): value is VulnerabilitySeverity {
  return ["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(value);
}

export async function createVulnerability(
  input: VulnerabilityInput,
): Promise<string> {
  if (
    typeof input.cveId !== "string" ||
    input.cveId.trim().length === 0 ||
    input.cveId.length > 50
  ) {
    throw new TypeError("CVE ID must contain 1 to 50 characters.");
  }
  if (!isSeverity(input.severity)) {
    throw new TypeError("Severity must be LOW, MEDIUM, HIGH, or CRITICAL.");
  }
  requireIsoDate(input.publishedDate, "Published date");
  if (!Array.isArray(input.affectedComponentVersionIds)) {
    throw new TypeError("Affected component version IDs must be an array.");
  }
  for (const componentVersionId of input.affectedComponentVersionIds) {
    requireUuid(componentVersionId, "Component version ID");
  }
  if (
    new Set(input.affectedComponentVersionIds).size !==
    input.affectedComponentVersionIds.length
  ) {
    throw new TypeError("Affected component version IDs must not contain duplicates.");
  }

  const vulnerabilityId = randomUUID();
  await inTransaction(async (connection) => {
    await connection.execute<ResultSetHeader>(
      `INSERT INTO VULNERABILITY
         (vulnerability_id, cve_id, severity, published_date)
       VALUES (?, ?, ?, ?)`,
      [
        vulnerabilityId,
        input.cveId.trim(),
        input.severity,
        input.publishedDate ?? null,
      ],
    );
    for (const componentVersionId of input.affectedComponentVersionIds) {
      await connection.execute<ResultSetHeader>(
        `INSERT INTO COMPONENT_VERSION_VULNERABILITY
           (component_version_id, vulnerability_id, identified_date)
         VALUES (?, ?, CURRENT_DATE)`,
        [componentVersionId, vulnerabilityId],
      );
    }
  });
  return vulnerabilityId;
}

export async function updateRemediationStatus(
  componentVersionId: string,
  vulnerabilityId: string,
  status: RemediationStatus,
): Promise<boolean> {
  requireUuid(componentVersionId, "Component version ID");
  requireUuid(vulnerabilityId, "Vulnerability ID");
  if (!REMEDIATION_STATUSES.includes(status)) {
    throw new TypeError("Invalid remediation status.");
  }
  const [result] = await getMySqlPool().execute<ResultSetHeader>(
    `UPDATE COMPONENT_VERSION_VULNERABILITY
     SET remediation_status = ?
     WHERE component_version_id = ? AND vulnerability_id = ?`,
    [status, componentVersionId, vulnerabilityId],
  );
  return result.affectedRows === 1;
}

export async function listVulnerabilityFindings(): Promise<
  VulnerabilityFinding[]
> {
  const [rows] = await getMySqlPool().execute<VulnerabilityFinding[]>(
    `SELECT
       f.vulnerability_id,
       f.cve_id,
       f.severity,
       f.published_date,
       f.component_version_id,
       f.component_id,
       f.component_name,
       f.version_number,
       f.remediation_status,
       f.identified_date,
       a.application_id,
       a.application_name
     FROM V_OPEN_VULNERABILITY_FINDINGS AS f
     LEFT JOIN SBOM_CONTAINS AS sc
       ON sc.component_version_id = f.component_version_id
     LEFT JOIN SBOM AS s ON s.sbom_id = sc.sbom_id
     LEFT JOIN APPLICATION AS a ON a.application_id = s.application_id
     ORDER BY
       FIELD(f.severity, 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'),
       f.published_date DESC,
       f.cve_id ASC,
       a.application_name ASC`,
  );
  return rows;
}

export async function listVulnerabilitiesForGraph(): Promise<
  GraphVulnerabilityRecord[]
> {
  const [rows] = await getMySqlPool().execute<GraphVulnerabilityRecord[]>(
    `SELECT
       f.vulnerability_id,
       f.cve_id,
       f.severity,
       f.component_version_id,
       f.component_id,
       f.component_name,
       f.version_number,
       f.remediation_status
     FROM V_OPEN_VULNERABILITY_FINDINGS AS f
     ORDER BY f.cve_id ASC, f.component_version_id ASC`,
  );
  return rows;
}

export async function listApplicationsWithOpenVulnerabilities(): Promise<
  AffectedApplication[]
> {
  const [rows] = await getMySqlPool().execute<AffectedApplication[]>(
    `SELECT a.application_id, a.application_name, a.description
     FROM APPLICATION AS a
     WHERE EXISTS (
       SELECT 1
       FROM SBOM AS s
       INNER JOIN SBOM_CONTAINS AS sc ON sc.sbom_id = s.sbom_id
       INNER JOIN COMPONENT_VERSION_VULNERABILITY AS cvv
         ON cvv.component_version_id = sc.component_version_id
       WHERE s.application_id = a.application_id
         AND cvv.remediation_status NOT IN ('resolved', 'wont_fix')
     )
     ORDER BY a.application_name ASC`,
  );
  return rows;
}
