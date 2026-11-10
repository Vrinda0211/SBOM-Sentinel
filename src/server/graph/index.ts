import "server-only";

import neo4j from "neo4j-driver";
import type { ManagedTransaction, Record as Neo4jRecord } from "neo4j-driver";
import { withNeo4jSession } from "@/lib/neo4j";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_RESULT_LIMIT = 100;
const MAX_RESULT_LIMIT = 500;
const DEFAULT_MAX_DEPTH = 5;
const MAX_DEPTH = 12;

export interface ApplicationGraphInput {
  applicationId: string;
  applicationName: string;
  description?: string | null;
  createdAt?: string | Date;
}

export interface SbomGraphInput {
  sbomId: string;
  format: string;
  generatedAt?: string | Date;
}

export interface ComponentGraphInput {
  componentId: string;
  componentName: string;
  componentType?: string | null;
}

export interface ComponentVersionGraphInput {
  componentVersionId: string;
  componentId: string;
  versionNumber: string;
  releaseDate?: string | null;
  licenseId?: string | null;
}

export interface DependencyGraphInput {
  dependsOnComponentVersionId: string;
  dependencyScope?: string | null;
}

export interface GraphQueryOptions {
  limit?: number;
  maxDepth?: number;
}

export interface ApplicationGraphNode {
  application_id: string;
  application_name: string;
  description: string | null;
  created_at?: string;
}

export interface SbomGraphNode {
  sbom_id: string;
  format: string;
  generated_at?: string;
}

export interface ComponentGraphNode {
  component_id: string;
  component_name: string;
  component_type: string | null;
}

export interface ComponentVersionGraphNode {
  component_version_id: string;
  version_number: string;
  release_date: string | null;
  license_id: string | null;
}

export type GraphNode =
  | { kind: "Application"; data: ApplicationGraphNode }
  | { kind: "SBOM"; data: SbomGraphNode }
  | { kind: "Component"; data: ComponentGraphNode }
  | { kind: "ComponentVersion"; data: ComponentVersionGraphNode };

export interface GraphEdge {
  type: "HAS_SBOM" | "CONTAINS" | "HAS_VERSION" | "DEPENDS_ON";
  sourceId: string;
  targetId: string;
  dependencyScope?: string | null;
}

export interface ApplicationSbomGraph {
  application: ApplicationGraphNode;
  nodes: GraphNode[];
  edges: GraphEdge[];
  truncated: boolean;
}

export interface DirectDependency {
  componentVersion: ComponentVersionGraphNode;
  dependencyScope: string | null;
}

export interface DependencyAtDepth {
  componentVersion: ComponentVersionGraphNode;
  depth: number;
}

export interface DependencyPath {
  componentVersions: ComponentVersionGraphNode[];
  depth: number;
}

export interface DependencyPathsResult {
  paths: DependencyPath[];
  truncated: boolean;
}

export interface AffectedApplication {
  application: ApplicationGraphNode;
  dependencyDepth: number;
}

export interface AffectedApplicationsResult {
  applications: AffectedApplication[];
  truncated: boolean;
}

interface Limits {
  limit: number;
  maxDepth: number;
}

interface DependencyInput {
  component_version_id: string;
  dependency_scope: string | null;
}

interface Neo4jConstraint {
  name: unknown;
  type: unknown;
  entityType: unknown;
  labelsOrTypes: unknown;
  properties: unknown;
}

const expectedConstraints = [
  { name: "application_id_unique", label: "Application", property: "application_id" },
  { name: "sbom_id_unique", label: "SBOM", property: "sbom_id" },
  { name: "component_id_unique", label: "Component", property: "component_id" },
  {
    name: "component_version_id_unique",
    label: "ComponentVersion",
    property: "component_version_id",
  },
] as const;

function requireUuid(value: string, label: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a UUID.`);
  }
  return value.toLowerCase();
}

function requireText(
  value: string,
  label: string,
  maxLength: number,
): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > maxLength
  ) {
    throw new TypeError(`${label} must contain 1 to ${maxLength} characters.`);
  }
  return value.trim();
}

function optionalText(
  value: string | null | undefined,
  label: string,
  maxLength: number,
): string | null {
  if (value == null) {
    return null;
  }
  if (typeof value !== "string" || value.length > maxLength) {
    throw new TypeError(`${label} must be a string of at most ${maxLength} characters.`);
  }
  return value;
}

function optionalDependencyScope(value: string | null | undefined): string | null {
  return value == null ? null : requireText(value, "Dependency scope", 50);
}

function optionalIsoDate(value: string | null | undefined): string | null {
  const date = optionalText(value, "Release date", 10);
  if (date == null) {
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new TypeError("Release date must be a date in YYYY-MM-DD format.");
  }
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.valueOf()) ||
    parsed.toISOString().slice(0, 10) !== date
  ) {
    throw new TypeError("Release date must be a valid calendar date.");
  }
  return date;
}

function toStoredDate(value: string | Date, label: string): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.valueOf())) {
      throw new TypeError(`${label} must be a valid date.`);
    }
    return value.toISOString();
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty date string.`);
  }
  return value.trim();
}

function getLimits(options: GraphQueryOptions = {}): Limits {
  const limit = options.limit ?? DEFAULT_RESULT_LIMIT;
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RESULT_LIMIT) {
    throw new TypeError(
      `Result limit must be an integer between 1 and ${MAX_RESULT_LIMIT}.`,
    );
  }
  if (!Number.isInteger(maxDepth) || maxDepth < 1 || maxDepth > MAX_DEPTH) {
    throw new TypeError(
      `Maximum traversal depth must be an integer between 1 and ${MAX_DEPTH}.`,
    );
  }
  return { limit, maxDepth };
}

function getValue<T>(record: Neo4jRecord, key: string): T {
  return record.get(key) as T;
}

function getIntegerValue(record: Neo4jRecord, key: string): number {
  const value: unknown = record.get(key);
  if (typeof value === "number") {
    return value;
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "toNumber" in value &&
    typeof value.toNumber === "function"
  ) {
    const number = value.toNumber();
    if (typeof number === "number") {
      return number;
    }
  }
  throw new TypeError(`Neo4j returned an invalid integer for "${key}".`);
}

function requireRecord(records: Neo4jRecord[], context: string): Neo4jRecord {
  const record = records[0];
  if (!record) {
    throw new Error(`${context} was not found in the Neo4j graph.`);
  }
  return record;
}

async function writeAndReturnId(
  query: string,
  parameters: Record<string, unknown>,
  context: string,
): Promise<string> {
  return withNeo4jSession((session) =>
    session.executeWrite(async (transaction) => {
      const result = await transaction.run(query, parameters);
      return getValue<string>(requireRecord(result.records, context), "id");
    }),
  );
}

async function runRead<T>(
  operation: (transaction: ManagedTransaction) => Promise<T>,
): Promise<T> {
  return withNeo4jSession((session) => session.executeRead(operation));
}

async function listConstraints(): Promise<Neo4jConstraint[]> {
  return withNeo4jSession(async (session) => {
    const result = await session.run(
      `SHOW CONSTRAINTS
       YIELD name, type, entityType, labelsOrTypes, properties
       RETURN name, type, entityType, labelsOrTypes, properties`,
    );
    return result.records.map((record) => ({
      name: record.get("name"),
      type: record.get("type"),
      entityType: record.get("entityType"),
      labelsOrTypes: record.get("labelsOrTypes"),
      properties: record.get("properties"),
    }));
  });
}

function isExpectedConstraint(
  actual: Neo4jConstraint | undefined,
  expected: (typeof expectedConstraints)[number],
): boolean {
  return (
    actual !== undefined &&
    actual.name === expected.name &&
    actual.type === "NODE_PROPERTY_UNIQUENESS" &&
    actual.entityType === "NODE" &&
    Array.isArray(actual.labelsOrTypes) &&
    actual.labelsOrTypes.includes(expected.label) &&
    Array.isArray(actual.properties) &&
    actual.properties.includes(expected.property)
  );
}

export async function initializeNeo4jGraph(): Promise<
  { name: string; status: "already_existed" | "created" }[]
> {
  const before = await listConstraints();
  const constraints = [
    `CREATE CONSTRAINT application_id_unique IF NOT EXISTS
     FOR (node:Application) REQUIRE node.application_id IS UNIQUE`,
    `CREATE CONSTRAINT sbom_id_unique IF NOT EXISTS
     FOR (node:SBOM) REQUIRE node.sbom_id IS UNIQUE`,
    `CREATE CONSTRAINT component_id_unique IF NOT EXISTS
     FOR (node:Component) REQUIRE node.component_id IS UNIQUE`,
    `CREATE CONSTRAINT component_version_id_unique IF NOT EXISTS
     FOR (node:ComponentVersion) REQUIRE node.component_version_id IS UNIQUE`,
  ];

  await withNeo4jSession(async (session) => {
    for (const query of constraints) {
      await session.run(query);
    }
  });

  const after = await listConstraints();
  return expectedConstraints.map((expected) => {
    const actual = after.find((constraint) => constraint.name === expected.name);
    if (!isExpectedConstraint(actual, expected)) {
      throw new Error(`Constraint verification failed: ${expected.name}`);
    }

    const existed = before.some((constraint) =>
      isExpectedConstraint(constraint, expected),
    );
    return {
      name: expected.name,
      status: existed ? "already_existed" : "created",
    };
  });
}

export async function upsertApplication(
  input: ApplicationGraphInput,
): Promise<string> {
  const applicationId = requireUuid(input.applicationId, "Application ID");
  const properties: Record<string, unknown> = {
    application_name: requireText(input.applicationName, "Application name", 255),
    description: optionalText(input.description, "Application description", 65535),
  };
  if (input.createdAt !== undefined) {
    properties.created_at = toStoredDate(input.createdAt, "Application created_at");
  }

  return writeAndReturnId(
    `MERGE (node:Application {application_id: $applicationId})
     SET node += $properties
     RETURN node.application_id AS id`,
    { applicationId, properties },
    "Application",
  );
}

export async function upsertSbom(input: SbomGraphInput): Promise<string> {
  const sbomId = requireUuid(input.sbomId, "SBOM ID");
  const properties: Record<string, unknown> = {
    format: requireText(input.format, "SBOM format", 50),
  };
  if (input.generatedAt !== undefined) {
    properties.generated_at = toStoredDate(input.generatedAt, "SBOM generated_at");
  }

  return writeAndReturnId(
    `MERGE (node:SBOM {sbom_id: $sbomId})
     SET node += $properties
     RETURN node.sbom_id AS id`,
    { sbomId, properties },
    "SBOM",
  );
}

export async function upsertComponent(
  input: ComponentGraphInput,
): Promise<string> {
  const componentId = requireUuid(input.componentId, "Component ID");
  const properties = {
    component_name: requireText(input.componentName, "Component name", 255),
    component_type: optionalText(input.componentType, "Component type", 100),
  };

  return writeAndReturnId(
    `MERGE (node:Component {component_id: $componentId})
     SET node += $properties
     RETURN node.component_id AS id`,
    { componentId, properties },
    "Component",
  );
}

export async function upsertComponentVersion(
  input: ComponentVersionGraphInput,
): Promise<string> {
  const componentVersionId = requireUuid(
    input.componentVersionId,
    "Component version ID",
  );
  const componentId = requireUuid(input.componentId, "Component ID");
  const licenseId =
    input.licenseId == null
      ? null
      : requireUuid(input.licenseId, "License ID");
  const properties: Record<string, unknown> = {
    version_number: requireText(input.versionNumber, "Version number", 100),
    license_id: licenseId,
    release_date: optionalIsoDate(input.releaseDate),
  };

  return withNeo4jSession((session) =>
    session.executeWrite(async (transaction) => {
      const result = await transaction.run(
        `MATCH (component:Component {component_id: $componentId})
         MERGE (version:ComponentVersion {
           component_version_id: $componentVersionId
         })
         SET version += $properties
         WITH component, version
         OPTIONAL MATCH ()-[existing:HAS_VERSION]->(version)
         WITH component, version, collect(existing) AS existingRelationships
         FOREACH (
           relationship IN existingRelationships |
           DELETE relationship
         )
         MERGE (component)-[:HAS_VERSION]->(version)
         RETURN version.component_version_id AS id`,
        { componentId, componentVersionId, properties },
      );
      return getValue<string>(
        requireRecord(result.records, "Component"),
        "id",
      );
    }),
  );
}

async function mergeRelationship(
  query: string,
  parameters: Record<string, unknown>,
  context: string,
): Promise<void> {
  await writeAndReturnId(query, parameters, context);
}

export async function linkApplicationToSbom(
  applicationId: string,
  sbomId: string,
): Promise<void> {
  applicationId = requireUuid(applicationId, "Application ID");
  sbomId = requireUuid(sbomId, "SBOM ID");
  await mergeRelationship(
    `MATCH (application:Application {application_id: $applicationId})
     MATCH (sbom:SBOM {sbom_id: $sbomId})
     OPTIONAL MATCH (:Application)-[existing:HAS_SBOM]->(sbom)
     WITH application, sbom, collect(existing) AS existingRelationships
     FOREACH (
       relationship IN existingRelationships |
       DELETE relationship
     )
     MERGE (application)-[:HAS_SBOM]->(sbom)
     RETURN application.application_id AS id`,
    { applicationId, sbomId },
    "Application or SBOM",
  );
}

export async function linkSbomToComponentVersion(
  sbomId: string,
  componentVersionId: string,
): Promise<void> {
  sbomId = requireUuid(sbomId, "SBOM ID");
  componentVersionId = requireUuid(
    componentVersionId,
    "Component version ID",
  );
  await mergeRelationship(
    `MATCH (sbom:SBOM {sbom_id: $sbomId})
     MATCH (version:ComponentVersion {
       component_version_id: $componentVersionId
     })
     MERGE (sbom)-[:CONTAINS]->(version)
     RETURN sbom.sbom_id AS id`,
    { sbomId, componentVersionId },
    "SBOM or component version",
  );
}

export async function upsertDependency(
  componentVersionId: string,
  input: DependencyGraphInput,
): Promise<void> {
  componentVersionId = requireUuid(
    componentVersionId,
    "Component version ID",
  );
  const dependsOnComponentVersionId = requireUuid(
    input.dependsOnComponentVersionId,
    "Dependency target version ID",
  );
  if (componentVersionId === dependsOnComponentVersionId) {
    throw new TypeError("A component version cannot depend on itself.");
  }
  const dependencyScope = optionalDependencyScope(input.dependencyScope);

  await mergeRelationship(
    `MATCH (source:ComponentVersion {
       component_version_id: $componentVersionId
     })
     MATCH (target:ComponentVersion {
       component_version_id: $dependsOnComponentVersionId
     })
     MERGE (source)-[dependency:DEPENDS_ON]->(target)
     SET dependency.dependency_scope = $dependencyScope
     RETURN source.component_version_id AS id`,
    {
      componentVersionId,
      dependsOnComponentVersionId,
      dependencyScope,
    },
    "Source or dependency target component version",
  );
}

export async function replaceSbomContents(
  sbomId: string,
  componentVersionIds: string[],
): Promise<void> {
  sbomId = requireUuid(sbomId, "SBOM ID");
  if (!Array.isArray(componentVersionIds)) {
    throw new TypeError("Component version IDs must be an array.");
  }
  componentVersionIds = componentVersionIds.map((id) =>
    requireUuid(id, "Component version ID"),
  );
  if (new Set(componentVersionIds).size !== componentVersionIds.length) {
    throw new TypeError("Component version IDs must not contain duplicates.");
  }

  await withNeo4jSession((session) =>
    session.executeWrite(async (transaction) => {
      const sbomResult = await transaction.run(
        `MATCH (sbom:SBOM {sbom_id: $sbomId})
         OPTIONAL MATCH (sbom)-[existing:CONTAINS]->()
         WITH sbom, collect(existing) AS existingRelationships
         FOREACH (
           relationship IN existingRelationships |
           DELETE relationship
         )
         RETURN sbom.sbom_id AS id`,
        { sbomId },
      );
      requireRecord(sbomResult.records, "SBOM");

      if (componentVersionIds.length === 0) {
        return;
      }

      const versionsResult = await transaction.run(
        `UNWIND $componentVersionIds AS componentVersionId
         MATCH (version:ComponentVersion {
           component_version_id: componentVersionId
         })
         RETURN collect(DISTINCT version.component_version_id) AS ids`,
        { componentVersionIds },
      );
      const ids = getValue<string[]>(
        requireRecord(versionsResult.records, "Component versions"),
        "ids",
      );
      if (ids.length !== componentVersionIds.length) {
        throw new Error("One or more component versions were not found in the graph.");
      }

      await transaction.run(
        `MATCH (sbom:SBOM {sbom_id: $sbomId})
         UNWIND $componentVersionIds AS componentVersionId
         MATCH (version:ComponentVersion {
           component_version_id: componentVersionId
         })
         MERGE (sbom)-[:CONTAINS]->(version)`,
        { sbomId, componentVersionIds },
      );
    }),
  );
}

export async function replaceDependenciesForVersion(
  componentVersionId: string,
  dependencies: DependencyGraphInput[],
): Promise<void> {
  componentVersionId = requireUuid(
    componentVersionId,
    "Component version ID",
  );
  if (!Array.isArray(dependencies)) {
    throw new TypeError("Dependencies must be an array.");
  }
  const normalizedDependencies: DependencyInput[] = dependencies.map(
    (dependency) => {
      const dependsOnComponentVersionId = requireUuid(
        dependency.dependsOnComponentVersionId,
        "Dependency target version ID",
      );
      if (componentVersionId === dependsOnComponentVersionId) {
        throw new TypeError("A component version cannot depend on itself.");
      }
      return {
        component_version_id: dependsOnComponentVersionId,
        dependency_scope: optionalDependencyScope(dependency.dependencyScope),
      };
    },
  );
  if (
    new Set(normalizedDependencies.map((item) => item.component_version_id))
      .size !== normalizedDependencies.length
  ) {
    throw new TypeError("Dependency target IDs must not contain duplicates.");
  }

  await withNeo4jSession((session) =>
    session.executeWrite(async (transaction) => {
      const sourceResult = await transaction.run(
        `MATCH (source:ComponentVersion {
           component_version_id: $componentVersionId
         })
         OPTIONAL MATCH (source)-[existing:DEPENDS_ON]->()
         WITH source, collect(existing) AS existingRelationships
         FOREACH (
           relationship IN existingRelationships |
           DELETE relationship
         )
         RETURN source.component_version_id AS id`,
        { componentVersionId },
      );
      requireRecord(sourceResult.records, "Source component version");

      if (normalizedDependencies.length === 0) {
        return;
      }

      const targetsResult = await transaction.run(
        `UNWIND $dependencies AS dependency
         MATCH (target:ComponentVersion {
           component_version_id: dependency.component_version_id
         })
         RETURN collect(DISTINCT target.component_version_id) AS ids`,
        { dependencies: normalizedDependencies },
      );
      const targetIds = getValue<string[]>(
        requireRecord(targetsResult.records, "Dependency targets"),
        "ids",
      );
      if (targetIds.length !== normalizedDependencies.length) {
        throw new Error("One or more dependency targets were not found in the graph.");
      }

      await transaction.run(
        `MATCH (source:ComponentVersion {
           component_version_id: $componentVersionId
         })
         UNWIND $dependencies AS dependency
         MATCH (target:ComponentVersion {
           component_version_id: dependency.component_version_id
         })
         MERGE (source)-[edge:DEPENDS_ON]->(target)
         SET edge.dependency_scope = dependency.dependency_scope`,
        { componentVersionId, dependencies: normalizedDependencies },
      );
    }),
  );
}

export async function removeApplicationSbomLink(
  applicationId: string,
  sbomId: string,
): Promise<boolean> {
  applicationId = requireUuid(applicationId, "Application ID");
  sbomId = requireUuid(sbomId, "SBOM ID");
  return removeRelationship(
    `MATCH (application:Application {application_id: $applicationId})
     -[relationship:HAS_SBOM]->(sbom:SBOM {sbom_id: $sbomId})
     DELETE relationship
     RETURN true AS removed`,
    { applicationId, sbomId },
  );
}

export async function removeSbomComponentVersionLink(
  sbomId: string,
  componentVersionId: string,
): Promise<boolean> {
  sbomId = requireUuid(sbomId, "SBOM ID");
  componentVersionId = requireUuid(
    componentVersionId,
    "Component version ID",
  );
  return removeRelationship(
    `MATCH (sbom:SBOM {sbom_id: $sbomId})
     -[relationship:CONTAINS]->(version:ComponentVersion {
       component_version_id: $componentVersionId
     })
     DELETE relationship
     RETURN true AS removed`,
    { sbomId, componentVersionId },
  );
}

export async function removeDependency(
  componentVersionId: string,
  dependsOnComponentVersionId: string,
): Promise<boolean> {
  componentVersionId = requireUuid(
    componentVersionId,
    "Component version ID",
  );
  dependsOnComponentVersionId = requireUuid(
    dependsOnComponentVersionId,
    "Dependency target version ID",
  );
  return removeRelationship(
    `MATCH (source:ComponentVersion {
       component_version_id: $componentVersionId
     })-[relationship:DEPENDS_ON]->(target:ComponentVersion {
       component_version_id: $dependsOnComponentVersionId
     })
     DELETE relationship
     RETURN true AS removed`,
    { componentVersionId, dependsOnComponentVersionId },
  );
}

async function removeRelationship(
  query: string,
  parameters: Record<string, unknown>,
): Promise<boolean> {
  return withNeo4jSession((session) =>
    session.executeWrite(async (transaction) => {
      const result = await transaction.run(query, parameters);
      return result.records.length > 0;
    }),
  );
}

export async function getApplicationSbomGraph(
  applicationId: string,
  options: GraphQueryOptions = {},
): Promise<ApplicationSbomGraph | null> {
  applicationId = requireUuid(applicationId, "Application ID");
  const { limit, maxDepth } = getLimits(options);
  const rows = await runRead(async (transaction) => {
    const result = await transaction.run(
      `MATCH (application:Application {application_id: $applicationId})
       OPTIONAL MATCH (application)-[:HAS_SBOM]->(sbom:SBOM)
       OPTIONAL MATCH (sbom)-[:CONTAINS]->(root:ComponentVersion)
       OPTIONAL MATCH path = (root)-[:DEPENDS_ON*0..${maxDepth}]->(
         reachable:ComponentVersion
       )
       OPTIONAL MATCH (rootComponent:Component)-[:HAS_VERSION]->(root)
       OPTIONAL MATCH (reachableComponent:Component)-[:HAS_VERSION]->(reachable)
       RETURN
         application {
           .application_id, .application_name, .description, .created_at
         } AS application,
         sbom { .sbom_id, .format, .generated_at } AS sbom,
         root {
           .component_version_id, .version_number, .release_date, .license_id
         } AS root,
         rootComponent {
           .component_id, .component_name, .component_type
         } AS rootComponent,
         reachable {
           .component_version_id, .version_number, .release_date, .license_id
         } AS reachable,
         reachableComponent {
           .component_id, .component_name, .component_type
         } AS reachableComponent,
         [relationship IN relationships(path) | {
           sourceId: startNode(relationship).component_version_id,
           targetId: endNode(relationship).component_version_id,
           dependencyScope: relationship.dependency_scope
         }] AS dependencies
       ORDER BY sbom.generated_at, root.component_version_id, length(path)
       LIMIT $rowLimit`,
      { applicationId, rowLimit: neo4j.int(limit + 1) },
    );
    return result.records;
  });

  if (rows.length === 0) {
    return null;
  }

  const truncated = rows.length > limit;
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const nodeKey = (kind: GraphNode["kind"], id: string) => `${kind}:${id}`;
  const addNode = (node: GraphNode | null) => {
    if (!node) {
      return;
    }
    const id =
      node.kind === "Application"
        ? node.data.application_id
        : node.kind === "SBOM"
          ? node.data.sbom_id
          : node.kind === "Component"
            ? node.data.component_id
            : node.data.component_version_id;
    nodes.set(nodeKey(node.kind, id), node);
  };
  const addEdge = (edge: GraphEdge) => {
    edges.set(`${edge.type}:${edge.sourceId}:${edge.targetId}`, edge);
  };

  const application = getValue<ApplicationGraphNode>(rows[0], "application");
  addNode({ kind: "Application", data: application });

  for (const row of rows.slice(0, limit)) {
    const sbom = getValue<SbomGraphNode | null>(row, "sbom");
    const root = getValue<ComponentVersionGraphNode | null>(row, "root");
    const rootComponent = getValue<ComponentGraphNode | null>(
      row,
      "rootComponent",
    );
    const reachable = getValue<ComponentVersionGraphNode | null>(
      row,
      "reachable",
    );
    const reachableComponent = getValue<ComponentGraphNode | null>(
      row,
      "reachableComponent",
    );

    addNode(sbom && { kind: "SBOM", data: sbom });
    addNode(root && { kind: "ComponentVersion", data: root });
    addNode(rootComponent && { kind: "Component", data: rootComponent });
    addNode(reachable && { kind: "ComponentVersion", data: reachable });
    addNode(
      reachableComponent && {
        kind: "Component",
        data: reachableComponent,
      },
    );

    if (sbom) {
      addEdge({
        type: "HAS_SBOM",
        sourceId: application.application_id,
        targetId: sbom.sbom_id,
      });
    }
    if (sbom && root) {
      addEdge({
        type: "CONTAINS",
        sourceId: sbom.sbom_id,
        targetId: root.component_version_id,
      });
    }
    if (root && rootComponent) {
      addEdge({
        type: "HAS_VERSION",
        sourceId: rootComponent.component_id,
        targetId: root.component_version_id,
      });
    }
    if (reachable && reachableComponent) {
      addEdge({
        type: "HAS_VERSION",
        sourceId: reachableComponent.component_id,
        targetId: reachable.component_version_id,
      });
    }

    const dependencies = getValue<
      Array<{
        sourceId: string;
        targetId: string;
        dependencyScope: string | null;
      }> | null
    >(row, "dependencies");
    for (const dependency of dependencies ?? []) {
      addEdge({
        type: "DEPENDS_ON",
        sourceId: dependency.sourceId,
        targetId: dependency.targetId,
        dependencyScope: dependency.dependencyScope,
      });
    }
  }

  return {
    application,
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    truncated,
  };
}

export async function getDirectDependencies(
  componentVersionId: string,
  options: Pick<GraphQueryOptions, "limit"> = {},
): Promise<DirectDependency[]> {
  componentVersionId = requireUuid(
    componentVersionId,
    "Component version ID",
  );
  const { limit } = getLimits({ ...options, maxDepth: 1 });
  return runRead(async (transaction) => {
    const result = await transaction.run(
      `MATCH (source:ComponentVersion {
         component_version_id: $componentVersionId
       })-[dependency:DEPENDS_ON]->(target:ComponentVersion)
       RETURN target {
         .component_version_id, .version_number, .release_date, .license_id
       } AS componentVersion,
       dependency.dependency_scope AS dependencyScope
       ORDER BY target.version_number, target.component_version_id
       LIMIT $limit`,
      { componentVersionId, limit: neo4j.int(limit) },
    );
    return result.records.map((record) => ({
      componentVersion: getValue<ComponentVersionGraphNode>(
        record,
        "componentVersion",
      ),
      dependencyScope: getValue<string | null>(record, "dependencyScope"),
    }));
  });
}

export async function getTransitiveDependencies(
  componentVersionId: string,
  options: GraphQueryOptions = {},
): Promise<DependencyAtDepth[]> {
  componentVersionId = requireUuid(
    componentVersionId,
    "Component version ID",
  );
  const { limit, maxDepth } = getLimits(options);
  return runRead(async (transaction) => {
    const result = await transaction.run(
      `MATCH (source:ComponentVersion {
         component_version_id: $componentVersionId
       })
       MATCH path = (source)-[:DEPENDS_ON*1..${maxDepth}]->(
         dependency:ComponentVersion
       )
       WHERE dependency.component_version_id <> source.component_version_id
       WITH dependency, min(length(path)) AS depth
       ORDER BY depth, dependency.version_number, dependency.component_version_id
       LIMIT $limit
       RETURN dependency {
         .component_version_id, .version_number, .release_date, .license_id
       } AS componentVersion, depth`,
      { componentVersionId, limit: neo4j.int(limit) },
    );
    return result.records.map((record) => ({
      componentVersion: getValue<ComponentVersionGraphNode>(
        record,
        "componentVersion",
      ),
      depth: getIntegerValue(record, "depth"),
    }));
  });
}

export async function getTransitiveDependents(
  componentVersionId: string,
  options: GraphQueryOptions = {},
): Promise<DependencyAtDepth[]> {
  componentVersionId = requireUuid(
    componentVersionId,
    "Component version ID",
  );
  const { limit, maxDepth } = getLimits(options);
  return runRead(async (transaction) => {
    const result = await transaction.run(
      `MATCH (target:ComponentVersion {
         component_version_id: $componentVersionId
       })
       MATCH path = (target)<-[:DEPENDS_ON*1..${maxDepth}]-(dependent:ComponentVersion)
       WITH dependent, min(length(path)) AS depth
       ORDER BY depth, dependent.version_number, dependent.component_version_id
       LIMIT $limit
       RETURN dependent {
         .component_version_id, .version_number, .release_date, .license_id
       } AS componentVersion, depth`,
      { componentVersionId, limit: neo4j.int(limit) },
    );
    return result.records.map((record) => ({
      componentVersion: getValue<ComponentVersionGraphNode>(
        record,
        "componentVersion",
      ),
      depth: getIntegerValue(record, "depth"),
    }));
  });
}

export async function findShortestDependencyPaths(
  sourceComponentVersionId: string,
  targetComponentVersionId: string,
  options: GraphQueryOptions = {},
): Promise<DependencyPathsResult> {
  sourceComponentVersionId = requireUuid(
    sourceComponentVersionId,
    "Source component version ID",
  );
  targetComponentVersionId = requireUuid(
    targetComponentVersionId,
    "Target component version ID",
  );
  const { limit, maxDepth } = getLimits(options);
  return runRead(async (transaction) => {
    const result = await transaction.run(
      `MATCH (source:ComponentVersion {
         component_version_id: $sourceComponentVersionId
       })
       MATCH (target:ComponentVersion {
         component_version_id: $targetComponentVersionId
       })
       MATCH path = allShortestPaths(
         (source)-[:DEPENDS_ON*1..${maxDepth}]->(target)
       )
       RETURN
         [node IN nodes(path) | node {
           .component_version_id, .version_number, .release_date, .license_id
         }] AS componentVersions,
         length(path) AS depth
       LIMIT $rowLimit`,
      {
        sourceComponentVersionId,
        targetComponentVersionId,
        rowLimit: neo4j.int(limit + 1),
      },
    );
    return {
      paths: result.records.slice(0, limit).map((record) => ({
        componentVersions: getValue<ComponentVersionGraphNode[]>(
          record,
          "componentVersions",
        ),
        depth: getIntegerValue(record, "depth"),
      })),
      truncated: result.records.length > limit,
    };
  });
}

export async function findAffectedApplications(
  componentVersionId: string,
  options: GraphQueryOptions = {},
): Promise<AffectedApplicationsResult> {
  componentVersionId = requireUuid(
    componentVersionId,
    "Component version ID",
  );
  const { limit, maxDepth } = getLimits(options);
  return runRead(async (transaction) => {
    const result = await transaction.run(
      `MATCH (target:ComponentVersion {
         component_version_id: $componentVersionId
       })
       MATCH (application:Application)-[:HAS_SBOM]->(:SBOM)
         -[:CONTAINS]->(root:ComponentVersion)
       MATCH path = (root)-[:DEPENDS_ON*0..${maxDepth}]->(target)
       WITH application, min(length(path)) AS dependencyDepth
       ORDER BY application.application_name, application.application_id
       LIMIT $rowLimit
       RETURN application {
         .application_id, .application_name, .description, .created_at
       } AS application, dependencyDepth`,
      { componentVersionId, rowLimit: neo4j.int(limit + 1) },
    );
    return {
      applications: result.records.slice(0, limit).map((record) => ({
        application: getValue<ApplicationGraphNode>(record, "application"),
        dependencyDepth: getIntegerValue(record, "dependencyDepth"),
      })),
      truncated: result.records.length > limit,
    };
  });
}
