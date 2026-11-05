import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/mysql", () => ({
  getMySqlPool: () => ({ execute }),
}));

import {
  addComponentVersion,
  createLicense,
  findApplicationsUsingComponent,
  listComponentVersions,
  listComponents,
  listLicenses,
} from "./index";

const componentId = "d4a9b522-d33a-4f2c-9b5b-65cfe521d001";

describe("component and license database operations", () => {
  beforeEach(() => {
    execute.mockReset();
  });

  it("uses a grouped left join for the component listing", async () => {
    const rows = [{ component_id: componentId, version_count: 2 }];
    execute.mockResolvedValue([rows, undefined]);

    await expect(listComponents()).resolves.toBe(rows);
    expect(execute.mock.calls[0][0]).toContain("LEFT JOIN COMPONENT_VERSION");
    expect(execute.mock.calls[0][0]).toContain("GROUP BY");
  });

  it("uses parameterized inner and left joins to list component versions", async () => {
    const rows = [{ component_id: componentId, version_number: "1.0.0" }];
    execute.mockResolvedValue([rows, undefined]);

    await expect(listComponentVersions(componentId)).resolves.toBe(rows);
    expect(execute.mock.calls[0][0]).toContain("INNER JOIN COMPONENT");
    expect(execute.mock.calls[0][0]).toContain("LEFT JOIN LICENSE");
    expect(execute.mock.calls[0][1]).toEqual([componentId]);
  });

  it("creates a license with a generated ID and bound parameters", async () => {
    execute.mockResolvedValue([{}, undefined]);

    const id = await createLicense({
      licenseName: "MIT License",
      spdxIdentifier: "MIT",
    });

    expect(execute.mock.calls[0][0]).toContain("INSERT INTO LICENSE");
    expect(execute.mock.calls[0][1]).toEqual([id, "MIT License", "MIT", null]);
    expect(id).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("inserts a component version against its existing component", async () => {
    execute.mockResolvedValue([{}, undefined]);

    const versionId = await addComponentVersion(componentId, {
      versionNumber: "1.2.3",
      releaseDate: "2024-01-02",
    });

    expect(execute.mock.calls[0][0]).toContain("INSERT INTO COMPONENT_VERSION");
    expect(execute.mock.calls[0][1]).toEqual([
      versionId,
      componentId,
      null,
      "1.2.3",
      "2024-01-02",
    ]);
  });

  it("finds applications using a component through their SBOMs", async () => {
    const rows = [{ application_id: "application" }];
    execute.mockResolvedValue([rows, undefined]);

    await expect(findApplicationsUsingComponent(componentId)).resolves.toBe(
      rows,
    );
    expect(execute.mock.calls[0][0]).toContain("INNER JOIN SBOM_CONTAINS");
    expect(execute.mock.calls[0][1]).toEqual([componentId]);
  });

  it("lists licenses in stable name order", async () => {
    execute.mockResolvedValue([[], undefined]);

    await expect(listLicenses()).resolves.toEqual([]);
    expect(execute.mock.calls[0][0]).toContain("ORDER BY license_name ASC");
  });
});
