import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/mysql", () => ({
  getMySqlPool: () => ({ execute }),
}));

import {
  addDependency,
  listDependenciesForVersion,
  removeDependency,
} from "./index";

const sourceVersionId = "d4a9b522-d33a-4f2c-9b5b-65cfe521d001";
const targetVersionId = "f1c57f52-3244-4db4-b10c-f1b2b555d002";

describe("dependency database operations", () => {
  beforeEach(() => {
    execute.mockReset();
  });

  it("inserts a dependency with bound version IDs and scope", async () => {
    execute
      .mockResolvedValueOnce([[], undefined])
      .mockResolvedValueOnce([{}, undefined]);

    await addDependency({
      componentVersionId: sourceVersionId,
      dependsOnComponentVersionId: targetVersionId,
      dependencyScope: " production ",
    });

    expect(execute).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("FROM DEPENDENCY"),
      [sourceVersionId, targetVersionId],
    );
    expect(execute).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("INSERT INTO DEPENDENCY"),
      [sourceVersionId, targetVersionId, "production"],
    );
  });

  it("rejects a self-edge before querying the database", async () => {
    await expect(
      addDependency({
        componentVersionId: sourceVersionId,
        dependsOnComponentVersionId: sourceVersionId,
      }),
    ).rejects.toThrow("cannot depend on itself");
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects an invalid dependency scope before querying", async () => {
    await expect(
      addDependency({
        componentVersionId: sourceVersionId,
        dependsOnComponentVersionId: targetVersionId,
        dependencyScope: "  ",
      }),
    ).rejects.toThrow("Dependency scope must contain");
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects a duplicate dependency before inserting", async () => {
    execute.mockResolvedValue([[{ component_version_id: sourceVersionId }], undefined]);

    await expect(
      addDependency({
        componentVersionId: sourceVersionId,
        dependsOnComponentVersionId: targetVersionId,
      }),
    ).rejects.toThrow("already exists");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("propagates foreign-key failures from the dependency insert", async () => {
    execute
      .mockResolvedValueOnce([[], undefined])
      .mockRejectedValueOnce(
        Object.assign(new Error("Cannot add or update a child row"), {
          code: "ER_NO_REFERENCED_ROW_2",
        }),
      );

    await expect(
      addDependency({
        componentVersionId: sourceVersionId,
        dependsOnComponentVersionId: targetVersionId,
      }),
    ).rejects.toMatchObject({ code: "ER_NO_REFERENCED_ROW_2" });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("propagates database duplicate errors if a dependency insert races", async () => {
    execute
      .mockResolvedValueOnce([[], undefined])
      .mockRejectedValueOnce(
        Object.assign(new Error("Duplicate entry"), { code: "ER_DUP_ENTRY" }),
      );

    await expect(
      addDependency({
        componentVersionId: sourceVersionId,
        dependsOnComponentVersionId: targetVersionId,
      }),
    ).rejects.toMatchObject({ code: "ER_DUP_ENTRY" });
  });

  it("lists joined dependency and target component details", async () => {
    const rows = [{ depends_on_component_version_id: targetVersionId }];
    execute.mockResolvedValue([rows, undefined]);

    await expect(listDependenciesForVersion(sourceVersionId)).resolves.toBe(
      rows,
    );
    expect(execute.mock.calls[0][0]).toContain("INNER JOIN COMPONENT_VERSION AS target");
    expect(execute.mock.calls[0][1]).toEqual([sourceVersionId]);
  });

  it("deletes a dependency using both columns of its composite key", async () => {
    execute.mockResolvedValue([{ affectedRows: 1 }, undefined]);

    await expect(
      removeDependency(sourceVersionId, targetVersionId),
    ).resolves.toBe(true);
    expect(execute.mock.calls[0][1]).toEqual([
      sourceVersionId,
      targetVersionId,
    ]);
  });
});
