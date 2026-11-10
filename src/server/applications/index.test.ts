import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/mysql", () => ({
  getMySqlPool: () => ({ execute }),
}));

import {
  deleteApplication,
  getApplication,
  getApplicationRiskSummary,
  listApplications,
  listApplicationsWithAtLeastVulnerableVersions,
  registerApplication,
  updateApplication,
} from "./index";

const applicationId = "d4a9b522-d33a-4f2c-9b5b-65cfe521d001";

describe("application database operations", () => {
  beforeEach(() => {
    execute.mockReset();
  });

  it("inserts a validated application using parameterized SQL", async () => {
    execute.mockResolvedValue([{}, undefined]);

    const id = await registerApplication({
      applicationName: "  Sentinel  ",
      description: null,
    });

    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO APPLICATION"),
      [id, "Sentinel", null],
    );
  });

  it("rejects invalid input without issuing SQL", async () => {
    await expect(registerApplication({ applicationName: " " })).rejects.toThrow(
      TypeError,
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it("uses joins, grouping, and ordering when listing applications", async () => {
    const rows = [{ application_id: applicationId }];
    execute.mockResolvedValue([rows, undefined]);

    await expect(listApplications()).resolves.toBe(rows);
    const [sql, parameters] = execute.mock.calls[0];
    expect(sql).toContain("LEFT JOIN SBOM");
    expect(sql).toContain("GROUP BY");
    expect(sql).toContain("ORDER BY");
    expect(parameters).toBeUndefined();
  });

  it("uses HAVING and a bound threshold for vulnerable application filtering", async () => {
    execute.mockResolvedValue([[], undefined]);

    await expect(
      listApplicationsWithAtLeastVulnerableVersions(2),
    ).resolves.toEqual([]);
    expect(execute.mock.calls[0][0]).toContain("HAVING COUNT(DISTINCT");
    expect(execute.mock.calls[0][1]).toEqual([2]);
  });

  it("parameterizes application detail, update, and delete queries", async () => {
    execute
      .mockResolvedValueOnce([[{ application_id: applicationId }], undefined])
      .mockResolvedValueOnce([{ affectedRows: 1 }, undefined])
      .mockResolvedValueOnce([{ affectedRows: 1 }, undefined]);

    await expect(getApplication(applicationId)).resolves.toMatchObject({
      application_id: applicationId,
    });
    await expect(
      updateApplication(applicationId, { applicationName: "Updated" }),
    ).resolves.toBe(true);
    await expect(deleteApplication(applicationId)).resolves.toBe(true);

    expect(execute.mock.calls[0][1]).toEqual([applicationId]);
    expect(execute.mock.calls[1][1]).toEqual(["Updated", null, applicationId]);
    expect(execute.mock.calls[2][1]).toEqual([applicationId]);
  });

  it("calls the stored risk summary with a bound application ID", async () => {
    const summary = [{ application_id: applicationId, open_finding_count: 2 }];
    execute.mockResolvedValue([[summary], undefined]);

    await expect(getApplicationRiskSummary(applicationId)).resolves.toBe(
      summary[0],
    );
    expect(execute).toHaveBeenCalledWith(
      "CALL SP_APPLICATION_RISK_SUMMARY(?)",
      [applicationId],
    );
  });

  it("rejects malformed identifiers before querying", async () => {
    await expect(getApplication("not-a-uuid")).rejects.toThrow(TypeError);
    expect(execute).not.toHaveBeenCalled();
  });
});
