import "server-only";

import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getMySqlPool } from "@/lib/mysql";
import { requireUuid } from "@/server/database";

export interface DependencyInput {
  componentVersionId: string;
  dependsOnComponentVersionId: string;
  dependencyScope?: string | null;
}

export interface DependencyRecord extends RowDataPacket {
  component_version_id: string;
  component_id: string;
  component_name: string;
  version_number: string;
  depends_on_component_version_id: string;
  depends_on_component_id: string;
  depends_on_component_name: string;
  depends_on_version_number: string;
  dependency_scope: string | null;
}

export async function addDependency(input: DependencyInput): Promise<void> {
  requireUuid(input.componentVersionId, "Component version ID");
  requireUuid(input.dependsOnComponentVersionId, "Dependency target version ID");
  if (input.componentVersionId === input.dependsOnComponentVersionId) {
    throw new TypeError("A component version cannot depend on itself.");
  }
  if (
    input.dependencyScope != null &&
    (typeof input.dependencyScope !== "string" ||
      input.dependencyScope.trim().length === 0 ||
      input.dependencyScope.length > 50)
  ) {
    throw new TypeError("Dependency scope must contain 1 to 50 characters.");
  }

  const normalizedScope = input.dependencyScope?.trim() ?? null;
  const [existingRows] = await getMySqlPool().execute<RowDataPacket[]>(
    `SELECT 1
     FROM DEPENDENCY
     WHERE component_version_id = ?
       AND depends_on_component_version_id = ?
     LIMIT 1`,
    [input.componentVersionId, input.dependsOnComponentVersionId],
  );
  if (existingRows.length > 0) {
    throw new TypeError("This dependency already exists.");
  }

  await getMySqlPool().execute<ResultSetHeader>(
    `INSERT INTO DEPENDENCY
       (component_version_id, depends_on_component_version_id, dependency_scope)
     VALUES (?, ?, ?)`,
    [
      input.componentVersionId,
      input.dependsOnComponentVersionId,
      normalizedScope,
    ],
  );
}

export async function listDependenciesForVersion(
  componentVersionId: string,
): Promise<DependencyRecord[]> {
  requireUuid(componentVersionId, "Component version ID");
  const [rows] = await getMySqlPool().execute<DependencyRecord[]>(
    `SELECT
       d.component_version_id,
       source.component_id,
       source_component.component_name,
       source.version_number,
       d.depends_on_component_version_id,
       target.component_id AS depends_on_component_id,
       target_component.component_name AS depends_on_component_name,
       target.version_number AS depends_on_version_number,
       d.dependency_scope
     FROM DEPENDENCY AS d
     INNER JOIN COMPONENT_VERSION AS source
       ON source.component_version_id = d.component_version_id
     INNER JOIN COMPONENT AS source_component
       ON source_component.component_id = source.component_id
     INNER JOIN COMPONENT_VERSION AS target
       ON target.component_version_id = d.depends_on_component_version_id
     INNER JOIN COMPONENT AS target_component
       ON target_component.component_id = target.component_id
     WHERE d.component_version_id = ?
     ORDER BY target_component.component_name ASC, target.version_number ASC`,
    [componentVersionId],
  );
  return rows;
}

export async function removeDependency(
  componentVersionId: string,
  dependsOnComponentVersionId: string,
): Promise<boolean> {
  requireUuid(componentVersionId, "Component version ID");
  requireUuid(dependsOnComponentVersionId, "Dependency target version ID");
  const [result] = await getMySqlPool().execute<ResultSetHeader>(
    `DELETE FROM DEPENDENCY
     WHERE component_version_id = ?
       AND depends_on_component_version_id = ?`,
    [componentVersionId, dependsOnComponentVersionId],
  );
  return result.affectedRows === 1;
}
