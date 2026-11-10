import "dotenv/config";

import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getMySqlPool } from "@/lib/mysql";
import {
  createComponent,
  addComponentVersion,
  createLicense,
  addComponentVersionLicenseInTransaction,
  listLicensesForComponentVersion,
} from "@/server/components";
import {
  registerApplication,
  getApplicationRiskSummary,
} from "@/server/applications";
import { addDependency } from "@/server/dependencies";
import { inTransaction } from "@/server/database";
import { addSbomComponent, createSbom, getSbomGraphData } from "@/server/sboms";
import { createVulnerability } from "@/server/vulnerabilities";

const requiredEnvironment = [
  "MYSQL_HOST",
  "MYSQL_USER",
  "MYSQL_PASSWORD",
  "MYSQL_DATABASE",
];
const mysqlConfigured = requiredEnvironment.every(
  (name) => process.env[name] !== undefined,
);
const pool = getMySqlPool;

const applicationIds = new Set<string>();
const componentIds = new Set<string>();
const vulnerabilityIds = new Set<string>();
const licenseIds = new Set<string>();

interface MySqlHealthRow extends RowDataPacket {
  database_name: string;
  server_version: string;
}

interface ApplicationIdRow extends RowDataPacket {
  application_id: string;
}

interface SbomIdRow extends RowDataPacket {
  sbom_id: string;
}

describe.skipIf(!mysqlConfigured)("live MySQL backend integration", () => {
  afterEach(async () => {
    const connectionPool = pool();
    for (const vulnerabilityId of vulnerabilityIds) {
      await connectionPool.execute(
        "DELETE FROM VULNERABILITY WHERE vulnerability_id = ?",
        [vulnerabilityId],
      );
    }
    for (const applicationId of applicationIds) {
      await connectionPool.execute(
        "DELETE FROM APPLICATION WHERE application_id = ?",
        [applicationId],
      );
    }
    for (const componentId of componentIds) {
      await connectionPool.execute(
        "DELETE FROM COMPONENT WHERE component_id = ?",
        [componentId],
      );
    }
    for (const licenseId of licenseIds) {
      await connectionPool.execute(
        "DELETE FROM LICENSE WHERE license_id = ?",
        [licenseId],
      );
    }
    applicationIds.clear();
    componentIds.clear();
    vulnerabilityIds.clear();
    licenseIds.clear();
  });

  afterAll(async () => {
    await pool().end();
  });

  it("verifies CRUD helpers, constraints, transactions, licenses, findings, and graph output", async () => {
    const connectionPool = pool();
    const [health] = await connectionPool.query<MySqlHealthRow[]>(
      "SELECT DATABASE() AS database_name, VERSION() AS server_version",
    );
    expect(health[0]?.database_name).toBeTruthy();

    const applicationId = await registerApplication({
      applicationName: `Live MySQL integration ${randomUUID()}`,
      description: "Automatically cleaned up by the live integration suite.",
    });
    applicationIds.add(applicationId);

    const componentId = await createComponent({
      componentName: `live-test-component-${randomUUID()}`,
      componentType: "test",
    });
    componentIds.add(componentId);
    const targetComponentId = await createComponent({
      componentName: `live-test-target-${randomUUID()}`,
      componentType: "test",
    });
    componentIds.add(targetComponentId);

    const legacyLicenseId = await createLicense({
      licenseName: "Live integration legacy license",
      spdxIdentifier: `LIVE-${randomUUID()}`,
    });
    licenseIds.add(legacyLicenseId);
    const additionalLicenseId = await createLicense({
      licenseName: "Live integration additional license",
      spdxIdentifier: `LIVE-${randomUUID()}`,
    });
    licenseIds.add(additionalLicenseId);

    const versionId = await addComponentVersion(componentId, {
      versionNumber: "1.0.0",
      licenseId: legacyLicenseId,
    });
    const targetVersionId = await addComponentVersion(targetComponentId, {
      versionNumber: "2.0.0",
    });

    await expect(
      addComponentVersion(componentId, { versionNumber: "1.0.0" }),
    ).rejects.toThrow("already exists");

    await inTransaction((connection) =>
      addComponentVersionLicenseInTransaction(
        connection,
        versionId,
        additionalLicenseId,
      ),
    );
    const licenses = await listLicensesForComponentVersion(versionId);
    expect(licenses.map(({ license_id }) => license_id).sort()).toEqual(
      [legacyLicenseId, additionalLicenseId].sort(),
    );

    const sbomId = await createSbom({
      applicationId,
      format: "CycloneDX",
      componentVersionIds: [versionId],
    });
    await addSbomComponent(sbomId, targetVersionId);
    await expect(addSbomComponent(sbomId, targetVersionId)).rejects.toThrow(
      "already contains",
    );
    await expect(
      createSbom({
        applicationId,
        format: "CycloneDX",
        componentVersionIds: [versionId, versionId.toUpperCase()],
      }),
    ).rejects.toThrow("must not contain duplicates");
    await expect(getSbomGraphData("not-a-uuid")).rejects.toThrow(
      "SBOM ID must be a UUID",
    );

    await addDependency({
      componentVersionId: versionId,
      dependsOnComponentVersionId: targetVersionId,
      dependencyScope: "runtime",
    });
    await expect(
      addDependency({
        componentVersionId: versionId,
        dependsOnComponentVersionId: targetVersionId,
      }),
    ).rejects.toThrow("already exists");
    await expect(
      addDependency({
        componentVersionId: versionId,
        dependsOnComponentVersionId: versionId,
      }),
    ).rejects.toThrow("cannot depend on itself");

    const vulnerabilityId = await createVulnerability({
      cveId: `CVE-2099-${randomUUID().slice(0, 8)}`,
      severity: "CRITICAL",
      affectedComponentVersionIds: [versionId],
    });
    vulnerabilityIds.add(vulnerabilityId);

    const graphData = await getSbomGraphData(sbomId);
    expect(graphData.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          component_version_id: versionId,
          vulnerability_id: vulnerabilityId,
          severity: "CRITICAL",
        }),
        expect.objectContaining({
          component_version_id: targetVersionId,
          vulnerability_id: null,
        }),
      ]),
    );
    expect(graphData.edges).toEqual([
      expect.objectContaining({
        source_component_version_id: versionId,
        target_component_version_id: targetVersionId,
        dependency_scope: "runtime",
      }),
    ]);

    const summary = await getApplicationRiskSummary(applicationId);
    expect(summary).toMatchObject({
      application_id: applicationId,
      sbom_count: 1,
      component_version_count: 2,
      open_finding_count: 1,
      critical_finding_count: 1,
      total_severity_score: 4,
    });

    const caseVariantId = randomUUID().replace(
      /-[0-9a-f]{12}$/i,
      "-abcdef123456",
    );
    const upperCaseVariantId = caseVariantId.toUpperCase();
    await connectionPool.execute(
      `INSERT INTO COMPONENT (component_id, component_name, component_type)
       VALUES (?, ?, ?)`,
      [caseVariantId, `uuid-case-test-${randomUUID()}`, "test"],
    );
    componentIds.add(caseVariantId);
    let duplicateUuidError: unknown;
    try {
      await connectionPool.execute(
        `INSERT INTO COMPONENT (component_id, component_name, component_type)
         VALUES (?, ?, ?)`,
        [upperCaseVariantId, "duplicate UUID case variant", "test"],
      );
    } catch (error) {
      duplicateUuidError = error;
    }
    if (duplicateUuidError === undefined) {
      componentIds.add(upperCaseVariantId);
    }
    expect(duplicateUuidError).toMatchObject({ code: "ER_DUP_ENTRY" });

    const missingApplicationId = randomUUID();
    await expect(
      createSbom({
        applicationId: missingApplicationId,
        format: "CycloneDX",
        componentVersionIds: [],
      }),
    ).rejects.toMatchObject({ code: "ER_NO_REFERENCED_ROW_2" });
    const failedSbomFormat = `rollback-${randomUUID()}`;
    await expect(
      createSbom({
        applicationId,
        format: failedSbomFormat,
        componentVersionIds: [randomUUID()],
      }),
    ).rejects.toMatchObject({ code: "ER_NO_REFERENCED_ROW_2" });
    const [failedSbomRows] = await connectionPool.execute<SbomIdRow[]>(
      `SELECT sbom_id
       FROM SBOM
       WHERE application_id = ? AND format = ?`,
      [applicationId, failedSbomFormat],
    );
    expect(failedSbomRows).toHaveLength(0);
    await expect(
      addComponentVersion(randomUUID(), { versionNumber: "1.0.0" }),
    ).rejects.toMatchObject({ code: "ER_NO_REFERENCED_ROW_2" });
    await expect(
      addDependency({
        componentVersionId: versionId,
        dependsOnComponentVersionId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "ER_NO_REFERENCED_ROW_2" });

    const rollbackApplicationId = randomUUID();
    await expect(
      inTransaction(async (connection) => {
        await connection.execute(
          `INSERT INTO APPLICATION (application_id, application_name)
           VALUES (?, ?)`,
          [rollbackApplicationId, "transaction rollback verification"],
        );
        throw new Error("intentional integration-test rollback");
      }),
    ).rejects.toThrow("intentional integration-test rollback");
    const [rollbackRows] = await connectionPool.execute<ApplicationIdRow[]>(
      "SELECT application_id FROM APPLICATION WHERE application_id = ?",
      [rollbackApplicationId],
    );
    expect(rollbackRows).toHaveLength(0);
  });
});
