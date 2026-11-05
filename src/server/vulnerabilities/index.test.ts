import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  execute,
  beginTransaction,
  commit,
  rollback,
  release,
  getConnection,
} = vi.hoisted(() => ({
  execute: vi.fn(),
  beginTransaction: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  release: vi.fn(),
  getConnection: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/mysql", () => ({
  getMySqlPool: () => ({ execute, getConnection }),
}));

import {
  createVulnerability,
  listApplicationsWithOpenVulnerabilities,
  listVulnerabilityFindings,
  listVulnerabilitiesForGraph,
  updateRemediationStatus,
} from "./index";

const versionId = "f1c57f52-3244-4db4-b10c-f1b2b555d002";
const vulnerabilityId = "d4a9b522-d33a-4f2c-9b5b-65cfe521d001";

describe("vulnerability database operations", () => {
  beforeEach(() => {
    execute.mockReset().mockResolvedValue([{ affectedRows: 1 }, undefined]);
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

  it("inserts a vulnerability and affected-version links in one transaction", async () => {
    const id = await createVulnerability({
      cveId: "CVE-2025-12345",
      severity: "HIGH",
      affectedComponentVersionIds: [versionId],
    });

    expect(execute).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("INSERT INTO VULNERABILITY"),
      [id, "CVE-2025-12345", "HIGH", null],
    );
    expect(execute).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("INSERT INTO COMPONENT_VERSION_VULNERABILITY"),
      [versionId, id],
    );
    expect(commit).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });

  it("rejects a severity outside the schema constraint", async () => {
    await expect(
      Reflect.apply(createVulnerability, undefined, [
        {
          cveId: "CVE-2025-12345",
          severity: "URGENT",
          affectedComponentVersionIds: [],
        },
      ]),
    ).rejects.toThrow("Severity must be");
    expect(getConnection).not.toHaveBeenCalled();
  });

  it("updates remediation status using both primary-key columns", async () => {
    await expect(
      updateRemediationStatus(versionId, vulnerabilityId, "resolved"),
    ).resolves.toBe(true);
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE COMPONENT_VERSION_VULNERABILITY"),
      ["resolved", versionId, vulnerabilityId],
    );
  });

  it("uses the vulnerability view and app join for findings", async () => {
    const rows = [{ cve_id: "CVE-2025-12345" }];
    execute.mockResolvedValue([rows, undefined]);

    await expect(listVulnerabilityFindings()).resolves.toBe(rows);
    expect(execute.mock.calls[0][0]).toContain(
      "FROM V_OPEN_VULNERABILITY_FINDINGS",
    );
    expect(execute.mock.calls[0][0]).toContain("LEFT JOIN APPLICATION");
  });

  it("provides unremediated findings for graph synchronization", async () => {
    const rows = [{ component_version_id: versionId }];
    execute.mockResolvedValue([rows, undefined]);

    await expect(listVulnerabilitiesForGraph()).resolves.toBe(rows);
    expect(execute.mock.calls[0][0]).toContain(
      "FROM V_OPEN_VULNERABILITY_FINDINGS",
    );
  });

  it("uses a correlated subquery to find impacted applications", async () => {
    const rows = [{ application_id: "application" }];
    execute.mockResolvedValue([rows, undefined]);

    await expect(listApplicationsWithOpenVulnerabilities()).resolves.toBe(
      rows,
    );
    expect(execute.mock.calls[0][0]).toContain("WHERE EXISTS");
    expect(execute.mock.calls[0][0]).toContain("WHERE s.application_id = a.application_id");
  });
});
