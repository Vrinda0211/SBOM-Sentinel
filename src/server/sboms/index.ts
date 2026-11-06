import "server-only";

import { randomUUID } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getMySqlPool } from "@/lib/mysql";
import { inTransaction, requireUuid } from "@/server/database";

export interface CreateSbomInput {
  applicationId: string;
  format: string;
  componentVersionIds: string[];
}

export interface SbomRecord extends RowDataPacket {
  sbom_id: string;
  application_id: string;
  format: string;
  generated_at: Date;
  component_count: number;
}

export interface SbomGraphNode extends RowDataPacket {
  component_id: string;
  component_name: string;
  component_version_id: string;
  version_number: string;
  application_id: string | null;
  application_name: string | null;
  vulnerability_id: string | null;
  cve_id: string | null;
  severity: string | null;
}

export interface SbomGraphEdge extends RowDataPacket {
  source_component_version_id: string;
  source_component_id: string;
  source_component_name: string;
  target_component_version_id: string;
  target_component_id: string;
  target_component_name: string;
  dependency_scope: string | null;
}

export async function createSbom(input: CreateSbomInput): Promise<string> {
  requireUuid(input.applicationId, "Application ID");
  if (
    typeof input.format !== "string" ||
    input.format.trim().length === 0 ||
    input.format.length > 50
  ) {
    throw new TypeError("SBOM format must contain 1 to 50 characters.");
  }
  if (!Array.isArray(input.componentVersionIds)) {
    throw new TypeError("Component version IDs must be an array.");
  }
  for (const componentVersionId of input.componentVersionIds) {
    requireUuid(componentVersionId, "Component version ID");
  }
  if (new Set(input.componentVersionIds).size !== input.componentVersionIds.length) {
    throw new TypeError("SBOM component version IDs must not contain duplicates.");
  }

  const sbomId = randomUUID();
  await inTransaction(async (connection) => {
    await connection.execute<ResultSetHeader>(
      `INSERT INTO SBOM (sbom_id, application_id, format)
       VALUES (?, ?, ?)`,
      [sbomId, input.applicationId, input.format.trim()],
    );
    for (const componentVersionId of input.componentVersionIds) {
      await connection.execute<ResultSetHeader>(
        `INSERT INTO SBOM_CONTAINS (sbom_id, component_version_id)
         VALUES (?, ?)`,
        [sbomId, componentVersionId],
      );
    }
  });
  return sbomId;
}

export async function addSbomComponent(
  sbomId: string,
  componentVersionId: string,
): Promise<void> {
  requireUuid(sbomId, "SBOM ID");
  requireUuid(componentVersionId, "Component version ID");

  const [existingRows] = await getMySqlPool().execute<RowDataPacket[]>(
    `SELECT 1
     FROM SBOM_CONTAINS
     WHERE sbom_id = ? AND component_version_id = ?
     LIMIT 1`,
    [sbomId, componentVersionId],
  );
  if (existingRows.length > 0) {
    throw new TypeError("SBOM already contains this component version.");
  }

  await inTransaction(async (connection) => {
    await connection.execute<ResultSetHeader>(
      `INSERT INTO SBOM_CONTAINS (sbom_id, component_version_id)
       VALUES (?, ?)`,
      [sbomId, componentVersionId],
    );
  });
}

export async function listSbomsForApplication(
  applicationId: string,
): Promise<SbomRecord[]> {
  requireUuid(applicationId, "Application ID");
  const [rows] = await getMySqlPool().execute<SbomRecord[]>(
    `SELECT
       s.sbom_id,
       s.application_id,
       s.format,
       s.generated_at,
       COUNT(sc.component_version_id) AS component_count
     FROM SBOM AS s
     LEFT JOIN SBOM_CONTAINS AS sc ON sc.sbom_id = s.sbom_id
     WHERE s.application_id = ?
     GROUP BY s.sbom_id, s.application_id, s.format, s.generated_at
     ORDER BY s.generated_at DESC`,
    [applicationId],
  );
  return rows;
}

export async function getSbomGraphData(
  sbomId: string,
): Promise<{ nodes: SbomGraphNode[]; edges: SbomGraphEdge[] }> {
  requireUuid(sbomId, "SBOM ID");

  const [nodeRows] = await getMySqlPool().execute<SbomGraphNode[]>(
    `SELECT
       sc.component_version_id,
       cv.component_id,
       c.component_name,
       cv.version_number,
       s.application_id,
       a.application_name,
       v.vulnerability_id,
       v.cve_id,
       v.severity
     FROM SBOM_CONTAINS AS sc
     INNER JOIN COMPONENT_VERSION AS cv
       ON cv.component_version_id = sc.component_version_id
     INNER JOIN COMPONENT AS c
       ON c.component_id = cv.component_id
     LEFT JOIN SBOM AS s
       ON s.sbom_id = sc.sbom_id
     LEFT JOIN APPLICATION AS a
       ON a.application_id = s.application_id
     LEFT JOIN COMPONENT_VERSION_VULNERABILITY AS cvv
       ON cvv.component_version_id = sc.component_version_id
     LEFT JOIN VULNERABILITY AS v
       ON v.vulnerability_id = cvv.vulnerability_id
     WHERE sc.sbom_id = ?
     GROUP BY
       sc.component_version_id,
       cv.component_id,
       c.component_name,
       cv.version_number,
       s.application_id,
       a.application_name,
       v.vulnerability_id,
       v.cve_id,
       v.severity
     ORDER BY c.component_name ASC, cv.version_number ASC`,
    [sbomId],
  );

  const [edgeRows] = await getMySqlPool().execute<SbomGraphEdge[]>(
    `SELECT
       d.component_version_id AS source_component_version_id,
       source_cv.component_id AS source_component_id,
       source_component.component_name AS source_component_name,
       d.depends_on_component_version_id AS target_component_version_id,
       target_cv.component_id AS target_component_id,
       target_component.component_name AS target_component_name,
       d.dependency_scope
     FROM SBOM_CONTAINS AS sc
     INNER JOIN DEPENDENCY AS d
       ON d.component_version_id = sc.component_version_id
     INNER JOIN COMPONENT_VERSION AS source_cv
       ON source_cv.component_version_id = d.component_version_id
     INNER JOIN COMPONENT AS source_component
       ON source_component.component_id = source_cv.component_id
     INNER JOIN COMPONENT_VERSION AS target_cv
       ON target_cv.component_version_id = d.depends_on_component_version_id
     INNER JOIN COMPONENT AS target_component
       ON target_component.component_id = target_cv.component_id
     WHERE sc.sbom_id = ?
     ORDER BY source_component.component_name ASC, target_component.component_name ASC`,
    [sbomId],
  );

  return { nodes: nodeRows, edges: edgeRows };
}
