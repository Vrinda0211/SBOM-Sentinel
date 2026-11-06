# MySQL integration contract

These server-only functions are implemented in `src/server/`. They use
parameterized `mysql2` queries. IDs must be UUIDs; dates, when provided, must
be valid `YYYY-MM-DD` dates. Validation errors reject with `TypeError`.
Database errors, including foreign-key and uniqueness violations, reject to
the caller. If both an
operation and its transaction rollback fail, the helper reports an
`AggregateError` containing both failures. Multi-row `createSbom` operations
use one transaction and roll back if any insert fails.

## SBOM operations

### `createSbom(input: CreateSbomInput): Promise<string>`

```ts
interface CreateSbomInput {
  applicationId: string;
  format: string;
  componentVersionIds: string[];
}
```

Creates an SBOM and its component-version associations atomically and returns
the generated SBOM UUID. `format` must be a string with 1–50 characters and
must not be empty after trimming; the trimmed value is stored.
Repeated component-version UUIDs are rejected before opening a transaction;
the database primary and foreign keys remain authoritative for concurrent
duplicates and missing application/version IDs.

### `addSbomComponent(sbomId: string, componentVersionId: string): Promise<void>`

Adds one component version to an existing SBOM. A pre-insert lookup reports an
already-present association as a validation error. The `SBOM_CONTAINS` primary
key protects against concurrent duplicates; foreign-key failures for missing
SBOM or component-version IDs are propagated.

### `getSbomGraphData(sbomId: string): Promise<{ nodes: SbomGraphNode[]; edges: SbomGraphEdge[] }>`

Returns `{ nodes, edges }`; both arrays are empty when the SBOM has no matching
records (including an unknown but syntactically valid SBOM UUID).

Each node row contains:

```ts
{
  component_version_id: string;
  component_id: string;
  component_name: string;
  version_number: string;
  application_id: string | null;
  application_name: string | null;
  vulnerability_id: string | null;
  cve_id: string | null;
  severity: string | null;
}
```

Nodes are limited to component versions associated with the requested SBOM.
Because vulnerability data is flattened into each node row, a version with
multiple vulnerabilities can appear in more than one node row; versions with
no vulnerability still appear with null vulnerability fields.

Each edge row contains:

```ts
{
  source_component_version_id: string;
  source_component_id: string;
  source_component_name: string;
  target_component_version_id: string;
  target_component_id: string;
  target_component_name: string;
  dependency_scope: string | null;
}
```

Edges are dependencies originating from a component version in the requested
SBOM. A dependency target need not itself be listed in that SBOM; its component
and version details are included in the edge row.

## Component operations

### `createComponent(input: ComponentInput): Promise<string>`

```ts
interface ComponentInput {
  componentName: string;
  componentType?: string | null;
}
```

Creates a component and returns its generated UUID. The name must be a string
with at most 255 characters and must not be empty after trimming. A provided
type must be a string with at most 100 characters and must not be empty after
trimming. Trimmed values are stored. Component names are not unique in the
existing schema, so this function does not reject same-named components.

### `addComponentVersion(componentId: string, input: AddComponentVersionInput): Promise<string>`

```ts
interface AddComponentVersionInput {
  versionNumber: string;
  licenseId?: string | null;
  releaseDate?: string | null;
}
```

Creates a version and returns its generated UUID. The component ID and any
non-null license ID must be UUIDs; version must be a string with at most 100
characters and must not be empty after trimming. The optional release date
must be a valid ISO calendar date. A pre-insert lookup rejects an existing
`(componentId, versionNumber)` pair. The database unique constraint handles
concurrent duplicates; missing component/license
foreign keys are propagated.

## Dependency operation

### `addDependency(input: DependencyInput): Promise<void>`

```ts
interface DependencyInput {
  componentVersionId: string;
  dependsOnComponentVersionId: string;
  dependencyScope?: string | null;
}
```

Adds a directed dependency. Both IDs must be UUIDs, a version cannot depend on
itself, and a provided scope must be a string with at most 50 characters and
must not be empty after trimming. A pre-insert lookup rejects an existing
edge. The database composite primary key and foreign keys
protect concurrent duplicates and missing source/target versions; database
errors are propagated.

## Verification scope

The repository's Vitest database-operation tests mock the MySQL pool. They
verify query selection, bound parameters, validation, transaction rollback,
and propagation of representative MySQL duplicate-key and foreign-key errors.
They do not execute SQL against a live MySQL server; live constraint behavior
must be verified using a locally configured database.
