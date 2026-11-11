import "server-only";

import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import {
  registerApplicationInTransaction,
  type ApplicationInput,
} from "@/server/applications";
import {
  addComponentVersionInTransaction,
  addComponentVersionLicenseInTransaction,
  createComponentInTransaction,
  createLicenseInTransaction,
} from "@/server/components";
import { ensureDependencyInTransaction } from "@/server/dependencies";
import {
  parseSbomContent,
  SbomValidationError,
  type NormalizedSbom,
  type SbomPackage,
} from "@/server/sbom-parser";
import {
  addVulnerabilityAffectedVersionInTransaction,
  ensureVulnerabilityInTransaction,
} from "@/server/vulnerabilities";
import { inTransaction } from "@/server/database";
import {
  createSbomInTransaction,
  type CreateSbomInput,
} from "@/server/sboms";

const MAX_PACKAGES = 2_500;
const MAX_DEPENDENCIES = 10_000;
const MAX_VULNERABILITIES = 2_500;
const UNKNOWN_VERSION = "UNKNOWN";

interface ApplicationIdRow extends RowDataPacket {
  application_id: string;
}

interface ComponentIdRow extends RowDataPacket {
  component_id: string;
}

interface LicenseIdRow extends RowDataPacket {
  license_id: string;
}

interface ComponentVersionRow extends RowDataPacket {
  component_version_id: string;
}

export interface SbomImportResult {
  applicationId: string;
  sbomId: string;
  format: NormalizedSbom["format"];
  packageCount: number;
  componentVersionCount: number;
  dependencyCount: number;
  vulnerabilityCount: number;
  createdApplication: boolean;
  createdComponentCount: number;
  reusedComponentCount: number;
  createdVersionCount: number;
  reusedVersionCount: number;
}

export class SbomImportConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SbomImportConflictError";
  }
}

function getApplicationInput(
  sbom: NormalizedSbom,
  applicationNameOverride?: string,
): ApplicationInput {
  const applicationName =
    applicationNameOverride?.trim() ||
    sbom.application?.name ||
    sbom.metadata.name;
  if (!applicationName) {
    throw new SbomValidationError(
      "invalid_document",
      "$.metadata",
      "Application name is missing; provide one before importing this SBOM.",
    );
  }
  const description =
    sbom.application?.description ??
    (sbom.application ? null : `Imported from ${sbom.format} SBOM.`);
  return { applicationName, description };
}

function validateImportSize(sbom: NormalizedSbom): void {
  if (sbom.components.length > MAX_PACKAGES) {
    throw new SbomValidationError(
      "invalid_document",
      "$.components",
      `SBOM may contain at most ${MAX_PACKAGES} packages.`,
    );
  }
  if (sbom.dependencies.length > MAX_DEPENDENCIES) {
    throw new SbomValidationError(
      "invalid_document",
      "$.dependencies",
      `SBOM may contain at most ${MAX_DEPENDENCIES} dependency relationships.`,
    );
  }
  if (sbom.vulnerabilities.length > MAX_VULNERABILITIES) {
    throw new SbomValidationError(
      "invalid_document",
      "$.vulnerabilities",
      `SBOM may contain at most ${MAX_VULNERABILITIES} vulnerabilities.`,
    );
  }
}

async function findOrCreateApplication(
  connection: PoolConnection,
  input: ApplicationInput,
): Promise<{ id: string; created: boolean }> {
  const [rows] = await connection.execute<ApplicationIdRow[]>(
    `SELECT application_id
     FROM APPLICATION
     WHERE application_name = ? AND description <=> ?
     ORDER BY created_at ASC
     LIMIT 2
     FOR UPDATE`,
    [input.applicationName.trim(), input.description ?? null],
  );
  if (rows.length > 1) {
    throw new SbomImportConflictError(
      `Multiple applications match "${input.applicationName}". Resolve the duplicate application records before importing.`,
    );
  }
  if (rows[0]) {
    return { id: rows[0].application_id, created: false };
  }
  return {
    id: await registerApplicationInTransaction(connection, input),
    created: true,
  };
}

async function findOrCreateComponent(
  connection: PoolConnection,
  pkg: SbomPackage,
): Promise<{ id: string; created: boolean }> {
  const [rows] = await connection.execute<ComponentIdRow[]>(
    `SELECT component_id
     FROM COMPONENT
     WHERE component_name = ? AND component_type <=> ?
     LIMIT 2
     FOR UPDATE`,
    [pkg.name.trim(), pkg.type?.trim() ?? null],
  );
  if (rows.length > 1) {
    throw new SbomImportConflictError(
      `Multiple components match "${pkg.name}" with the same type. Resolve the duplicate component records before importing.`,
    );
  }
  if (rows[0]) {
    return { id: rows[0].component_id, created: false };
  }
  return {
    id: await createComponentInTransaction(connection, {
      componentName: pkg.name,
      componentType: pkg.type,
    }),
    created: true,
  };
}

async function findOrCreateLicense(
  connection: PoolConnection,
  identifier: string,
): Promise<string> {
  const normalizedIdentifier = identifier.trim();
  if (normalizedIdentifier.length > 100) {
    throw new TypeError(
      `License identifier "${normalizedIdentifier}" exceeds 100 characters and cannot be stored.`,
    );
  }
  const [rows] = await connection.execute<LicenseIdRow[]>(
    `SELECT license_id
     FROM LICENSE
     WHERE BINARY spdx_identifier = BINARY ?
     LIMIT 1
     FOR UPDATE`,
    [normalizedIdentifier],
  );
  if (rows[0]) {
    return rows[0].license_id;
  }
  return createLicenseInTransaction(connection, {
    licenseName: normalizedIdentifier,
    spdxIdentifier: normalizedIdentifier,
  });
}

function getPackagesForPersistence(sbom: NormalizedSbom): SbomPackage[] {
  const packageIds = new Set(sbom.components.map((pkg) => pkg.id));
  const applicationIsDependency = sbom.dependencies.some(
    ({ sourceId, targetId }) =>
      sourceId === sbom.application?.id || targetId === sbom.application?.id,
  );
  const packages = [...sbom.components];
  if (
    sbom.application &&
    applicationIsDependency &&
    !packageIds.has(sbom.application.id)
  ) {
    packages.push(sbom.application);
  }
  if (packages.length > MAX_PACKAGES) {
    throw new SbomValidationError(
      "invalid_document",
      "$.components",
      `SBOM may contain at most ${MAX_PACKAGES} packages.`,
    );
  }
  return packages;
}

async function findComponentVersion(
  connection: PoolConnection,
  componentId: string,
  version: string,
): Promise<string | null> {
  const [rows] = await connection.execute<ComponentVersionRow[]>(
    `SELECT component_version_id
     FROM COMPONENT_VERSION
     WHERE component_id = ? AND version_number = ?
     LIMIT 1
     FOR UPDATE`,
    [componentId, version],
  );
  return rows[0]?.component_version_id ?? null;
}

async function persistParsedSbom(
  sbom: NormalizedSbom,
  applicationInput: ApplicationInput,
): Promise<SbomImportResult> {
  validateImportSize(sbom);
  const packages = getPackagesForPersistence(sbom);
  const packagesById = new Map(packages.map((pkg) => [pkg.id, pkg]));
  for (const dependency of sbom.dependencies) {
    if (
      !packagesById.has(dependency.sourceId) ||
      !packagesById.has(dependency.targetId)
    ) {
      throw new SbomValidationError(
        "invalid_dependency_reference",
        "$.dependencies",
        "A dependency references the application package, but that package is not available for versioned persistence.",
      );
    }
    for (const vulnerability of sbom.vulnerabilities) {
      for (const componentId of vulnerability.affectedComponentIds) {
        if (!packagesById.has(componentId)) {
          throw new SbomValidationError(
            "invalid_vulnerability_reference",
            "$.vulnerabilities",
            `Vulnerability "${vulnerability.id}" references a component that is not available for versioned persistence.`,
          );
        }
      }
    }
  }

  return inTransaction(async (connection) => {
    const application = await findOrCreateApplication(
      connection,
      applicationInput,
    );
    const versionIds = new Map<string, string>();
    let createdComponentCount = 0;
    let reusedComponentCount = 0;
    let createdVersionCount = 0;
    let reusedVersionCount = 0;

    for (const pkg of packages) {
      const component = await findOrCreateComponent(connection, pkg);
      if (component.created) {
        createdComponentCount += 1;
      } else {
        reusedComponentCount += 1;
      }

      const licenseIds: string[] = [];
      for (const license of new Set(pkg.licenses)) {
        licenseIds.push(await findOrCreateLicense(connection, license));
      }
      const versionNumber = pkg.version ?? UNKNOWN_VERSION;
      let componentVersionId = await findComponentVersion(
        connection,
        component.id,
        versionNumber,
      );
      if (componentVersionId) {
        reusedVersionCount += 1;
      } else {
        componentVersionId = await addComponentVersionInTransaction(
          connection,
          component.id,
          {
            versionNumber,
            licenseId: licenseIds[0] ?? null,
          },
        );
        createdVersionCount += 1;
      }

      for (const licenseId of licenseIds) {
        await addComponentVersionLicenseInTransaction(
          connection,
          componentVersionId,
          licenseId,
        );
      }
      versionIds.set(pkg.id, componentVersionId);
    }

    const uniqueDependencies = new Map<
      string,
      { sourceId: string; targetId: string; dependencyScope: string | null }
    >();
    for (const dependency of sbom.dependencies) {
      const key = `${dependency.sourceId}\u0000${dependency.targetId}`;
      const existing = uniqueDependencies.get(key);
      if (existing && existing.dependencyScope !== dependency.dependencyScope) {
        throw new SbomValidationError(
          "invalid_document",
          "$.dependencies",
          `Duplicate dependency "${dependency.sourceId}" to "${dependency.targetId}" has conflicting scopes.`,
        );
      }
      uniqueDependencies.set(key, dependency);
    }

    const mappedDependencies = new Map<
      string,
      {
        sourceId: string;
        targetId: string;
        dependencyScope: string | null;
      }
    >();
    for (const dependency of uniqueDependencies.values()) {
      const sourceId = versionIds.get(dependency.sourceId);
      const targetId = versionIds.get(dependency.targetId);
      if (!sourceId || !targetId) {
        throw new SbomValidationError(
          "invalid_dependency_reference",
          "$.dependencies",
          "A dependency could not be mapped to persisted component versions.",
        );
      }
      const key = `${sourceId}\u0000${targetId}`;
      const existing = mappedDependencies.get(key);
      if (existing && existing.dependencyScope !== dependency.dependencyScope) {
        throw new SbomValidationError(
          "invalid_document",
          "$.dependencies",
          `Dependencies mapped to the same component versions have conflicting scopes.`,
        );
      }
      mappedDependencies.set(key, {
        sourceId,
        targetId,
        dependencyScope: dependency.dependencyScope,
      });
    }

    for (const dependency of mappedDependencies.values()) {
      await ensureDependencyInTransaction(connection, {
        componentVersionId: dependency.sourceId,
        dependsOnComponentVersionId: dependency.targetId,
        dependencyScope: dependency.dependencyScope,
      });
    }

    for (const vulnerability of sbom.vulnerabilities) {
      const vulnerabilityId = await ensureVulnerabilityInTransaction(
        connection,
        {
          cveId: vulnerability.id,
          severity: vulnerability.severity,
          publishedDate: vulnerability.publishedDate,
        },
      );
      for (const componentId of vulnerability.affectedComponentIds) {
        const componentVersionId = versionIds.get(componentId);
        if (!componentVersionId) {
          throw new SbomValidationError(
            "invalid_vulnerability_reference",
            "$.vulnerabilities",
            `Vulnerability "${vulnerability.id}" could not be mapped to a persisted component version.`,
          );
        }
        await addVulnerabilityAffectedVersionInTransaction(
          connection,
          componentVersionId,
          vulnerabilityId,
        );
      }
    }

    const generatedAt = sbom.metadata.createdAt
      ? new Date(sbom.metadata.createdAt)
      : undefined;
    if (generatedAt && Number.isNaN(generatedAt.valueOf())) {
      throw new SbomValidationError(
        "invalid_document",
        "$.metadata.createdAt",
        "SBOM creation timestamp is invalid.",
      );
    }
    const sbomInput: CreateSbomInput = {
      applicationId: application.id,
      format: sbom.format,
      componentVersionIds: [...new Set(versionIds.values())],
    };
    const sbomId = await createSbomInTransaction(
      connection,
      sbomInput,
      generatedAt,
    );

    return {
      applicationId: application.id,
      sbomId,
      format: sbom.format,
      packageCount: packages.length,
      componentVersionCount: new Set(versionIds.values()).size,
      dependencyCount: mappedDependencies.size,
      vulnerabilityCount: sbom.vulnerabilities.length,
      createdApplication: application.created,
      createdComponentCount,
      reusedComponentCount,
      createdVersionCount,
      reusedVersionCount,
    };
  });
}

export async function importSbomContent(
  content: string,
  applicationNameOverride?: string,
): Promise<SbomImportResult> {
  const sbom = parseSbomContent(content);
  return persistParsedSbom(sbom, getApplicationInput(sbom, applicationNameOverride));
}
