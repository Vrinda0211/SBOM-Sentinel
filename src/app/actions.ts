"use server";

import { revalidatePath } from "next/cache";
import { requireUuid } from "@/server/database";
import {
  getApplication,
  listApplications,
} from "@/server/applications";
import {
  listComponents,
  listLicensesForComponentVersions,
} from "@/server/components";
import {
  findAffectedApplications,
  findShortestDependencyPaths,
  getDirectDependencies,
  getTransitiveDependencies,
  getTransitiveDependents,
  getApplicationSbomGraph,
} from "@/server/graph";
import {
  importSbomContent,
  SbomImportConflictError,
  type SbomImportResult,
} from "@/server/sboms/import";
import { SbomValidationError } from "@/server/sbom-parser";
import { synchronizeSbomGraph } from "@/server/sboms/graph-sync";
import {
  getSbomGraphData,
  getSbomSyncRecord,
  listSbomsForApplication,
} from "@/server/sboms";
import { listVulnerabilityFindings } from "@/server/vulnerabilities";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getImportErrorMessage(error: unknown): string {
  if (
    error instanceof SbomValidationError ||
    error instanceof SbomImportConflictError ||
    error instanceof TypeError
  ) {
    return error.message;
  }
  return "SBOM import failed. Check the database configuration and retry; no import result was returned.";
}

function serializeDate(value: Date | string | null | undefined): string | null {
  if (value == null) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : value;
}

function serializeImportResult(result: SbomImportResult) {
  return {
    applicationId: result.applicationId,
    sbomId: result.sbomId,
    format: result.format,
    packageCount: result.packageCount,
    componentVersionCount: result.componentVersionCount,
    dependencyCount: result.dependencyCount,
    createdApplication: result.createdApplication,
    createdComponentCount: result.createdComponentCount,
    reusedComponentCount: result.reusedComponentCount,
    createdVersionCount: result.createdVersionCount,
    reusedVersionCount: result.reusedVersionCount,
  };
}

export async function uploadSbomAction(formData: FormData) {
  const fileValue = formData.get("sbomFile");
  if (typeof File === "undefined" || !(fileValue instanceof File)) {
    return { ok: false as const, error: "Choose a JSON SBOM file to upload." };
  }
  if (!fileValue.name.toLowerCase().endsWith(".json")) {
    return {
      ok: false as const,
      error: "Upload a .json CycloneDX or SPDX document.",
    };
  }
  if (
    fileValue.type &&
    fileValue.type !== "application/json" &&
    fileValue.type !== "text/json" &&
    !fileValue.type.endsWith("+json")
  ) {
    return {
      ok: false as const,
      error: "The uploaded file must have a JSON content type.",
    };
  }
  if (fileValue.size === 0 || fileValue.size > MAX_UPLOAD_BYTES) {
    return {
      ok: false as const,
      error: "SBOM files must be between 1 byte and 5 MB.",
    };
  }

  let content: string;
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(
      await fileValue.arrayBuffer(),
    );
  } catch {
    return {
      ok: false as const,
      error: "The uploaded file is not valid UTF-8 text.",
    };
  }

  const nameValue = formData.get("applicationName");
  const applicationName =
    typeof nameValue === "string" && nameValue.trim()
      ? nameValue.trim()
      : undefined;
  let imported: SbomImportResult;
  try {
    imported = await importSbomContent(content, applicationName);
  } catch (error) {
    return { ok: false as const, error: getImportErrorMessage(error) };
  }

  try {
    const graph = await synchronizeSbomGraph(imported.sbomId);
    revalidatePath("/");
    return {
      ok: true as const,
      graphSynced: true as const,
      message: "SBOM imported and synchronized with Neo4j.",
      imported: serializeImportResult(imported),
      graph,
    };
  } catch {
    revalidatePath("/");
    return {
      ok: true as const,
      graphSynced: false as const,
      message:
        "SBOM data was committed to MySQL, but Neo4j synchronization failed. Retry synchronization using this SBOM ID.",
      imported: serializeImportResult(imported),
      graph: null,
    };
  }
}

export async function retrySbomGraphSyncAction(sbomId: string) {
  if (!UUID_PATTERN.test(sbomId)) {
    return { ok: false as const, error: "SBOM ID must be a UUID." };
  }
  try {
    const graph = await synchronizeSbomGraph(sbomId);
    revalidatePath("/");
    return { ok: true as const, graph };
  } catch {
    return {
      ok: false as const,
      error: "Graph synchronization failed. Check Neo4j connectivity and retry.",
    };
  }
}

export async function loadDashboardDataAction() {
  const [applications, components, findings] = await Promise.all([
    listApplications(),
    listComponents(),
    listVulnerabilityFindings(),
  ]);
  return {
    applications: applications.map((application) => ({
      id: application.application_id,
      name: application.application_name,
      description: application.description,
      createdAt: serializeDate(application.created_at),
      sbomCount: Number(application.sbom_count ?? 0),
      vulnerableVersionCount: Number(
        application.vulnerable_version_count ?? 0,
      ),
    })),
    components: components.map((component) => ({
      id: component.component_id,
      name: component.component_name,
      versionCount: Number(component.version_count),
    })),
    findings: findings.map((finding) => ({
      id: finding.vulnerability_id,
      cveId: finding.cve_id,
      severity: finding.severity,
      component: finding.component_name,
      version: finding.version_number,
      remediationStatus: finding.remediation_status,
      application: finding.application_name,
      publishedDate: serializeDate(finding.published_date),
    })),
  };
}

export async function loadApplicationSbomsAction(applicationId: string) {
  requireUuid(applicationId, "Application ID");
  const [application, sboms] = await Promise.all([
    getApplication(applicationId),
    listSbomsForApplication(applicationId),
  ]);
  if (!application) {
    return { application: null, sboms: [] };
  }
  return {
    application: {
      id: application.application_id,
      name: application.application_name,
      description: application.description,
    },
    sboms: sboms.map((sbom) => ({
      id: sbom.sbom_id,
      format: sbom.format,
      generatedAt: serializeDate(sbom.generated_at),
      componentCount: Number(sbom.component_count),
    })),
  };
}

export async function loadSbomDetailsAction(sbomId: string) {
  requireUuid(sbomId, "SBOM ID");
  const [sbom, graphData] = await Promise.all([
    getSbomSyncRecord(sbomId),
    getSbomGraphData(sbomId),
  ]);
  if (!sbom) {
    return { sbom: null, components: [], edges: [], graph: null, graphError: null };
  }
  const componentVersionIds = [
    ...new Set(graphData.nodes.map((node) => node.component_version_id)),
  ];
  const licenses = await listLicensesForComponentVersions(componentVersionIds);
  const licensesByVersion = new Map<string, typeof licenses>();
  for (const license of licenses) {
    const versionLicenses =
      licensesByVersion.get(license.component_version_id) ?? [];
    versionLicenses.push(license);
    licensesByVersion.set(license.component_version_id, versionLicenses);
  }
  const componentsByVersion = new Map<
    string,
    {
      id: string;
      componentId: string;
      name: string;
      version: string;
      licenses: string[];
      vulnerabilities: { cveId: string; severity: string }[];
    }
  >();
  for (const node of graphData.nodes) {
    const component =
      componentsByVersion.get(node.component_version_id) ?? {
        id: node.component_version_id,
        componentId: node.component_id,
        name: node.component_name,
        version: node.version_number,
        licenses: (licensesByVersion.get(node.component_version_id) ?? []).map(
          (license) => license.spdx_identifier,
        ),
        vulnerabilities: [],
      };
    if (
      node.cve_id &&
      !component.vulnerabilities.some(
        (vulnerability) => vulnerability.cveId === node.cve_id,
      )
    ) {
      component.vulnerabilities.push({
        cveId: node.cve_id,
        severity: node.severity ?? "UNKNOWN",
      });
    }
    componentsByVersion.set(node.component_version_id, component);
  }

  let graph: Awaited<ReturnType<typeof getApplicationSbomGraph>> = null;
  let graphError: string | null = null;
  try {
    graph = await getApplicationSbomGraph(sbom.application_id);
  } catch {
    graphError = "Neo4j graph is unavailable; showing MySQL SBOM records.";
  }

  return {
    sbom: {
      id: sbom.sbom_id,
      applicationId: sbom.application_id,
      applicationName: sbom.application_name,
      format: sbom.format,
      generatedAt: serializeDate(sbom.generated_at),
    },
    components: [...componentsByVersion.values()],
    edges: graphData.edges.map((edge) => ({
      sourceId: edge.source_component_version_id,
      sourceName: edge.source_component_name,
      targetId: edge.target_component_version_id,
      targetName: edge.target_component_name,
      scope: edge.dependency_scope,
    })),
    graph,
    graphError,
  };
}

export async function analyzeDependenciesAction(
  componentVersionId: string,
  targetComponentVersionId?: string,
) {
  requireUuid(componentVersionId, "Component version ID");
  if (
    targetComponentVersionId &&
    !UUID_PATTERN.test(targetComponentVersionId)
  ) {
    return { ok: false as const, error: "Target component version ID must be a UUID." };
  }

  const [direct, transitive, dependents, affectedApplications] =
    await Promise.all([
      getDirectDependencies(componentVersionId),
      getTransitiveDependencies(componentVersionId),
      getTransitiveDependents(componentVersionId),
      findAffectedApplications(componentVersionId),
    ]);
  const shortestPaths = targetComponentVersionId
    ? await findShortestDependencyPaths(
        componentVersionId,
        targetComponentVersionId,
      )
    : null;
  return {
    ok: true as const,
    direct,
    transitive,
    dependents,
    affectedApplications,
    shortestPaths,
  };
}
