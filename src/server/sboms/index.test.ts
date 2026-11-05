import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  execute,
  poolExecute,
  beginTransaction,
  commit,
  rollback,
  release,
  getConnection,
} = vi.hoisted(() => ({
    execute: vi.fn(),
    poolExecute: vi.fn(),
    beginTransaction: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn(),
    getConnection: vi.fn(),
  }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/mysql", () => ({
  getMySqlPool: () => ({ execute: poolExecute, getConnection }),
}));

import { createSbom, listSbomsForApplication } from "./index";

const applicationId = "d4a9b522-d33a-4f2c-9b5b-65cfe521d001";
const versionId = "f1c57f52-3244-4db4-b10c-f1b2b555d002";

describe("SBOM database operations", () => {
  beforeEach(() => {
    execute.mockReset().mockResolvedValue([{}, undefined]);
    poolExecute.mockReset().mockResolvedValue([[], undefined]);
    beginTransaction.mockReset().mockResolvedValue(undefined);
    commit.mockReset().mockResolvedValue(undefined);
    rollback.mockReset().mockResolvedValue(undefined);
    release.mockReset();
    getConnection.mockReset().mockResolvedValue({
      execute,
      beginTransaction,
      commit,
      rollback,
      release,
    });
  });

  it("inserts SBOM metadata and component associations atomically", async () => {
    const sbomId = await createSbom({
      applicationId,
      format: "CycloneDX",
      componentVersionIds: [versionId],
    });

    expect(sbomId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(execute).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("INSERT INTO SBOM"),
      [sbomId, applicationId, "CycloneDX"],
    );
    expect(execute).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("INSERT INTO SBOM_CONTAINS"),
      [sbomId, versionId],
    );
    expect(beginTransaction).toHaveBeenCalledOnce();
    expect(commit).toHaveBeenCalledOnce();
    expect(rollback).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
  });

  it("rolls back metadata when a component association fails", async () => {
    execute
      .mockResolvedValueOnce([{}, undefined])
      .mockRejectedValueOnce(new Error("foreign key failure"));

    await expect(
      createSbom({
        applicationId,
        format: "CycloneDX",
        componentVersionIds: [versionId],
      }),
    ).rejects.toThrow("foreign key failure");
    expect(rollback).toHaveBeenCalledOnce();
    expect(commit).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
  });

  it("rejects duplicate component versions before opening a transaction", async () => {
    await expect(
      createSbom({
        applicationId,
        format: "CycloneDX",
        componentVersionIds: [versionId, versionId],
      }),
    ).rejects.toThrow("must not contain duplicates");
    expect(getConnection).not.toHaveBeenCalled();
  });

  it("lists SBOMs for an application with an aggregate component count", async () => {
    const rows = [{ sbom_id: "sbom" }];
    poolExecute.mockResolvedValue([rows, undefined]);

    await expect(listSbomsForApplication(applicationId)).resolves.toBe(rows);
    expect(poolExecute.mock.calls[0][0]).toContain("COUNT(sc.component_version_id)");
    expect(poolExecute.mock.calls[0][1]).toEqual([applicationId]);
  });
});
