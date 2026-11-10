import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  execute,
  registerApplicationInTransaction,
  addComponentVersionInTransaction,
  addComponentVersionLicenseInTransaction,
  createComponentInTransaction,
  createLicenseInTransaction,
  ensureDependencyInTransaction,
  createSbomInTransaction,
  transactionState,
} = vi.hoisted(() => ({
  execute: vi.fn(),
  registerApplicationInTransaction: vi.fn(),
  addComponentVersionInTransaction: vi.fn(),
  addComponentVersionLicenseInTransaction: vi.fn(),
  createComponentInTransaction: vi.fn(),
  createLicenseInTransaction: vi.fn(),
  ensureDependencyInTransaction: vi.fn(),
  createSbomInTransaction: vi.fn(),
  transactionState: { commits: 0, rollbacks: 0 },
}));

vi.mock("server-only", () => ({}));
vi.mock("@/server/database", () => ({
  inTransaction: vi.fn(async (operation: (connection: unknown) => Promise<unknown>) => {
    try {
      const result = await operation({ execute });
      transactionState.commits += 1;
      return result;
    } catch (error) {
      transactionState.rollbacks += 1;
      throw error;
    }
  }),
}));
vi.mock("@/server/applications", () => ({
  registerApplicationInTransaction,
}));
vi.mock("@/server/components", () => ({
  addComponentVersionInTransaction,
  addComponentVersionLicenseInTransaction,
  createComponentInTransaction,
  createLicenseInTransaction,
}));
vi.mock("@/server/dependencies", () => ({ ensureDependencyInTransaction }));
vi.mock("@/server/sboms", () => ({ createSbomInTransaction }));

import { importSbomContent } from "./import";

const applicationId = "d4a9b522-d33a-4f2c-9b5b-65cfe521d001";
const sbomId = "f1c57f52-3244-4db4-b10c-f1b2b555d002";
const componentIds = [
  "d43f502f-2d8e-4c48-bd44-74eebfcdaa03",
  "c50d1054-e53c-4a1f-8a58-ea80444ec004",
];
const versionIds = [
  "826cae55-05c3-4f23-a9ec-d6a5a1f3a004",
  "130a507f-ea85-45ce-af5a-fd6a53c84005",
];
const licenseIds = [
  "86ff48ed-4179-4cca-9e68-6596be7fb006",
  "1c792001-0c67-4c79-98c4-a472123b7007",
];

const sample = JSON.stringify({
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  version: 1,
  metadata: {
    component: {
      type: "application",
      "bom-ref": "app",
      name: "Sentinel",
      version: "1.0",
    },
  },
  components: [
    {
      type: "library",
      "bom-ref": "first",
      name: "first-package",
      version: "1.2.3",
      licenses: [
        { license: { id: "MIT" } },
        { license: { id: "Apache-2.0" } },
      ],
    },
    {
      type: "library",
      "bom-ref": "second",
      name: "second-package",
      version: "4.5.6",
    },
  ],
  dependencies: [{ ref: "first", dependsOn: ["second"] }],
});

describe("transactional SBOM import", () => {
  beforeEach(() => {
    execute.mockReset().mockResolvedValue([[], undefined]);
    registerApplicationInTransaction
      .mockReset()
      .mockResolvedValue(applicationId);
    createComponentInTransaction
      .mockReset()
      .mockResolvedValueOnce(componentIds[0])
      .mockResolvedValueOnce(componentIds[1]);
    createLicenseInTransaction
      .mockReset()
      .mockResolvedValueOnce(licenseIds[0])
      .mockResolvedValueOnce(licenseIds[1]);
    addComponentVersionInTransaction
      .mockReset()
      .mockResolvedValueOnce(versionIds[0])
      .mockResolvedValueOnce(versionIds[1]);
    addComponentVersionLicenseInTransaction.mockReset().mockResolvedValue(undefined);
    ensureDependencyInTransaction.mockReset().mockResolvedValue(undefined);
    createSbomInTransaction.mockReset().mockResolvedValue(sbomId);
    transactionState.commits = 0;
    transactionState.rollbacks = 0;
  });

  it("persists component licenses and directed dependency edges in one transaction", async () => {
    const result = await importSbomContent(sample);

    expect(result).toMatchObject({
      applicationId,
      sbomId,
      format: "CycloneDX",
      packageCount: 2,
      componentVersionCount: 2,
      dependencyCount: 1,
      createdApplication: true,
      createdComponentCount: 2,
      createdVersionCount: 2,
    });
    expect(addComponentVersionLicenseInTransaction).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      versionIds[0],
      licenseIds[0],
    );
    expect(addComponentVersionLicenseInTransaction).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      versionIds[0],
      licenseIds[1],
    );
    expect(ensureDependencyInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      {
        componentVersionId: versionIds[0],
        dependsOnComponentVersionId: versionIds[1],
        dependencyScope: null,
      },
    );
    expect(createSbomInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      {
        applicationId,
        format: "CycloneDX",
        componentVersionIds: versionIds,
      },
      undefined,
    );
    expect(transactionState).toEqual({ commits: 1, rollbacks: 0 });
  });

  it("reuses identical component and version records within one uploaded SBOM", async () => {
    let componentCreated = false;
    let versionCreated = false;
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM COMPONENT_VERSION")) {
        return [
          versionCreated
            ? [{ component_version_id: versionIds[0] }]
            : [],
          undefined,
        ];
      }
      if (sql.includes("FROM COMPONENT")) {
        return [
          componentCreated ? [{ component_id: componentIds[0] }] : [],
          undefined,
        ];
      }
      return [[], undefined];
    });
    createComponentInTransaction
      .mockReset()
      .mockImplementation(async () => {
        componentCreated = true;
        return componentIds[0];
      });
    addComponentVersionInTransaction
      .mockReset()
      .mockImplementation(async () => {
        versionCreated = true;
        return versionIds[0];
      });

    const duplicatePackages = JSON.stringify({
      bomFormat: "CycloneDX",
      specVersion: "1.5",
      version: 1,
      metadata: {
        component: {
          type: "application",
          "bom-ref": "app",
          name: "Sentinel",
        },
      },
      components: [
        {
          type: "library",
          "bom-ref": "first-identifier",
          name: "shared-package",
          version: "1.0",
        },
        {
          type: "library",
          "bom-ref": "second-identifier",
          name: "shared-package",
          version: "1.0",
        },
      ],
    });

    const result = await importSbomContent(duplicatePackages);

    expect(result).toMatchObject({
      packageCount: 2,
      componentVersionCount: 1,
      createdComponentCount: 1,
      reusedComponentCount: 1,
      createdVersionCount: 1,
      reusedVersionCount: 1,
    });
    expect(createComponentInTransaction).toHaveBeenCalledOnce();
    expect(addComponentVersionInTransaction).toHaveBeenCalledOnce();
    expect(createSbomInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ componentVersionIds: [versionIds[0]] }),
      undefined,
    );
  });

  it("rolls back before creating an SBOM if a component version fails", async () => {
    addComponentVersionInTransaction
      .mockReset()
      .mockResolvedValueOnce(versionIds[0])
      .mockRejectedValueOnce(new Error("version insert failed"));

    await expect(importSbomContent(sample)).rejects.toThrow(
      "version insert failed",
    );

    expect(createSbomInTransaction).not.toHaveBeenCalled();
    expect(transactionState).toEqual({ commits: 0, rollbacks: 1 });
  });

  it("rejects malformed SBOM content before opening a transaction", async () => {
    await expect(importSbomContent("{")).rejects.toThrow(
      "valid JSON",
    );
    expect(transactionState).toEqual({ commits: 0, rollbacks: 0 });
  });
});
