import "server-only";

import {
  listComponentVersions,
  listComponents,
} from "@/server/components";
import {
  initializeNeo4jGraph,
  linkApplicationToSbom,
  replaceDependenciesForVersion,
  replaceSbomContents,
  upsertApplication,
  upsertComponent,
  upsertComponentVersion,
  upsertSbom,
} from "@/server/graph";
import { getApplication } from "@/server/applications";
import {
  getSbomGraphData,
  getSbomSyncRecord,
} from "@/server/sboms";

export interface SbomGraphSyncResult {
  sbomId: string;
  componentVersionCount: number;
  dependencyCount: number;
  externalTargetCount: number;
}

export async function synchronizeSbomGraph(
  sbomId: string,
): Promise<SbomGraphSyncResult> {
  const sbom = await getSbomSyncRecord(sbomId);
  if (!sbom) {
    throw new Error("SBOM was not found in MySQL.");
  }
  const application = await getApplication(sbom.application_id);
  if (!application) {
    throw new Error("SBOM application was not found in MySQL.");
  }

  const { nodes, edges } = await getSbomGraphData(sbomId);
  const graphNodesByVersionId = new Map(
    nodes.map((node) => [node.component_version_id, node]),
  );
  const componentIds = new Set(nodes.map((node) => node.component_id));
  const componentVersionIds = new Set(
    nodes.map((node) => node.component_version_id),
  );
  for (const edge of edges) {
    componentIds.add(edge.source_component_id);
    componentIds.add(edge.target_component_id);
    componentVersionIds.add(edge.source_component_version_id);
    componentVersionIds.add(edge.target_component_version_id);
  }

  const [components, versionGroups] = await Promise.all([
    listComponents(),
    Promise.all(
      [...componentIds].map((componentId) =>
        listComponentVersions(componentId),
      ),
    ),
  ]);
  const componentsById = new Map(
    components.map((component) => [component.component_id, component]),
  );
  const versionsById = new Map(
    versionGroups
      .flat()
      .map((version) => [version.component_version_id, version]),
  );
  for (const componentVersionId of componentVersionIds) {
    if (!versionsById.has(componentVersionId)) {
      throw new Error(
        `MySQL dependency target ${componentVersionId} has no version details.`,
      );
    }
  }

  await initializeNeo4jGraph();
  await upsertApplication({
    applicationId: application.application_id,
    applicationName: application.application_name,
    description: application.description,
    createdAt: application.created_at,
  });
  await upsertSbom({
    sbomId: sbom.sbom_id,
    format: sbom.format,
    generatedAt: sbom.generated_at,
  });

  for (const componentId of componentIds) {
    const component = componentsById.get(componentId);
    if (!component) {
      throw new Error(`MySQL component ${componentId} was not found.`);
    }
    await upsertComponent({
      componentId,
      componentName: component.component_name,
      componentType:
        "component_type" in component ? component.component_type : null,
    });
  }

  for (const componentVersionId of componentVersionIds) {
    const version = versionsById.get(componentVersionId);
    if (!version) {
      throw new Error(
        `MySQL component version ${componentVersionId} was not found.`,
      );
    }
    await upsertComponentVersion({
      componentVersionId,
      componentId: version.component_id,
      versionNumber: version.version_number,
      releaseDate: version.release_date,
      licenseId: version.license_id,
    });
  }

  await linkApplicationToSbom(sbom.application_id, sbom.sbom_id);

  const sbomVersionIds = [...new Set(
    nodes.map((node) => node.component_version_id),
  )];
  await replaceSbomContents(sbom.sbom_id, sbomVersionIds);

  const dependenciesBySource = new Map<
    string,
    Map<string, string | null>
  >();
  for (const edge of edges) {
    const targets =
      dependenciesBySource.get(edge.source_component_version_id) ??
      new Map<string, string | null>();
    targets.set(edge.target_component_version_id, edge.dependency_scope);
    dependenciesBySource.set(edge.source_component_version_id, targets);
  }
  for (const sourceId of sbomVersionIds) {
    const targets = dependenciesBySource.get(sourceId);
    const dependencies = [...(targets ?? new Map()).entries()].map(
      ([dependsOnComponentVersionId, dependencyScope]) => ({
        dependsOnComponentVersionId,
        dependencyScope,
      }),
    );
    await replaceDependenciesForVersion(sourceId, dependencies);
  }

  return {
    sbomId: sbom.sbom_id,
    componentVersionCount: sbomVersionIds.length,
    dependencyCount: edges.length,
    externalTargetCount: [...componentVersionIds].filter(
      (id) => !graphNodesByVersionId.has(id),
    ).length,
  };
}
