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
    execute.mockResolvedValue([{}, undefined]);

    await addDependency({
      componentVersionId: sourceVersionId,
      dependsOnComponentVersionId: targetVersionId,
      dependencyScope: " production ",
    });

    expect(execute).toHaveBeenCalledWith(
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
