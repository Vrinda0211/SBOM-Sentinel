# Neo4j graph operations and Cypher

Neo4j complements MySQL: MySQL owns applications, SBOMs, versions, licenses,
and vulnerability findings; Neo4j stores directed version dependency edges
for bounded graph traversal and impact analysis. Graph nodes reuse UUIDs
persisted by MySQL. Vulnerability records are not copied into the graph.

The executable implementation is in
[`src/server/graph/index.ts`](../../src/server/graph/index.ts), with MySQL to
Neo4j orchestration in
[`src/server/sboms/graph-sync.ts`](../../src/server/sboms/graph-sync.ts).
Queries below illustrate those implemented operations; `$...` values are
driver parameters, never concatenated user input.

## Identity constraints and safe upsert

`initializeNeo4jGraph()` issues these idempotent constraints:

```cypher
CREATE CONSTRAINT application_id_unique IF NOT EXISTS
FOR (node:Application) REQUIRE node.application_id IS UNIQUE;
CREATE CONSTRAINT sbom_id_unique IF NOT EXISTS
FOR (node:SBOM) REQUIRE node.sbom_id IS UNIQUE;
CREATE CONSTRAINT component_id_unique IF NOT EXISTS
FOR (node:Component) REQUIRE node.component_id IS UNIQUE;
CREATE CONSTRAINT component_version_id_unique IF NOT EXISTS
FOR (node:ComponentVersion) REQUIRE node.component_version_id IS UNIQUE;
```

The implementation verifies each resulting constraint by name, type
(`NODE_PROPERTY_UNIQUENESS`), entity type (`NODE`), label, and property. It
does not drop and recreate existing constraints.

```cypher
MERGE (node:ComponentVersion {
  component_version_id: $componentVersionId
})
SET node += $properties
RETURN node.component_version_id AS id;
```

Other node upserts follow the same parameterized `MERGE` pattern for
`Application`, `SBOM`, and `Component`. Relationships are also idempotently
merged:

```cypher
MATCH (source:ComponentVersion {
  component_version_id: $componentVersionId
})
MATCH (target:ComponentVersion {
  component_version_id: $dependsOnComponentVersionId
})
MERGE (source)-[dependency:DEPENDS_ON]->(target)
SET dependency.dependency_scope = $dependencyScope;
```

The direction is dependent component version -> version it depends on.
`HAS_SBOM`, `CONTAINS`, and `HAS_VERSION` connect their matching node types.
Before synchronization creates edges, it upserts all relevant nodes,
including dependency targets outside the current SBOM.

## Read and analysis patterns

Direct dependencies:

```cypher
MATCH (source:ComponentVersion {
  component_version_id: $componentVersionId
})-[edge:DEPENDS_ON]->(target:ComponentVersion)
RETURN target, edge.dependency_scope AS dependency_scope
ORDER BY target.component_version_id
LIMIT $limit;
```

Transitive dependencies (bounded traversal):

```cypher
MATCH path = (source:ComponentVersion {
  component_version_id: $componentVersionId
})-[:DEPENDS_ON*1..5]->(target:ComponentVersion)
RETURN DISTINCT target
LIMIT $limit;
```

The example shows depth 5. The implementation substitutes only `maxDepth`
after validating it as an integer in the allowed range; node IDs and result
limits are bound parameters. Reverse dependencies traverse the directed edge
backward:

```cypher
MATCH path = (target:ComponentVersion {
  component_version_id: $componentVersionId
})<-[:DEPENDS_ON*1..5]-(dependent:ComponentVersion)
RETURN DISTINCT dependent
LIMIT $limit;
```

Shortest path between component versions:

```cypher
MATCH (source:ComponentVersion {
  component_version_id: $sourceComponentVersionId
}),
(target:ComponentVersion {
  component_version_id: $targetComponentVersionId
})
MATCH path = allShortestPaths(
  (source)-[:DEPENDS_ON*1..5]->(target)
)
RETURN path
LIMIT $limit;
```

Applications containing the selected version or a version transitively
depending on it are identified by matching from each application SBOM root:

```cypher
MATCH (application:Application)-[:HAS_SBOM]->(sbom:SBOM)
MATCH (sbom)-[:CONTAINS]->(root:ComponentVersion)
MATCH path = (root)-[:DEPENDS_ON*0..5]->(target:ComponentVersion {
  component_version_id: $componentVersionId
})
RETURN DISTINCT application, length(path) AS dependency_depth
ORDER BY dependency_depth, application.application_name
LIMIT $limit;
```

Unknown start/target nodes produce empty results or a clear missing-node
error, depending on the operation. Read results are bounded (defaults: depth
5 and 100 results; maxima: depth 12 and 500 results). Relationship
replacement and removal use Neo4j transactions; repeated synchronization
uses `MERGE` and is tested for idempotent outcomes.

## Verification status

Automated graph and sync tests mock the Neo4j driver; they test query
selection, parameters, constraint verification behavior, relationship
direction, replacement, limits, and synchronization ordering. They are not a
live Neo4j verification. Capture the actual `SHOW CONSTRAINTS` and a successful
read-only graph query using the manual steps in
[the evidence checklist](EVIDENCE_CHECKLIST.md).
