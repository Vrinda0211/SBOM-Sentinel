import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class SbomImportConflictError extends Error {}

  return {
    SbomImportConflictError,
    analyze: vi.fn(),
    getApplication: vi.fn(),
    getDirectDependencies: vi.fn(),
    getSbomGraphData: vi.fn(),
    getSbomSyncRecord: vi.fn(),
    getTransitiveDependencies: vi.fn(),
    getTransitiveDependents: vi.fn(),
    getApplicationSbomGraph: vi.fn(),
    importSbomContent: vi.fn(),
    listApplications: vi.fn(),
    listComponents: vi.fn(),
    listComponentVersions: vi.fn(),
    listLicensesForComponentVersions: vi.fn(),
    listSbomsForApplication: vi.fn(),
    listVulnerabilityFindings: vi.fn(),
    revalidatePath: vi.fn(),
    requireUuid: vi.fn((value: string) => value),
    synchronizeSbomGraph: vi.fn(),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/server/database", () => ({ requireUuid: mocks.requireUuid }));
vi.mock("@/server/applications", () => ({
  getApplication: mocks.getApplication,
  listApplications: mocks.listApplications,
}));
vi.mock("@/server/components", () => ({
  listComponents: mocks.listComponents,
  listComponentVersions: mocks.listComponentVersions,
  listLicensesForComponentVersions: mocks.listLicensesForComponentVersions,
}));
vi.mock("@/server/graph", () => ({
  findAffectedApplications: mocks.analyze,
  findShortestDependencyPaths: mocks.analyze,
  getDirectDependencies: mocks.getDirectDependencies,
  getTransitiveDependencies: mocks.getTransitiveDependencies,
  getTransitiveDependents: mocks.getTransitiveDependents,
  getApplicationSbomGraph: mocks.getApplicationSbomGraph,
}));
vi.mock("@/server/sboms/import", () => ({
  importSbomContent: mocks.importSbomContent,
  SbomImportConflictError: mocks.SbomImportConflictError,
}));
vi.mock("@/server/sboms/graph-sync", () => ({
  synchronizeSbomGraph: mocks.synchronizeSbomGraph,
}));
vi.mock("@/server/sboms", () => ({
  getSbomGraphData: mocks.getSbomGraphData,
  getSbomSyncRecord: mocks.getSbomSyncRecord,
  listSbomsForApplication: mocks.listSbomsForApplication,
}));
vi.mock("@/server/vulnerabilities", () => ({
  VulnerabilityImportConflictError: class VulnerabilityImportConflictError extends Error {},
  listVulnerabilityFindings: mocks.listVulnerabilityFindings,
}));

import {
  retrySbomGraphSyncAction,
  uploadSbomAction,
} from "./actions";
import { SbomValidationError } from "@/server/sbom-parser";

const sbomId = "f1c57f52-3244-4db4-b10c-f1b2b555d002";
const applicationId = "d4a9b522-d33a-4f2c-9b5b-65cfe521d001";

function uploadForm(name = "inventory.json"): FormData {
  const formData = new FormData();
  formData.set(
    "sbomFile",
    new File(['{"bomFormat":"CycloneDX"}'], name, {
      type: "application/json",
    }),
  );
  return formData;
}

describe("SBOM upload and synchronization actions", () => {
  beforeEach(() => {
    for (const mock of [
      mocks.analyze,
      mocks.getApplication,
      mocks.getDirectDependencies,
      mocks.getSbomGraphData,
      mocks.getSbomSyncRecord,
      mocks.getTransitiveDependencies,
      mocks.getTransitiveDependents,
      mocks.getApplicationSbomGraph,
      mocks.importSbomContent,
      mocks.listApplications,
      mocks.listComponents,
      mocks.listComponentVersions,
      mocks.listLicensesForComponentVersions,
      mocks.listSbomsForApplication,
      mocks.listVulnerabilityFindings,
      mocks.revalidatePath,
      mocks.requireUuid,
      mocks.synchronizeSbomGraph,
    ]) {
      mock.mockReset();
    }
    mocks.requireUuid.mockImplementation((value: string) => value);
    mocks.importSbomContent.mockResolvedValue({
      applicationId,
      sbomId,
      format: "CycloneDX",
      packageCount: 1,
      componentVersionCount: 1,
      dependencyCount: 0,
      vulnerabilityCount: 0,
      createdApplication: true,
      createdComponentCount: 1,
      reusedComponentCount: 0,
      createdVersionCount: 1,
      reusedVersionCount: 0,
    });
    mocks.synchronizeSbomGraph.mockResolvedValue({
      sbomId,
      componentVersionCount: 1,
      dependencyCount: 0,
      externalTargetCount: 0,
    });
  });

  it("rejects non-JSON filenames before parsing or persistence", async () => {
    const result = await uploadSbomAction(uploadForm("inventory.txt"));

    expect(result).toMatchObject({
      ok: false,
      error: "Upload a .json CycloneDX or SPDX document.",
    });
    expect(mocks.importSbomContent).not.toHaveBeenCalled();
  });

  it("returns parser validation errors without exposing database internals", async () => {
    mocks.importSbomContent.mockRejectedValue(
      new SbomValidationError(
        "invalid_document",
        "$.components",
        "A component identifier is required.",
      ),
    );

    const result = await uploadSbomAction(uploadForm());

    expect(result).toMatchObject({
      ok: false,
      error: "A component identifier is required. ($.components)",
    });
    expect(mocks.synchronizeSbomGraph).not.toHaveBeenCalled();
  });

  it("reports a committed MySQL import when Neo4j synchronization fails", async () => {
    mocks.synchronizeSbomGraph.mockRejectedValue(
      new Error("bolt://database.internal:7687"),
    );

    const result = await uploadSbomAction(uploadForm());

    expect(result).toMatchObject({
      ok: true,
      graphSynced: false,
      imported: { applicationId, sbomId, format: "CycloneDX" },
    });
    expect(result.ok && result.message).toContain("Retry synchronization");
    expect(JSON.stringify(result)).not.toContain("database.internal");
  });

  it("returns a safe retry error when Neo4j is unavailable", async () => {
    mocks.synchronizeSbomGraph.mockRejectedValue(
      new Error("bolt://database.internal:7687"),
    );

    const result = await retrySbomGraphSyncAction(sbomId);

    expect(result).toEqual({
      ok: false,
      error: "Graph synchronization failed. Check Neo4j connectivity and retry.",
    });
    expect(JSON.stringify(result)).not.toContain("database.internal");
  });
});
