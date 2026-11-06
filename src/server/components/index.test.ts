import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/mysql", () => ({
  getMySqlPool: () => ({ execute }),
}));

import {
  addComponentVersion,
  createComponent,
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

  it("creates a component with a generated ID and bound parameters", async () => {
    execute.mockResolvedValue([{}, undefined]);

    const id = await createComponent({
      componentName: "react",
      componentType: "library",
    });

    expect(execute.mock.calls[0][0]).toContain("INSERT INTO COMPONENT");
    expect(execute.mock.calls[0][1]).toEqual([id, "react", "library"]);
    expect(id).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("rejects an empty component name before inserting", async () => {
    await expect(createComponent({ componentName: "  " })).rejects.toThrow(
      "Component name must contain",
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects duplicate component versions before inserting", async () => {
    execute.mockResolvedValue([[{ component_version_id: componentId }], undefined]);

    await expect(
      addComponentVersion(componentId, {
        versionNumber: "1.2.3",
        releaseDate: "2024-01-02",
      }),
    ).rejects.toThrow("already exists");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("propagates foreign-key failures when inserting a component version", async () => {
    execute
      .mockResolvedValueOnce([[], undefined])
      .mockRejectedValueOnce(
        Object.assign(new Error("Cannot add or update a child row"), {
          code: "ER_NO_REFERENCED_ROW_2",
        }),
      );

    await expect(
      addComponentVersion(componentId, {
        versionNumber: "1.2.3",
        licenseId: "f1c57f52-3244-4db4-b10c-f1b2b555d002",
      }),
    ).rejects.toMatchObject({ code: "ER_NO_REFERENCED_ROW_2" });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("propagates database duplicate errors if a component-version insert races", async () => {
    execute
      .mockResolvedValueOnce([[], undefined])
      .mockRejectedValueOnce(
        Object.assign(new Error("Duplicate entry"), { code: "ER_DUP_ENTRY" }),
      );

    await expect(
      addComponentVersion(componentId, { versionNumber: "1.2.3" }),
    ).rejects.toMatchObject({ code: "ER_DUP_ENTRY" });
  });

  it("inserts a component version against its existing component", async () => {
    execute
      .mockResolvedValueOnce([[], undefined])
      .mockResolvedValueOnce([{}, undefined]);

    const versionId = await addComponentVersion(componentId, {
      versionNumber: "1.2.3",
      releaseDate: "2024-01-02",
    });

    expect(execute.mock.calls[0][0]).toContain("FROM COMPONENT_VERSION");
    expect(execute.mock.calls[1][0]).toContain("INSERT INTO COMPONENT_VERSION");
    expect(execute.mock.calls[1][1]).toEqual([
      versionId,
      componentId,
      null,
      "1.2.3",
      "2024-01-02",
    ]);
  });

  it("rejects an invalid component-version date before querying", async () => {
    await expect(
      addComponentVersion(componentId, {
        versionNumber: "1.2.3",
        releaseDate: "2024-02-30",
      }),
    ).rejects.toThrow("Release date must be a valid calendar date");
    expect(execute).not.toHaveBeenCalled();
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
