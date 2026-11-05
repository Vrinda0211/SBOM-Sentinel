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
