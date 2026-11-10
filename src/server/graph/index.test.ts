import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ManagedTransaction, Session } from "neo4j-driver";
import neo4j from "neo4j-driver";

const {
  executeRead,
  executeWrite,
  sessionRun,
  transactionRun,
  withNeo4jSession,
} = vi.hoisted(() => ({
  executeRead: vi.fn(),
  executeWrite: vi.fn(),
  sessionRun: vi.fn(),
  transactionRun: vi.fn(),
  withNeo4jSession: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/neo4j", () => ({
  withNeo4jSession,
}));

import {
  findAffectedApplications,
  findShortestDependencyPaths,
  getApplicationSbomGraph,
  getDirectDependencies,
  getTransitiveDependencies,
  getTransitiveDependents,
  initializeNeo4jGraph,
  linkApplicationToSbom,
  replaceDependenciesForVersion,
  replaceSbomContents,
  removeDependency,
  upsertSbom,
  upsertApplication,
  upsertComponent,
  upsertComponentVersion,
  upsertDependency,
} from "./index";

const applicationId = "d4a9b522-d33a-4f2c-9b5b-65cfe521d001";
const sbomId = "f1c57f52-3244-4db4-b10c-f1b2b555d002";
const componentId = "d43f502f-2d8e-4c48-bd44-74eebfcdaa03";
const sourceVersionId = "826cae55-05c3-4f23-a9ec-d6a5a1f3a004";
const targetVersionId = "130a507f-ea85-45ce-af5a-fd6a53c84005";
const expectedGraphConstraints = [
  {
    name: "application_id_unique",
    label: "Application",
    property: "application_id",
  },
  { name: "sbom_id_unique", label: "SBOM", property: "sbom_id" },
  { name: "component_id_unique", label: "Component", property: "component_id" },
  {
    name: "component_version_id_unique",
    label: "ComponentVersion",
    property: "component_version_id",
  },
] as const;

function makeRecord(values: Record<string, unknown>) {
  return {
    get: (key: string) => values[key],
  };
}

function makeConstraintRecords(type: string) {
  return expectedGraphConstraints.map(({ name, label, property }) =>
    makeRecord({
      name,
      type,
      entityType: "NODE",
      labelsOrTypes: [label],
      properties: [property],
    }),
  );
}

const transaction = {
  run: transactionRun,
};

const session = {
  run: sessionRun,
  executeRead: (work: (tx: ManagedTransaction) => Promise<unknown>) =>
    executeRead.mockImplementationOnce(() => work(transaction as never))(),
  executeWrite: (work: (tx: ManagedTransaction) => Promise<unknown>) =>
    executeWrite.mockImplementationOnce(() => work(transaction as never))(),
};

describe("Neo4j graph operations", () => {
  beforeEach(() => {
    transactionRun.mockReset().mockResolvedValue({ records: [] });
    sessionRun.mockReset().mockResolvedValue({ records: [] });
    executeRead.mockReset();
    executeWrite.mockReset();
    withNeo4jSession.mockReset().mockImplementation(
      async (operation: (value: Session) => Promise<unknown>) =>
        operation(session as never),
    );
  });

  it("creates and verifies named node property uniqueness constraints", async () => {
    let showConstraintsCall = 0;
    sessionRun.mockImplementation(async (query: string) => {
      if (query.startsWith("SHOW CONSTRAINTS")) {
        showConstraintsCall += 1;
        return {
          records:
            showConstraintsCall === 1
              ? []
              : makeConstraintRecords("NODE_PROPERTY_UNIQUENESS"),
        };
      }
      return { records: [] };
    });

    await expect(initializeNeo4jGraph()).resolves.toEqual(
      expectedGraphConstraints.map(({ name }) => ({ name, status: "created" })),
    );

    expect(sessionRun).toHaveBeenCalledTimes(6);
    expect(sessionRun.mock.calls.map(([query]) => query)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("SHOW CONSTRAINTS"),
        expect.stringContaining("Application"),
        expect.stringContaining("SBOM"),
        expect.stringContaining("Component)"),
        expect.stringContaining("ComponentVersion"),
      ]),
    );
  });

  it("rejects constraints reported with the legacy UNIQUENESS type", async () => {
    let showConstraintsCall = 0;
    sessionRun.mockImplementation(async (query: string) => {
      if (query.startsWith("SHOW CONSTRAINTS")) {
        showConstraintsCall += 1;
        return {
          records:
            showConstraintsCall === 1
              ? []
              : makeConstraintRecords("UNIQUENESS"),
        };
      }
      return { records: [] };
    });

    await expect(initializeNeo4jGraph()).rejects.toThrow(
      "Constraint verification failed: application_id_unique",
    );
  });

  it("upserts an application using the MySQL UUID and bound properties", async () => {
    transactionRun.mockResolvedValueOnce({
      records: [makeRecord({ id: applicationId })],
    });

    await expect(
      upsertApplication({
        applicationId,
        applicationName: " Sentinel ",
        description: null,
      }),
    ).resolves.toBe(applicationId);

    expect(transactionRun).toHaveBeenCalledWith(
      expect.stringContaining("MERGE (node:Application"),
      {
        applicationId,
        properties: {
          application_name: "Sentinel",
          description: null,
        },
      },
    );
  });

  it("upserts an SBOM with only its schema-backed node properties", async () => {
    transactionRun.mockResolvedValueOnce({
      records: [makeRecord({ id: sbomId })],
    });

    await expect(
      upsertSbom({
        sbomId,
        format: "CycloneDX",
        generatedAt: "2025-01-02T03:04:05.000Z",
      }),
    ).resolves.toBe(sbomId);

    expect(transactionRun.mock.calls[0][1]).toEqual({
      sbomId,
      properties: {
        format: "CycloneDX",
        generated_at: "2025-01-02T03:04:05.000Z",
      },
    });
  });

  it("upserts components using the existing component columns", async () => {
    transactionRun.mockResolvedValueOnce({
      records: [makeRecord({ id: componentId })],
    });

    await expect(
      upsertComponent({
        componentId,
        componentName: "library",
        componentType: "npm",
      }),
    ).resolves.toBe(componentId);
    expect(transactionRun.mock.calls[0][1]).toEqual({
      componentId,
      properties: {
        component_name: "library",
        component_type: "npm",
      },
    });
  });

  it("rejects invalid IDs before opening a Neo4j session", async () => {
    await expect(
      upsertApplication({
        applicationId: "not-a-uuid",
        applicationName: "Sentinel",
      }),
    ).rejects.toThrow("Application ID must be a UUID");
    expect(withNeo4jSession).not.toHaveBeenCalled();
  });

  it("fails explicitly when a component version references a missing component", async () => {
    await expect(
      upsertComponentVersion({
        componentVersionId: sourceVersionId,
        componentId,
        versionNumber: "1.0.0",
      }),
    ).rejects.toThrow("Component was not found");
  });

  it("moves a component version's HAS_VERSION link without deleting nodes", async () => {
    transactionRun.mockResolvedValueOnce({
      records: [makeRecord({ id: sourceVersionId })],
    });

    await expect(
      upsertComponentVersion({
        componentVersionId: sourceVersionId,
        componentId,
        versionNumber: "1.0.0",
      }),
    ).resolves.toBe(sourceVersionId);

    expect(transactionRun.mock.calls[0][0]).toContain(
      "OPTIONAL MATCH ()-[existing:HAS_VERSION]->(version)",
    );
    expect(transactionRun.mock.calls[0][0]).toContain(
      "MERGE (component)-[:HAS_VERSION]->(version)",
    );
    expect(transactionRun.mock.calls[0][0]).not.toContain("DELETE node");
  });

  it("merges dependency relationships with a bound scope", async () => {
    transactionRun.mockResolvedValueOnce({
      records: [makeRecord({ id: sourceVersionId })],
    });

    await expect(
      upsertDependency(sourceVersionId, {
        dependsOnComponentVersionId: targetVersionId,
        dependencyScope: " runtime ",
      }),
    ).resolves.toBeUndefined();
    expect(transactionRun.mock.calls[0][0]).toContain(
      "MERGE (source)-[dependency:DEPENDS_ON]->(target)",
    );
    expect(transactionRun.mock.calls[0][1]).toMatchObject({
      componentVersionId: sourceVersionId,
      dependsOnComponentVersionId: targetVersionId,
      dependencyScope: "runtime",
    });
  });

  it("links only existing applications and SBOMs with an idempotent edge", async () => {
    transactionRun.mockResolvedValueOnce({
      records: [makeRecord({ id: applicationId })],
    });

    await expect(linkApplicationToSbom(applicationId, sbomId)).resolves.toBeUndefined();
    expect(transactionRun.mock.calls[0][0]).toContain(
      "MERGE (application)-[:HAS_SBOM]->(sbom)",
    );
    expect(transactionRun.mock.calls[0][0]).toContain(
      "collect(existing) AS existingRelationships",
    );
    expect(transactionRun.mock.calls[0][1]).toEqual({
      applicationId,
      sbomId,
    });
  });

  it("replaces SBOM contents atomically and leaves no node-deletion query", async () => {
    transactionRun
      .mockResolvedValueOnce({
        records: [makeRecord({ id: sbomId })],
      })
      .mockResolvedValueOnce({
        records: [makeRecord({ ids: [targetVersionId] })],
      })
      .mockResolvedValueOnce({ records: [] });

    await replaceSbomContents(sbomId, [targetVersionId]);

    expect(executeWrite).toHaveBeenCalledOnce();
    expect(transactionRun).toHaveBeenCalledTimes(3);
    expect(transactionRun.mock.calls[0][0]).toContain(
      "collect(existing) AS existingRelationships",
    );
    expect(transactionRun.mock.calls[0][0]).toContain("DELETE relationship");
    expect(transactionRun.mock.calls[2][0]).toContain(
      "MERGE (sbom)-[:CONTAINS]->(version)",
    );
    expect(transactionRun.mock.calls[0][0]).not.toContain("DELETE node");
  });

  it("rolls back replacement when a dependency target is absent", async () => {
    transactionRun
      .mockResolvedValueOnce({
        records: [makeRecord({ id: sourceVersionId })],
      })
      .mockResolvedValueOnce({
        records: [makeRecord({ ids: [] })],
      });

    await expect(
      replaceDependenciesForVersion(sourceVersionId, [
        { dependsOnComponentVersionId: targetVersionId },
      ]),
    ).rejects.toThrow("One or more dependency targets were not found");
    expect(transactionRun).toHaveBeenCalledTimes(2);
    expect(executeWrite).toHaveBeenCalledOnce();
  });

  it("removes a dependency relationship without deleting its endpoint nodes", async () => {
    transactionRun.mockResolvedValueOnce({
      records: [makeRecord({ removed: true })],
    });

    await expect(
      removeDependency(sourceVersionId, targetVersionId),
    ).resolves.toBe(true);
    expect(transactionRun.mock.calls[0][0]).toContain("DELETE relationship");
    expect(transactionRun.mock.calls[0][0]).not.toContain("DELETE source");
    expect(transactionRun.mock.calls[0][1]).toEqual({
      componentVersionId: sourceVersionId,
      dependsOnComponentVersionId: targetVersionId,
    });
  });

  it("returns direct dependencies with the scope", async () => {
    const componentVersion = {
      component_version_id: targetVersionId,
      version_number: "2.0.0",
      release_date: null,
      license_id: null,
    };
    transactionRun.mockResolvedValueOnce({
      records: [
        makeRecord({
          componentVersion,
          dependencyScope: "runtime",
        }),
      ],
    });

    await expect(
      getDirectDependencies(sourceVersionId, { limit: 12 }),
    ).resolves.toEqual([
      { componentVersion, dependencyScope: "runtime" },
    ]);
    expect(transactionRun.mock.calls[0][0]).toContain(
      "-[dependency:DEPENDS_ON]->",
    );
    expect(transactionRun.mock.calls[0][1]).toEqual({
      componentVersionId: sourceVersionId,
      limit: neo4j.int(12),
    });
  });

  it("bounds and returns transitive dependency depths", async () => {
    transactionRun.mockResolvedValueOnce({
      records: [
        makeRecord({
          componentVersion: {
            component_version_id: targetVersionId,
            version_number: "2.0.0",
            release_date: null,
            license_id: null,
          },
          depth: { toNumber: () => 2 },
        }),
      ],
    });

    const dependencies = await getTransitiveDependencies(sourceVersionId, {
      maxDepth: 3,
      limit: 10,
    });

    expect(dependencies[0]?.depth).toBe(2);
    expect(transactionRun.mock.calls[0][0]).toContain("*1..3");
    expect(transactionRun.mock.calls[0][1]).toEqual({
      componentVersionId: sourceVersionId,
      limit: neo4j.int(10),
    });
  });

  it("uses reverse edges for transitive dependent traversal", async () => {
    transactionRun.mockResolvedValueOnce({ records: [] });

    await expect(getTransitiveDependents(targetVersionId)).resolves.toEqual([]);
    expect(transactionRun.mock.calls[0][0]).toContain(
      "<-[:DEPENDS_ON*1..5]-",
    );
  });

  it("maps an application's SBOM records into deduplicated graph nodes and edges", async () => {
    const application = {
      application_id: applicationId,
      application_name: "Sentinel",
      description: null,
    };
    const sbom = {
      sbom_id: sbomId,
      format: "CycloneDX",
    };
    const root = {
      component_version_id: sourceVersionId,
      version_number: "1.0.0",
      release_date: null,
      license_id: null,
    };
    const component = {
      component_id: componentId,
      component_name: "library",
      component_type: null,
    };
    transactionRun.mockResolvedValueOnce({
      records: [
        makeRecord({
          application,
          sbom,
          root,
          rootComponent: component,
          reachable: root,
          reachableComponent: component,
          dependencies: [],
        }),
      ],
    });

    const graph = await getApplicationSbomGraph(applicationId);

    expect(graph?.nodes).toHaveLength(4);
    expect(graph?.edges).toEqual(
      expect.arrayContaining([
        { type: "HAS_SBOM", sourceId: applicationId, targetId: sbomId },
        { type: "CONTAINS", sourceId: sbomId, targetId: sourceVersionId },
        {
          type: "HAS_VERSION",
          sourceId: componentId,
          targetId: sourceVersionId,
        },
      ]),
    );
    expect(transactionRun.mock.calls[0][0]).toContain("*0..5");
    expect(transactionRun.mock.calls[0][1]).toEqual({
      applicationId,
      rowLimit: neo4j.int(101),
    });
  });

  it("returns null when the requested application does not exist", async () => {
    transactionRun.mockResolvedValueOnce({ records: [] });

    await expect(getApplicationSbomGraph(applicationId)).resolves.toBeNull();
  });

  it("reports shortest paths and marks bounded results as truncated", async () => {
    transactionRun.mockResolvedValueOnce({
      records: [
        makeRecord({
          componentVersions: [],
          depth: 2,
        }),
        makeRecord({
          componentVersions: [],
          depth: 2,
        }),
      ],
    });

    await expect(
      findShortestDependencyPaths(sourceVersionId, targetVersionId, {
        limit: 1,
        maxDepth: 4,
      }),
    ).resolves.toEqual({
      paths: [{ componentVersions: [], depth: 2 }],
      truncated: true,
    });
    expect(transactionRun.mock.calls[0][0]).toContain("allShortestPaths");
    expect(transactionRun.mock.calls[0][0]).toContain("*1..4");
    expect(transactionRun.mock.calls[0][1]).toMatchObject({
      rowLimit: neo4j.int(2),
    });
  });

  it("finds direct and transitive application impact with bounded depth", async () => {
    const application = {
      application_id: applicationId,
      application_name: "Sentinel",
      description: null,
    };
    transactionRun.mockResolvedValueOnce({
      records: [makeRecord({ application, dependencyDepth: 1 })],
    });

    await expect(
      findAffectedApplications(targetVersionId, { maxDepth: 2, limit: 4 }),
    ).resolves.toEqual({
      applications: [{ application, dependencyDepth: 1 }],
      truncated: false,
    });
    expect(transactionRun.mock.calls[0][0]).toContain("*0..2");
    expect(transactionRun.mock.calls[0][1]).toMatchObject({
      rowLimit: neo4j.int(5),
    });
  });

  it("rejects traversal limits above the configured caps", async () => {
    await expect(
      getTransitiveDependencies(sourceVersionId, { maxDepth: 13 }),
    ).rejects.toThrow("Maximum traversal depth");
    await expect(
      findAffectedApplications(targetVersionId, { limit: 501 }),
    ).rejects.toThrow("Result limit");
    expect(withNeo4jSession).not.toHaveBeenCalled();
  });

  it("preserves nullable MySQL text values such as an empty description", async () => {
    transactionRun.mockResolvedValueOnce({
      records: [makeRecord({ id: applicationId })],
    });

    await upsertApplication({
      applicationId,
      applicationName: "Sentinel",
      description: "",
    });

    expect(transactionRun.mock.calls[0][1]).toMatchObject({
      properties: { description: "" },
    });
  });

  it("propagates Cypher failures to callers", async () => {
    const error = new Error("Cypher failed");
    transactionRun.mockRejectedValueOnce(error);

    await expect(getDirectDependencies(sourceVersionId)).rejects.toBe(error);
  });
});
