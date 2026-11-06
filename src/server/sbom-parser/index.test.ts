import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  parseSbomContent,
  SbomValidationError,
  type NormalizedSbom,
} from "./index";

const cycloneDxSample = {
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  serialNumber: "urn:uuid:11111111-2222-4333-8444-555555555555",
  version: 3,
  metadata: {
    timestamp: "2025-01-02T03:04:05Z",
    component: {
      type: "application",
      "bom-ref": "app:sentinel",
      name: "SBOM Sentinel",
      version: "2.0.0",
      licenses: [{ license: { id: "MIT", name: "MIT License" } }],
    },
  },
  components: [
    {
      type: "library",
      "bom-ref": "example-lib-ref",
      name: "example-lib",
      version: "1.2.3",
      purl: "pkg:npm/example-lib@1.2.3",
      licenses: [{ expression: "Apache-2.0 OR MIT" }],
    },
    {
      type: "library",
      "bom-ref": "pkg:npm/other-lib@4.5.6",
      name: "other-lib",
      version: "4.5.6",
      purl: "pkg:npm/other-lib@4.5.6",
      licenses: [{ license: { name: "Custom License" } }],
    },
  ],
  dependencies: [
    {
      ref: "pkg:npm/example-lib@1.2.3",
      dependsOn: ["pkg:npm/other-lib@4.5.6"],
    },
  ],
};

const spdxSample = {
  spdxVersion: "SPDX-2.3",
  dataLicense: "CC0-1.0",
  SPDXID: "SPDXRef-DOCUMENT",
  name: "SBOM Sentinel release",
  documentNamespace: "https://example.test/spdx/sbom-sentinel-2.0",
  creationInfo: {
    created: "2025-02-03T04:05:06Z",
    creators: ["Tool: Example-Generator-1.0"],
  },
  packages: [
    {
      SPDXID: "SPDXRef-Application",
      name: "SBOM Sentinel",
      versionInfo: "2.0.0",
      primaryPackagePurpose: "APPLICATION",
      licenseDeclared: "MIT",
    },
    {
      SPDXID: "SPDXRef-Example",
      name: "example-lib",
      versionInfo: "1.2.3",
      primaryPackagePurpose: "LIBRARY",
      licenseDeclared: "MIT",
      licenseConcluded: "Apache-2.0",
      externalRefs: [
        {
          referenceCategory: "PACKAGE-MANAGER",
          referenceType: "purl",
          referenceLocator: "pkg:npm/example-lib@1.2.3",
        },
      ],
    },
    {
      SPDXID: "SPDXRef-Other",
      name: "other-lib",
      versionInfo: "4.5.6",
      licenseDeclared: "NOASSERTION",
      licenseInfoInFiles: ["BSD-3-Clause"],
    },
  ],
  relationships: [
    {
      spdxElementId: "SPDXRef-Example",
      relationshipType: "DEPENDS_ON",
      relatedSpdxElement: "SPDXRef-Other",
    },
    {
      spdxElementId: "SPDXRef-DOCUMENT",
      relationshipType: "DESCRIBES",
      relatedSpdxElement: "SPDXRef-Application",
    },
  ],
};

function parseSample(value: unknown): NormalizedSbom {
  return parseSbomContent(JSON.stringify(value));
}

function expectValidationError(
  operation: () => unknown,
  code: SbomValidationError["code"],
  message: string,
) {
  try {
    operation();
    throw new Error("Expected SBOM validation to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(SbomValidationError);
    expect(error).toMatchObject({ code });
    expect(error).toHaveProperty("message", expect.stringContaining(message));
  }
}

describe("SBOM content parser", () => {
  it("normalizes CycloneDX application, components, licenses and dependencies", () => {
    const sbom = parseSample(cycloneDxSample);

    expect(sbom).toMatchObject({
      format: "CycloneDX",
      metadata: {
        specVersion: "1.5",
        name: "SBOM Sentinel",
        version: 3,
        documentId: "urn:uuid:11111111-2222-4333-8444-555555555555",
        createdAt: "2025-01-02T03:04:05Z",
      },
      application: {
        id: "app:sentinel",
        name: "SBOM Sentinel",
        version: "2.0.0",
        licenses: ["MIT"],
      },
      components: [
        {
          id: "example-lib-ref",
          identifiers: ["example-lib-ref", "pkg:npm/example-lib@1.2.3"],
          name: "example-lib",
          version: "1.2.3",
          type: "library",
          purl: "pkg:npm/example-lib@1.2.3",
          licenses: ["Apache-2.0 OR MIT"],
        },
        {
          id: "pkg:npm/other-lib@4.5.6",
          name: "other-lib",
          version: "4.5.6",
          licenses: ["Custom License"],
        },
      ],
      dependencies: [
        {
          sourceId: "example-lib-ref",
          targetId: "pkg:npm/other-lib@4.5.6",
        },
      ],
    });
  });

  it("normalizes SPDX document metadata, package identifiers and dependencies", () => {
    const sbom = parseSample(spdxSample);

    expect(sbom).toMatchObject({
      format: "SPDX",
      metadata: {
        specVersion: "SPDX-2.3",
        name: "SBOM Sentinel release",
        documentId: "SPDXRef-DOCUMENT",
        documentNamespace: "https://example.test/spdx/sbom-sentinel-2.0",
        createdAt: "2025-02-03T04:05:06Z",
        licenses: ["CC0-1.0"],
      },
      application: {
        id: "SPDXRef-Application",
        name: "SBOM Sentinel",
        version: "2.0.0",
      },
      components: [
        {
          id: "SPDXRef-Example",
          identifiers: ["SPDXRef-Example", "pkg:npm/example-lib@1.2.3"],
          name: "example-lib",
          version: "1.2.3",
          type: "LIBRARY",
          purl: "pkg:npm/example-lib@1.2.3",
          licenses: ["MIT", "Apache-2.0"],
        },
        {
          id: "SPDXRef-Other",
          name: "other-lib",
          licenses: ["NOASSERTION", "BSD-3-Clause"],
        },
      ],
      dependencies: [
        { sourceId: "SPDXRef-Example", targetId: "SPDXRef-Other" },
      ],
    });
  });

  it("reverses SPDX DEPENDENCY_OF relationships into dependent-to-dependency edges", () => {
    const sbom = parseSample({
      ...spdxSample,
      relationships: [
        {
          spdxElementId: "SPDXRef-Other",
          relationshipType: "DEPENDENCY_OF",
          relatedSpdxElement: "SPDXRef-Example",
        },
      ],
    });

    expect(sbom.dependencies).toEqual([
      { sourceId: "SPDXRef-Example", targetId: "SPDXRef-Other" },
    ]);
  });

  it("resolves package URL aliases to SPDX package identifiers in dependencies", () => {
    const sbom = parseSample({
      ...spdxSample,
      relationships: [
        {
          spdxElementId: "pkg:npm/example-lib@1.2.3",
          relationshipType: "DEPENDS_ON",
          relatedSpdxElement: "SPDXRef-Other",
        },
      ],
    });

    expect(sbom.dependencies).toEqual([
      { sourceId: "SPDXRef-Example", targetId: "SPDXRef-Other" },
    ]);
  });

  it("reports malformed JSON with a typed validation error", () => {
    expectValidationError(
      () => parseSbomContent("{"),
      "malformed_json",
      "not valid JSON",
    );
  });

  it("rejects unsupported formats", () => {
    expectValidationError(
      () => parseSample({ format: "unknown" }),
      "unsupported_format",
      "expected CycloneDX JSON or SPDX JSON",
    );
    expectValidationError(
      () => parseSample({ bomFormat: "SPDX", spdxVersion: "SPDX-2.3" }),
      "unsupported_format",
      "expected CycloneDX JSON or SPDX JSON",
    );
  });

  it("rejects documents missing required identifiers", () => {
    expectValidationError(
      () =>
        parseSample({
          ...cycloneDxSample,
          components: [{ type: "library", name: "missing-id" }],
        }),
      "missing_identifier",
      "BOM reference, package URL, or CPE identifier",
    );
    expectValidationError(
      () =>
        parseSample({
          ...spdxSample,
          packages: [{ name: "missing-id" }],
        }),
      "missing_identifier",
      "Package SPDXID is required",
    );
  });

  it("rejects invalid CycloneDX and SPDX dependency references", () => {
    expectValidationError(
      () =>
        parseSample({
          ...cycloneDxSample,
          dependencies: [
            { ref: "missing-source", dependsOn: ["pkg:npm/other-lib@4.5.6"] },
          ],
        }),
      "invalid_dependency_reference",
      'unknown component identifier "missing-source"',
    );
    expectValidationError(
      () =>
        parseSample({
          ...spdxSample,
          relationships: [
            {
              spdxElementId: "SPDXRef-Example",
              relationshipType: "DEPENDS_ON",
              relatedSpdxElement: "SPDXRef-Missing",
            },
          ],
        }),
      "invalid_dependency_reference",
      'unknown component identifier "SPDXRef-Missing"',
    );
  });

  it("rejects duplicate component identifiers to avoid ambiguous references", () => {
    expectValidationError(
      () =>
        parseSample({
          ...cycloneDxSample,
          components: [
            cycloneDxSample.components[0],
            { ...cycloneDxSample.components[1], "bom-ref": "app:sentinel" },
          ],
        }),
      "invalid_document",
      'Identifier "app:sentinel" is shared by multiple packages',
    );
  });

  it("requires the format-specific document fields", () => {
    expectValidationError(
      () => parseSample({ ...cycloneDxSample, version: 0 }),
      "invalid_document",
      "positive integer",
    );
    expectValidationError(
      () => parseSample({ ...spdxSample, name: "" }),
      "invalid_document",
      "Document name must be a non-empty string",
    );
  });
});
