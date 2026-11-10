import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getApplication,
  getSbomGraphData,
  getSbomSyncRecord,
  listComponentVersions,
  listComponents,
  initializeNeo4jGraph,
  linkApplicationToSbom,
  replaceDependenciesForVersion,
  replaceSbomContents,
  upsertApplication,
  upsertComponent,
  upsertComponentVersion,
  upsertSbom,
} = vi.hoisted(() => ({
  getApplication: vi.fn(),
  getSbomGraphData: vi.fn(),
  getSbomSyncRecord: vi.fn(),
  listComponentVersions: vi.fn(),
  listComponents: vi.fn(),
  initializeNeo4jGraph: vi.fn(),
  linkApplicationToSbom: vi.fn(),
  replaceDependenciesForVersion: vi.fn(),
  replaceSbomContents: vi.fn(),
  upsertApplication: vi.fn(),
  upsertComponent: vi.fn(),
  upsertComponentVersion: vi.fn(),
  upsertSbom: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/server/applications", () => ({ getApplication }));
vi.mock("@/server/components", () => ({
  listComponentVersions,
  listComponents,
}));
vi.mock("@/server/graph", () => ({
  initializeNeo4jGraph,
  linkApplicationToSbom,
  replaceDependenciesForVersion,
  replaceSbomContents,
  upsertApplication,
  upsertComponent,
  upsertComponentVersion,
  upsertSbom,
}));
vi.mock("@/server/sboms", () => ({
  getSbomGraphData,
  getSbomSyncRecord,
}));

import { synchronizeSbomGraph } from "./graph-sync";

const applicationId = "d4a9b522-d33a-4f2c-9b5b-65cfe521d001";
const sbomId = "f1c57f52-3244-4db4-b10c-f1b2b555d002";
const sourceComponentId = "d43f502f-2d8e-4c48-bd44-74eebfcdaa03";
const targetComponentId = "c50d1054-e53c-4a1f-8a58-ea80444ec004";
const sourceVersionId = "826cae55-05c3-4f23-a9ec-d6a5a1f3a004";
const targetVersionId = "130a507f-ea85-45ce-af5a-fd6a53c84005";

const components = [
  {
    component_id: sourceComponentId,
    component_name: "source-package",
    component_type: "library",
  },
  {
    component_id: targetComponentId,
    component_name: "external-package",
    component_type: "library",
  },
];
const versions = [
  {
    component_version_id: sourceVersionId,
    component_id: sourceComponentId,
    version_number: "1.0",
    release_date: null,
    license_id: null,
  },
  {
    component_version_id: targetVersionId,
    component_id: targetComponentId,
    version_number: "2.0",
    release_date: null,
    license_id: null,
  },
];

describe("Neo4j SBOM synchronization", () => {
  beforeEach(() => {
    getSbomSyncRecord.mockReset().mockResolvedValue({
      sbom_id: sbomId,
      application_id: applicationId,
      application_name: "Sentinel",
      format: "SPDX",
      generated_at: null,
    });
    getApplication.mockReset().mockResolvedValue({
      application_id: applicationId,
      application_name: "Sentinel",
      description: null,
      created_at: new Date("2025-01-01T00:00:00.000Z"),
    });
    getSbomGraphData.mockReset().mockResolvedValue({
      nodes: [
        {
          component_version_id: sourceVersionId,
          component_id: sourceComponentId,
          component_name: "source-package",
          version_number: "1.0",
        },
      ],
      edges: [
        {
          source_component_version_id: sourceVersionId,
          source_component_id: sourceComponentId,
          source_component_name: "source-package",
          target_component_version_id: targetVersionId,
          target_component_id: targetComponentId,
          target_component_name: "external-package",
          dependency_scope: "runtime",
        },
      ],
    });
    listComponents.mockReset().mockResolvedValue(components);
    listComponentVersions.mockReset().mockImplementation(
      async (componentId: string) =>
        versions.filter((version) => version.component_id === componentId),
    );
    for (const operation of [
      initializeNeo4jGraph,
      linkApplicationToSbom,
      replaceDependenciesForVersion,
      replaceSbomContents,
      upsertApplication,
      upsertComponent,
      upsertComponentVersion,
      upsertSbom,
    ]) {
      operation.mockReset().mockResolvedValue(undefined);
    }
  });

  it("upserts all MySQL nodes before relationships and includes external targets", async () => {
    const result = await synchronizeSbomGraph(sbomId);

    expect(result).toEqual({
      sbomId,
      componentVersionCount: 1,
      dependencyCount: 1,
      externalTargetCount: 1,
    });
    expect(upsertComponentVersion).toHaveBeenCalledTimes(2);
    expect(upsertComponentVersion).toHaveBeenCalledWith(
      expect.objectContaining({ componentVersionId: sourceVersionId }),
    );
    expect(upsertComponentVersion).toHaveBeenCalledWith(
      expect.objectContaining({ componentVersionId: targetVersionId }),
    );
    expect(upsertComponent).toHaveBeenCalledWith(
      expect.objectContaining({ componentId: targetComponentId }),
    );
    expect(initializeNeo4jGraph).toHaveBeenCalledOnce();
    expect(
      upsertSbom.mock.invocationCallOrder[0],
    ).toBeLessThan(linkApplicationToSbom.mock.invocationCallOrder[0]);
    expect(
      upsertComponentVersion.mock.invocationCallOrder[1],
    ).toBeLessThan(linkApplicationToSbom.mock.invocationCallOrder[0]);
    expect(replaceSbomContents).toHaveBeenCalledWith(sbomId, [
      sourceVersionId,
    ]);
    expect(replaceDependenciesForVersion).toHaveBeenCalledWith(
      sourceVersionId,
      [
        {
          dependsOnComponentVersionId: targetVersionId,
          dependencyScope: "runtime",
        },
      ],
    );
    expect(replaceDependenciesForVersion).toHaveBeenCalledTimes(1);
  });

  it("can safely synchronize the same persisted SBOM again", async () => {
    const first = await synchronizeSbomGraph(sbomId);
    const second = await synchronizeSbomGraph(sbomId);

    expect(second).toEqual(first);
    expect(upsertApplication).toHaveBeenCalledTimes(2);
    expect(upsertSbom).toHaveBeenCalledTimes(2);
    expect(upsertComponent).toHaveBeenCalledTimes(4);
    expect(upsertComponentVersion).toHaveBeenCalledTimes(4);
    expect(linkApplicationToSbom).toHaveBeenCalledTimes(2);
    expect(replaceSbomContents).toHaveBeenCalledTimes(2);
    expect(replaceDependenciesForVersion).toHaveBeenCalledTimes(2);
  });

  it("does not start a graph write when a persisted dependency target is missing from MySQL", async () => {
    listComponentVersions.mockResolvedValue([versions[0]]);

    await expect(synchronizeSbomGraph(sbomId)).rejects.toThrow(
      `MySQL dependency target ${targetVersionId} has no version details.`,
    );
    expect(initializeNeo4jGraph).not.toHaveBeenCalled();
  });
});
