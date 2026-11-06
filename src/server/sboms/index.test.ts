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

import {
  addSbomComponent,
  createSbom,
  getSbomGraphData,
  listSbomsForApplication,
} from "./index";

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

  it("rejects invalid SBOM input before opening a transaction", async () => {
    await expect(
      createSbom({
        applicationId: "not-a-uuid",
        format: "CycloneDX",
        componentVersionIds: [],
      }),
    ).rejects.toThrow("Application ID must be a UUID");
    expect(getConnection).not.toHaveBeenCalled();
  });

  it("rejects case-variant duplicate UUIDs before opening a transaction", async () => {
    await expect(
      createSbom({
        applicationId,
        format: "CycloneDX",
        componentVersionIds: [versionId, versionId.toUpperCase()],
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

  it("adds a single component version to an SBOM with a transaction", async () => {
    poolExecute.mockResolvedValueOnce([[], undefined]);
    getConnection.mockResolvedValue({
      execute,
      beginTransaction,
      commit,
      rollback,
      release,
    });

    await addSbomComponent(
      "3d8b8d8a-8f12-4d15-9b5b-8ec2e6dbe0d1",
      versionId,
    );

    expect(poolExecute).toHaveBeenCalledWith(
      expect.stringContaining("SELECT 1\n     FROM SBOM_CONTAINS"),
      [
        "3d8b8d8a-8f12-4d15-9b5b-8ec2e6dbe0d1",
        versionId,
      ],
    );
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO SBOM_CONTAINS"),
      [
        "3d8b8d8a-8f12-4d15-9b5b-8ec2e6dbe0d1",
        versionId,
      ],
    );
    expect(beginTransaction).toHaveBeenCalledOnce();
    expect(commit).toHaveBeenCalledOnce();
  });

  it("rejects duplicate SBOM component insertions before transaction", async () => {
    poolExecute.mockResolvedValue([[{ component_version_id: versionId }], undefined]);

    await expect(
      addSbomComponent(
        "3d8b8d8a-8f12-4d15-9b5b-8ec2e6dbe0d1",
        versionId,
      ),
    ).rejects.toThrow("already contains");
    expect(getConnection).not.toHaveBeenCalled();
  });

  it("rejects invalid SBOM component identifiers before querying", async () => {
    await expect(addSbomComponent("not-a-uuid", versionId)).rejects.toThrow(
      "SBOM ID must be a UUID",
    );
    expect(poolExecute).not.toHaveBeenCalled();
    expect(getConnection).not.toHaveBeenCalled();
  });

  it("propagates foreign-key failures from the SBOM component insert", async () => {
    poolExecute.mockResolvedValueOnce([[], undefined]);
    execute.mockRejectedValueOnce(
      Object.assign(new Error("Cannot add or update a child row"), {
        code: "ER_NO_REFERENCED_ROW_2",
      }),
    );

    await expect(
      addSbomComponent(
        "3d8b8d8a-8f12-4d15-9b5b-8ec2e6dbe0d1",
        versionId,
      ),
    ).rejects.toMatchObject({ code: "ER_NO_REFERENCED_ROW_2" });
    expect(rollback).toHaveBeenCalledOnce();
    expect(commit).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
  });

  it("propagates database duplicate errors if an SBOM component insert races", async () => {
    poolExecute.mockResolvedValueOnce([[], undefined]);
    execute.mockRejectedValueOnce(
      Object.assign(new Error("Duplicate entry"), { code: "ER_DUP_ENTRY" }),
    );

    await expect(
      addSbomComponent(
        "3d8b8d8a-8f12-4d15-9b5b-8ec2e6dbe0d1",
        versionId,
      ),
    ).rejects.toMatchObject({ code: "ER_DUP_ENTRY" });
    expect(rollback).toHaveBeenCalledOnce();
  });

  it("returns graph nodes and dependency edges for an SBOM", async () => {
    const nodeRows = [{ component_version_id: versionId, component_name: "react" }];
    const edgeRows = [{
      source_component_version_id: versionId,
      source_component_id: "source-component",
      source_component_name: "react",
      target_component_version_id: "target-version",
      target_component_id: "target-component",
      target_component_name: "scheduler",
      dependency_scope: "runtime",
    }];
    poolExecute
      .mockResolvedValueOnce([nodeRows, undefined])
      .mockResolvedValueOnce([edgeRows, undefined]);

    await expect(getSbomGraphData("3d8b8d8a-8f12-4d15-9b5b-8ec2e6dbe0d1")).resolves.toEqual({
      nodes: nodeRows,
      edges: edgeRows,
    });
    expect(poolExecute).toHaveBeenCalledTimes(2);
    expect(poolExecute.mock.calls[0][0]).toContain("FROM SBOM_CONTAINS AS sc");
    expect(poolExecute.mock.calls[0][0]).toContain("WHERE sc.sbom_id = ?");
    expect(poolExecute.mock.calls[1][0]).toContain("FROM SBOM_CONTAINS AS sc");
    expect(poolExecute.mock.calls[1][0]).toContain("WHERE sc.sbom_id = ?");
    expect(poolExecute.mock.calls[0][1]).toEqual([
      "3d8b8d8a-8f12-4d15-9b5b-8ec2e6dbe0d1",
    ]);
    expect(poolExecute.mock.calls[1][1]).toEqual([
      "3d8b8d8a-8f12-4d15-9b5b-8ec2e6dbe0d1",
    ]);
  });

  it("rejects an invalid SBOM ID before graph queries", async () => {
    await expect(getSbomGraphData("not-a-uuid")).rejects.toThrow(
      "SBOM ID must be a UUID",
    );
    expect(poolExecute).not.toHaveBeenCalled();
  });
});
