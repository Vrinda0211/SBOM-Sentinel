import "server-only";

export type SbomFormat = "CycloneDX" | "SPDX";

export type SbomValidationErrorCode =
  | "malformed_json"
  | "unsupported_format"
  | "invalid_document"
  | "missing_identifier"
  | "invalid_dependency_reference";

export interface SbomPackage {
  id: string;
  identifiers: string[];
  name: string;
  version: string | null;
  type: string | null;
  scope: string | null;
  purl: string | null;
  licenses: string[];
  description: string | null;
}

export interface SbomDependency {
  sourceId: string;
  targetId: string;
  dependencyScope: string | null;
}

export interface NormalizedSbom {
  format: SbomFormat;
  metadata: {
    specVersion: string;
    name: string | null;
    version: number | null;
    documentId: string | null;
    documentNamespace: string | null;
    createdAt: string | null;
    licenses: string[];
  };
  application: SbomPackage | null;
  components: SbomPackage[];
  dependencies: SbomDependency[];
}

export class SbomValidationError extends Error {
  constructor(
    public readonly code: SbomValidationErrorCode,
    public readonly path: string,
    message: string,
  ) {
    super(`${message} (${path})`);
    this.name = "SbomValidationError";
  }
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidDocument(path: string, message: string): never {
  throw new SbomValidationError("invalid_document", path, message);
}

function requiredString(
  value: unknown,
  path: string,
  label: string,
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    invalidDocument(path, `${label} must be a non-empty string.`);
  }
  return value.trim();
}

function optionalString(
  value: unknown,
  path: string,
  label: string,
): string | null {
  if (value == null) {
    return null;
  }
  return requiredString(value, path, label);
}

function requireObject(value: unknown, path: string, label: string): JsonObject {
  if (!isObject(value)) {
    invalidDocument(path, `${label} must be an object.`);
  }
  return value;
}

function requireArray(value: unknown, path: string, label: string): unknown[] {
  if (!Array.isArray(value)) {
    invalidDocument(path, `${label} must be an array.`);
  }
  return value;
}

function optionalArray(value: unknown, path: string, label: string): unknown[] {
  return value == null ? [] : requireArray(value, path, label);
}

function requireIdentifier(
  value: unknown,
  path: string,
  label: string,
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new SbomValidationError(
      "missing_identifier",
      path,
      `${label} is required.`,
    );
  }
  return value.trim();
}

function addIdentifiers(
  identifiers: string[],
  aliases: Map<string, string>,
  id: string,
  path: string,
): void {
  for (const identifier of identifiers) {
    if (aliases.has(identifier)) {
      invalidDocument(
        path,
        `Identifier "${identifier}" is shared by multiple packages.`,
      );
    }
    aliases.set(identifier, id);
  }
}

function requireReference(
  reference: string,
  aliases: Map<string, string>,
  path: string,
): string {
  const resolved = aliases.get(reference);
  if (resolved === undefined) {
    throw new SbomValidationError(
      "invalid_dependency_reference",
      path,
      `Dependency references unknown component identifier "${reference}".`,
    );
  }
  return resolved;
}

function cyclonedxLicenses(value: unknown, path: string): string[] {
  return optionalArray(value, path, "Licenses").map((entry, index) => {
    const licensePath = `${path}[${index}]`;
    const licenseEntry = requireObject(entry, licensePath, "License entry");
    const expression = optionalString(
      licenseEntry.expression,
      `${licensePath}.expression`,
      "License expression",
    );
    if (expression !== null) {
      return expression;
    }

    const license = requireObject(
      licenseEntry.license,
      `${licensePath}.license`,
      "License",
    );
    const identifier = optionalString(
      license.id,
      `${licensePath}.license.id`,
      "License identifier",
    );
    const name = optionalString(
      license.name,
      `${licensePath}.license.name`,
      "License name",
    );
    if (identifier === null && name === null) {
      invalidDocument(
        licensePath,
        "License must include an identifier, name, or expression.",
      );
    }
    if (identifier !== null) {
      return identifier;
    }
    if (name !== null) {
      return name;
    }
    invalidDocument(
      licensePath,
      "License must include an identifier, name, or expression.",
    );
  });
}

function parseCycloneDxPackage(
  value: unknown,
  path: string,
  aliases: Map<string, string>,
): SbomPackage {
  const component = requireObject(value, path, "Component");
  const name = requiredString(component.name, `${path}.name`, "Component name");
  const type = requiredString(component.type, `${path}.type`, "Component type");
  const purl = optionalString(component.purl, `${path}.purl`, "Package URL");
  const bomRef = optionalString(
    component["bom-ref"],
    `${path}.bom-ref`,
    "BOM reference",
  );
  const cpe = optionalString(component.cpe, `${path}.cpe`, "CPE identifier");
  const identifiers = [
    ...new Set(
      [bomRef, purl, cpe].filter(
        (identifier): identifier is string => identifier !== null,
      ),
    ),
  ];
  if (identifiers.length === 0) {
    throw new SbomValidationError(
      "missing_identifier",
      path,
      "Component must include a BOM reference, package URL, or CPE identifier.",
    );
  }

  const id = identifiers[0];
  addIdentifiers(identifiers, aliases, id, path);

  return {
    id,
    identifiers,
    name,
    version: optionalString(
      component.version,
      `${path}.version`,
      "Component version",
    ),
    type,
    scope: optionalString(
      component.scope,
      `${path}.scope`,
      "Component scope",
    ),
    purl,
    licenses: cyclonedxLicenses(component.licenses, `${path}.licenses`),
    description: optionalString(
      component.description,
      `${path}.description`,
      "Component description",
    ),
  };
}

function parseCycloneDx(document: JsonObject): NormalizedSbom {
  const specVersion = requiredString(
    document.specVersion,
    "$.specVersion",
    "CycloneDX specVersion",
  );
  const version = document.version;
  if (
    typeof version !== "number" ||
    !Number.isInteger(version) ||
    version < 1
  ) {
    invalidDocument("$.version", "CycloneDX version must be a positive integer.");
  }

  const metadata =
    document.metadata == null
      ? {}
      : requireObject(document.metadata, "$.metadata", "Metadata");
  const aliases = new Map<string, string>();
  const application =
    metadata.component == null
      ? null
      : parseCycloneDxPackage(
          metadata.component,
          "$.metadata.component",
          aliases,
        );
  const components = optionalArray(
    document.components,
    "$.components",
    "Components",
  ).map((component, index) =>
    parseCycloneDxPackage(component, `$.components[${index}]`, aliases),
  );
  const packageById = new Map(
    [...(application ? [application] : []), ...components].map((component) => [
      component.id,
      component,
    ]),
  );
  const dependencies = optionalArray(
    document.dependencies,
    "$.dependencies",
    "Dependencies",
  ).flatMap((entry, index) => {
    const path = `$.dependencies[${index}]`;
    const dependency = requireObject(entry, path, "Dependency");
    const sourceReference = requiredString(
      dependency.ref,
      `${path}.ref`,
      "Dependency source reference",
    );
    const sourceId = requireReference(sourceReference, aliases, `${path}.ref`);
    const targets = requireArray(
      dependency.dependsOn,
      `${path}.dependsOn`,
      "Dependency targets",
    );
    return targets.map((target, targetIndex) => {
      const targetPath = `${path}.dependsOn[${targetIndex}]`;
      const targetReference = requiredString(
        target,
        targetPath,
        "Dependency target reference",
      );
      return {
        sourceId,
        targetId: requireReference(targetReference, aliases, targetPath),
        dependencyScope: packageById.get(sourceId)?.scope ?? null,
      };
    });
  });

  return {
    format: "CycloneDX",
    metadata: {
      specVersion,
      name: application?.name ?? null,
      version,
      documentId: optionalString(
        document.serialNumber,
        "$.serialNumber",
        "Serial number",
      ),
      documentNamespace: null,
      createdAt: optionalString(
        metadata.timestamp,
        "$.metadata.timestamp",
        "Metadata timestamp",
      ),
      licenses: cyclonedxLicenses(metadata.licenses, "$.metadata.licenses"),
    },
    application,
    components,
    dependencies,
  };
}

function spdxLicenses(pkg: JsonObject, path: string): string[] {
  const licenses = [
    optionalString(
      pkg.licenseDeclared,
      `${path}.licenseDeclared`,
      "Declared license",
    ),
    optionalString(
      pkg.licenseConcluded,
      `${path}.licenseConcluded`,
      "Concluded license",
    ),
  ];
  return [
    ...licenses.filter((license): license is string => license !== null),
    ...optionalArray(
      pkg.licenseInfoInFiles,
      `${path}.licenseInfoInFiles`,
      "File licenses",
    ).map((license, index) =>
      requiredString(
        license,
        `${path}.licenseInfoInFiles[${index}]`,
        "File license",
      ),
    ),
  ];
}

function parseSpdxPackage(
  value: unknown,
  path: string,
  aliases: Map<string, string>,
): SbomPackage {
  const pkg = requireObject(value, path, "Package");
  const id = requireIdentifier(pkg.SPDXID, `${path}.SPDXID`, "Package SPDXID");
  const name = requiredString(pkg.name, `${path}.name`, "Package name");
  const externalRefs = optionalArray(
    pkg.externalRefs,
    `${path}.externalRefs`,
    "External references",
  );
  const purls = externalRefs.flatMap((value, index) => {
    const referencePath = `${path}.externalRefs[${index}]`;
    const reference = requireObject(value, referencePath, "External reference");
    if (reference.referenceType !== "purl") {
      return [];
    }
    return [
      requiredString(
        reference.referenceLocator,
        `${referencePath}.referenceLocator`,
        "Package URL",
      ),
    ];
  });
  const purl = purls[0] ?? null;
  const identifiers = [...new Set([id, ...purls])];
  addIdentifiers(identifiers, aliases, id, path);

  return {
    id,
    identifiers,
    name,
    version: optionalString(
      pkg.versionInfo,
      `${path}.versionInfo`,
      "Package version",
    ),
    type: optionalString(
      pkg.primaryPackagePurpose,
      `${path}.primaryPackagePurpose`,
      "Package purpose",
    ),
    scope: null,
    purl,
    licenses: spdxLicenses(pkg, path),
    description: optionalString(
      pkg.description,
      `${path}.description`,
      "Package description",
    ),
  };
}

function parseSpdx(document: JsonObject): NormalizedSbom {
  const specVersion = requiredString(
    document.spdxVersion,
    "$.spdxVersion",
    "SPDX version",
  );
  if (!/^SPDX-2\.\d+$/.test(specVersion)) {
    throw new SbomValidationError(
      "unsupported_format",
      "$.spdxVersion",
      `SPDX version "${specVersion}" is unsupported; expected SPDX 2.x JSON.`,
    );
  }
  const documentId = requireIdentifier(
    document.SPDXID,
    "$.SPDXID",
    "Document SPDXID",
  );
  const name = requiredString(document.name, "$.name", "Document name");
  const documentNamespace = requiredString(
    document.documentNamespace,
    "$.documentNamespace",
    "Document namespace",
  );
  const dataLicense = requiredString(
    document.dataLicense,
    "$.dataLicense",
    "SPDX data license",
  );
  const creationInfo = requireObject(
    document.creationInfo,
    "$.creationInfo",
    "Creation info",
  );
  const createdAt = requiredString(
    creationInfo.created,
    "$.creationInfo.created",
    "Creation timestamp",
  );
  const creators = requireArray(
    creationInfo.creators,
    "$.creationInfo.creators",
    "Creators",
  );
  if (creators.length === 0) {
    invalidDocument(
      "$.creationInfo.creators",
      "At least one creator is required.",
    );
  }
  creators.forEach((creator, index) =>
    requiredString(creator, `$.creationInfo.creators[${index}]`, "Creator"),
  );
  const packages = requireArray(document.packages, "$.packages", "Packages");
  const aliases = new Map<string, string>();
  const parsedPackages = packages.map((pkg, index) =>
    parseSpdxPackage(pkg, `$.packages[${index}]`, aliases),
  );
  const relationships = optionalArray(
    document.relationships,
    "$.relationships",
    "Relationships",
  ).map((value, index) => {
    const path = `$.relationships[${index}]`;
    const relationship = requireObject(value, path, "Relationship");
    return {
      path,
      type: requiredString(
        relationship.relationshipType,
        `${path}.relationshipType`,
        "Relationship type",
      ),
      subject: requiredString(
        relationship.spdxElementId,
        `${path}.spdxElementId`,
        "Relationship subject",
      ),
      related: requiredString(
        relationship.relatedSpdxElement,
        `${path}.relatedSpdxElement`,
        "Related SPDX element",
      ),
    };
  });
  const dependencies: SbomDependency[] = [];

  relationships.forEach(({ path, type, subject, related }) => {
    if (type !== "DEPENDS_ON" && type !== "DEPENDENCY_OF") {
      return;
    }

    const sourceReference = type === "DEPENDS_ON" ? subject : related;
    const targetReference = type === "DEPENDS_ON" ? related : subject;
    dependencies.push({
      sourceId: requireReference(
        sourceReference,
        aliases,
        `${path}.spdxElementId`,
      ),
      targetId: requireReference(
        targetReference,
        aliases,
        `${path}.relatedSpdxElement`,
      ),
      dependencyScope: null,
    });
  });

  const describedPackages = relationships
    .filter(
      ({ type, subject }) => type === "DESCRIBES" && subject === documentId,
    )
    .map(({ related }) => aliases.get(related))
    .filter((id): id is string => id !== undefined)
    .map((id) => parsedPackages.find((pkg) => pkg.id === id))
    .filter((pkg): pkg is SbomPackage => pkg !== undefined);
  const application =
    describedPackages.length === 1
      ? describedPackages[0]
      : {
          id: documentId,
          identifiers: [documentId],
          name,
          version: null,
          type: null,
          scope: null,
          purl: null,
          licenses: [],
          description: null,
        };
  const components =
    describedPackages.length === 1
      ? parsedPackages.filter((pkg) => pkg.id !== application.id)
      : parsedPackages;

  return {
    format: "SPDX",
    metadata: {
      specVersion,
      name,
      version: null,
      documentId,
      documentNamespace,
      createdAt,
      licenses: [dataLicense],
    },
    application,
    components,
    dependencies,
  };
}

export function parseSbomContent(content: string): NormalizedSbom {
  if (typeof content !== "string" || content.trim().length === 0) {
    throw new SbomValidationError(
      "invalid_document",
      "$",
      "SBOM content must be a non-empty JSON string.",
    );
  }

  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new SbomValidationError(
      "malformed_json",
      "$",
      "SBOM content is not valid JSON.",
    );
  }

  if (!isObject(value)) {
    invalidDocument("$", "SBOM document must be a JSON object.");
  }
  if ("bomFormat" in value && value.bomFormat !== "CycloneDX") {
    throw new SbomValidationError(
      "unsupported_format",
      "$.bomFormat",
      "SBOM format is unsupported; expected CycloneDX JSON or SPDX JSON.",
    );
  }
  if (value.bomFormat === "CycloneDX") {
    return parseCycloneDx(value);
  }
  if (
    typeof value.spdxVersion === "string" &&
    value.spdxVersion.startsWith("SPDX-")
  ) {
    return parseSpdx(value);
  }
  throw new SbomValidationError(
    "unsupported_format",
    "$",
    "SBOM format is unsupported; expected CycloneDX JSON or SPDX JSON.",
  );
}
