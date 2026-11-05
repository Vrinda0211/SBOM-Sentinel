import "server-only";

import { randomUUID } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
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

export interface ApplicationUsingComponent extends RowDataPacket {
  application_id: string;
  application_name: string;
  component_id: string;
  component_name: string;
  component_version_id: string;
  version_number: string;
}

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

export async function createLicense(input: LicenseInput): Promise<string> {
  validateLicense(input);
  const licenseId = randomUUID();
  await getMySqlPool().execute<ResultSetHeader>(
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

export async function createComponent(input: ComponentInput): Promise<string> {
  validateComponent(input);
  const componentId = randomUUID();
  await getMySqlPool().execute<ResultSetHeader>(
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

export async function addComponentVersion(
  componentId: string,
  input: AddComponentVersionInput,
): Promise<string> {
  requireUuid(componentId, "Component ID");
  validateText(input.versionNumber, "Version number", 100);
  requireIsoDate(input.releaseDate, "Release date");
  if (input.licenseId != null) {
    requireUuid(input.licenseId, "License ID");
  }
  const componentVersionId = randomUUID();
  await getMySqlPool().execute<ResultSetHeader>(
    `INSERT INTO COMPONENT_VERSION
       (component_version_id, component_id, license_id, version_number, release_date)
     VALUES (?, ?, ?, ?, ?)`,
    [
      componentVersionId,
      componentId,
      input.licenseId ?? null,
      input.versionNumber.trim(),
      input.releaseDate ?? null,
    ],
  );
  return componentVersionId;
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
