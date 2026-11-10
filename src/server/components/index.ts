import "server-only";

import { randomUUID } from "node:crypto";
import type {
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";
import { getMySqlPool } from "@/lib/mysql";
import { requireIsoDate, requireUuid } from "@/server/database";

export interface ComponentInput {
  componentName: string;
  componentType?: string | null;
}

export interface AddComponentVersionInput {
  versionNumber: string;
  licenseId?: string | null;
  releaseDate?: string | null;
}

export interface LicenseInput {
  licenseName: string;
  spdxIdentifier: string;
  licenseType?: string | null;
}

export interface ComponentRecord extends RowDataPacket {
  component_id: string;
  component_name: string;
  component_type: string | null;
  version_count: number;
}

export interface ComponentVersionRecord extends RowDataPacket {
  component_version_id: string;
  component_id: string;
  component_name: string;
  version_number: string;
  release_date: string | null;
  license_id: string | null;
  license_name: string | null;
  spdx_identifier: string | null;
}

export interface LicenseRecord extends RowDataPacket {
  license_id: string;
  license_name: string;
  spdx_identifier: string;
  license_type: string | null;
}

export interface ComponentVersionLicenseRecord extends LicenseRecord {
  component_version_id: string;
}

export interface ApplicationUsingComponent extends RowDataPacket {
  application_id: string;
  application_name: string;
  component_id: string;
  component_name: string;
  component_version_id: string;
  version_number: string;
}

type SqlExecutor = Pick<PoolConnection, "execute">;

function validateText(value: string, field: string, maxLength: number): void {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > maxLength
  ) {
    throw new TypeError(`${field} must contain 1 to ${maxLength} characters.`);
  }
}

function validateComponent(input: ComponentInput): void {
  validateText(input.componentName, "Component name", 255);
  if (input.componentType != null) {
    validateText(input.componentType, "Component type", 100);
  }
}

function validateLicense(input: LicenseInput): void {
  validateText(input.licenseName, "License name", 255);
  validateText(input.spdxIdentifier, "SPDX identifier", 100);
  if (input.licenseType != null) {
    validateText(input.licenseType, "License type", 50);
  }
}

export async function listComponents(): Promise<ComponentRecord[]> {
  const [rows] = await getMySqlPool().execute<ComponentRecord[]>(
    `SELECT
       c.component_id,
       c.component_name,
       c.component_type,
       COUNT(cv.component_version_id) AS version_count
     FROM COMPONENT AS c
     LEFT JOIN COMPONENT_VERSION AS cv ON cv.component_id = c.component_id
     GROUP BY c.component_id, c.component_name, c.component_type
     ORDER BY c.component_name ASC`,
  );
  return rows;
}

export async function listComponentVersions(
  componentId: string,
): Promise<ComponentVersionRecord[]> {
  requireUuid(componentId, "Component ID");
  const [rows] = await getMySqlPool().execute<ComponentVersionRecord[]>(
    `SELECT
       cv.component_version_id,
       cv.component_id,
       c.component_name,
       cv.version_number,
       cv.release_date,
       l.license_id,
       l.license_name,
       l.spdx_identifier
     FROM COMPONENT_VERSION AS cv
     INNER JOIN COMPONENT AS c ON c.component_id = cv.component_id
     LEFT JOIN LICENSE AS l ON l.license_id = cv.license_id
     WHERE cv.component_id = ?
     ORDER BY cv.release_date DESC, cv.version_number ASC`,
    [componentId],
  );
  return rows;
}

export async function listLicenses(): Promise<LicenseRecord[]> {
  const [rows] = await getMySqlPool().execute<LicenseRecord[]>(
    `SELECT license_id, license_name, spdx_identifier, license_type
     FROM LICENSE
     ORDER BY license_name ASC`,
  );
  return rows;
}

async function createLicenseWithExecutor(
  executor: SqlExecutor,
  input: LicenseInput,
): Promise<string> {
  validateLicense(input);
  const licenseId = randomUUID();
  await executor.execute<ResultSetHeader>(
    `INSERT INTO LICENSE
       (license_id, license_name, spdx_identifier, license_type)
     VALUES (?, ?, ?, ?)`,
    [
      licenseId,
      input.licenseName.trim(),
      input.spdxIdentifier.trim(),
      input.licenseType?.trim() ?? null,
    ],
  );
  return licenseId;
}

export async function createLicenseInTransaction(
  connection: PoolConnection,
  input: LicenseInput,
): Promise<string> {
  return createLicenseWithExecutor(connection, input);
}

export async function createLicense(input: LicenseInput): Promise<string> {
  return createLicenseWithExecutor(getMySqlPool(), input);
}

async function createComponentWithExecutor(
  executor: SqlExecutor,
  input: ComponentInput,
): Promise<string> {
  validateComponent(input);
  const componentId = randomUUID();
  await executor.execute<ResultSetHeader>(
    `INSERT INTO COMPONENT (component_id, component_name, component_type)
     VALUES (?, ?, ?)`,
    [
      componentId,
      input.componentName.trim(),
      input.componentType?.trim() ?? null,
    ],
  );
  return componentId;
}

export async function createComponentInTransaction(
  connection: PoolConnection,
  input: ComponentInput,
): Promise<string> {
  return createComponentWithExecutor(connection, input);
}

export async function createComponent(input: ComponentInput): Promise<string> {
  return createComponentWithExecutor(getMySqlPool(), input);
}

async function addComponentVersionWithExecutor(
  executor: SqlExecutor,
  componentId: string,
  input: AddComponentVersionInput,
): Promise<string> {
  requireUuid(componentId, "Component ID");
  validateText(input.versionNumber, "Version number", 100);
  requireIsoDate(input.releaseDate, "Release date");
  if (input.licenseId != null) {
    requireUuid(input.licenseId, "License ID");
  }

  const normalizedVersionNumber = input.versionNumber.trim();
  const [existingRows] = await executor.execute<RowDataPacket[]>(
    `SELECT 1
     FROM COMPONENT_VERSION
     WHERE component_id = ? AND version_number = ?
     LIMIT 1`,
    [componentId, normalizedVersionNumber],
  );
  if (existingRows.length > 0) {
    throw new TypeError("A component version with this number already exists.");
  }

  const componentVersionId = randomUUID();
  await executor.execute<ResultSetHeader>(
    `INSERT INTO COMPONENT_VERSION
       (component_version_id, component_id, license_id, version_number, release_date)
     VALUES (?, ?, ?, ?, ?)`,
    [
      componentVersionId,
      componentId,
      input.licenseId ?? null,
      normalizedVersionNumber,
      input.releaseDate ?? null,
    ],
  );
  return componentVersionId;
}

export async function addComponentVersionInTransaction(
  connection: PoolConnection,
  componentId: string,
  input: AddComponentVersionInput,
): Promise<string> {
  return addComponentVersionWithExecutor(connection, componentId, input);
}

export async function addComponentVersion(
  componentId: string,
  input: AddComponentVersionInput,
): Promise<string> {
  return addComponentVersionWithExecutor(getMySqlPool(), componentId, input);
}

export async function addComponentVersionLicenseInTransaction(
  connection: PoolConnection,
  componentVersionId: string,
  licenseId: string,
): Promise<void> {
  requireUuid(componentVersionId, "Component version ID");
  requireUuid(licenseId, "License ID");
  await connection.execute<ResultSetHeader>(
    `INSERT INTO COMPONENT_VERSION_LICENSE (component_version_id, license_id)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE license_id = license_id`,
    [componentVersionId, licenseId],
  );
}

export async function listLicensesForComponentVersion(
  componentVersionId: string,
): Promise<LicenseRecord[]> {
  requireUuid(componentVersionId, "Component version ID");
  const [rows] = await getMySqlPool().execute<LicenseRecord[]>(
    `SELECT license.license_id, license.license_name,
       license.spdx_identifier, license.license_type
     FROM LICENSE AS license
     INNER JOIN (
       SELECT license_id
       FROM COMPONENT_VERSION_LICENSE
       WHERE component_version_id = ?
       UNION
       SELECT license_id
       FROM COMPONENT_VERSION
       WHERE component_version_id = ? AND license_id IS NOT NULL
     ) AS linked_license ON linked_license.license_id = license.license_id
     ORDER BY license.license_name ASC, license.spdx_identifier ASC`,
    [componentVersionId, componentVersionId],
  );
  return rows;
}

export async function listLicensesForComponentVersions(
  componentVersionIds: string[],
): Promise<ComponentVersionLicenseRecord[]> {
  if (!Array.isArray(componentVersionIds)) {
    throw new TypeError("Component version IDs must be an array.");
  }
  const normalizedIds = [...new Set(
    componentVersionIds.map((componentVersionId) => {
      requireUuid(componentVersionId, "Component version ID");
      return componentVersionId.toLowerCase();
    }),
  )];
  if (normalizedIds.length === 0) {
    return [];
  }
  const placeholders = normalizedIds.map(() => "?").join(", ");
  const [rows] = await getMySqlPool().execute<ComponentVersionLicenseRecord[]>(
    `SELECT linked.component_version_id,
       license.license_id, license.license_name,
       license.spdx_identifier, license.license_type
     FROM (
       SELECT component_version_id, license_id
       FROM COMPONENT_VERSION_LICENSE
       WHERE component_version_id IN (${placeholders})
       UNION
       SELECT component_version_id, license_id
       FROM COMPONENT_VERSION
       WHERE component_version_id IN (${placeholders})
         AND license_id IS NOT NULL
     ) AS linked
     INNER JOIN LICENSE AS license ON license.license_id = linked.license_id
     ORDER BY linked.component_version_id ASC, license.license_name ASC,
       license.spdx_identifier ASC`,
    [...normalizedIds, ...normalizedIds],
  );
  return rows;
}

export async function findApplicationsUsingComponent(
  componentId: string,
): Promise<ApplicationUsingComponent[]> {
  requireUuid(componentId, "Component ID");
  const [rows] = await getMySqlPool().execute<ApplicationUsingComponent[]>(
    `SELECT DISTINCT
       a.application_id,
       a.application_name,
       c.component_id,
       c.component_name,
       cv.component_version_id,
       cv.version_number
     FROM APPLICATION AS a
     INNER JOIN SBOM AS s ON s.application_id = a.application_id
     INNER JOIN SBOM_CONTAINS AS sc ON sc.sbom_id = s.sbom_id
     INNER JOIN COMPONENT_VERSION AS cv
       ON cv.component_version_id = sc.component_version_id
     INNER JOIN COMPONENT AS c ON c.component_id = cv.component_id
     WHERE c.component_id = ?
     ORDER BY a.application_name ASC, cv.version_number ASC`,
    [componentId],
  );
  return rows;
}
