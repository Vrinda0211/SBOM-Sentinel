import "dotenv/config";

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  getNeo4jDatabase,
  getNeo4jDriver,
} from "@/lib/neo4j";
import {
  getApplicationSbomGraph,
  linkApplicationToSbom,
  replaceDependenciesForVersion,
  replaceSbomContents,
  upsertApplication,
  upsertComponent,
  upsertComponentVersion,
  upsertSbom,
} from "@/server/graph";

const configured = [
  "NEO4J_URI",
  "NEO4J_USERNAME",
  "NEO4J_PASSWORD",
].every((name) => Boolean(process.env[name]?.trim()));

const createdNodes: { label: string; property: string; id: string }[] = [];

describe.skipIf(!configured)("live Neo4j graph retrieval", () => {
  afterEach(async () => {
    const session = getNeo4jDriver().session({
      database: getNeo4jDatabase(),
    });
    try {
      for (const { label, property, id } of createdNodes) {
        await session.run(
          `MATCH (node:${label} {${property}: $id})
           DETACH DELETE node`,
          { id },
        );
      }
    } finally {
      createdNodes.length = 0;
      await session.close();
    }
  });

  afterAll(async () => {
    await getNeo4jDriver().close();
  });

  it("retrieves a synchronized application SBOM and its dependency edge", async () => {
    const applicationId = randomUUID();
    const sbomId = randomUUID();
    const componentId = randomUUID();
    const targetComponentId = randomUUID();
    const componentVersionId = randomUUID();
    const targetVersionId = randomUUID();

    await upsertApplication({
      applicationId,
      applicationName: `Live graph test ${applicationId}`,
    });
    createdNodes.push({
      label: "Application",
      property: "application_id",
      id: applicationId,
    });
    await upsertSbom({ sbomId, format: "CycloneDX" });
    createdNodes.push({ label: "SBOM", property: "sbom_id", id: sbomId });
    await upsertComponent({ componentId, componentName: "live-source" });
    createdNodes.push({
      label: "Component",
      property: "component_id",
      id: componentId,
    });
    await upsertComponent({
      componentId: targetComponentId,
      componentName: "live-target",
    });
    createdNodes.push({
      label: "Component",
      property: "component_id",
      id: targetComponentId,
    });
    await upsertComponentVersion({
      componentVersionId,
      componentId,
      versionNumber: "1.0.0",
    });
    createdNodes.push({
      label: "ComponentVersion",
      property: "component_version_id",
      id: componentVersionId,
    });
    await upsertComponentVersion({
      componentVersionId: targetVersionId,
      componentId: targetComponentId,
      versionNumber: "2.0.0",
    });
    createdNodes.push({
      label: "ComponentVersion",
      property: "component_version_id",
      id: targetVersionId,
    });
    await linkApplicationToSbom(applicationId, sbomId);
    await replaceSbomContents(sbomId, [componentVersionId]);
    await replaceDependenciesForVersion(componentVersionId, [
      { dependsOnComponentVersionId: targetVersionId, dependencyScope: "runtime" },
    ]);

    await expect(getApplicationSbomGraph(applicationId)).resolves.toMatchObject({
      application: {
        application_id: applicationId,
        application_name: `Live graph test ${applicationId}`,
      },
      edges: expect.arrayContaining([
        {
          type: "DEPENDS_ON",
          sourceId: componentVersionId,
          targetId: targetVersionId,
          dependencyScope: "runtime",
        },
      ]),
      truncated: false,
    });
  });
});
