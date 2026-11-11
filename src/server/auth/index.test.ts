import { beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";

const mocks = vi.hoisted(() => {
  const cookieStore = {
    delete: vi.fn(),
    get: vi.fn(),
    set: vi.fn(),
  };
  return {
    cookieStore,
    cookies: vi.fn(async () => cookieStore),
    execute: vi.fn(),
    redirect: vi.fn((path: string) => {
      throw new Error(`REDIRECT:${path}`);
    }),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/mysql", () => ({
  getMySqlPool: () => ({ execute: mocks.execute }),
}));

import {
  AuthorizationError,
  getCurrentUser,
  loginWithPassword,
  logout,
  requireAuthenticatedUser,
  requireRole,
} from "./index";

const admin = {
  user_id: "a7a5a08a-172c-4c0c-85a8-2614fc718823",
  username: "demo-admin",
  email: "admin@example.test",
  role: "Admin",
};
const viewer = {
  user_id: "a7a5a08a-172c-4c0c-85a8-2614fc718824",
  username: "demo-viewer",
  email: "viewer@example.test",
  role: "Viewer",
};
const sessionToken = "c".repeat(43);

describe("authentication and session management", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cookieStore.get.mockReturnValue(undefined);
  });

  it("logs in with a bcrypt password and creates an HTTP-only session cookie", async () => {
    const passwordHash = await bcrypt.hash("correct horse battery", 4);
    mocks.execute
      .mockResolvedValueOnce([[{ ...admin, password_hash: passwordHash }], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }, []]);

    await expect(
      loginWithPassword("DEMO-ADMIN", "correct horse battery"),
    ).resolves.toEqual({
      userId: admin.user_id,
      username: admin.username,
      email: admin.email,
      role: "Admin",
    });

    expect(mocks.execute.mock.calls[0][1]).toEqual([
      "demo-admin",
      "demo-admin",
    ]);
    expect(mocks.execute.mock.calls[1][0]).toContain("INSERT INTO APP_SESSION");
    expect(mocks.cookieStore.set).toHaveBeenCalledWith(
      "sbom_sentinel_session",
      expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      expect.objectContaining({
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        expires: expect.any(Date),
      }),
    );
  });

  it("rejects an incorrect password without creating a session", async () => {
    const passwordHash = await bcrypt.hash("correct horse battery", 4);
    mocks.execute.mockResolvedValueOnce([
      [{ ...admin, password_hash: passwordHash }],
      [],
    ]);

    await expect(
      loginWithPassword("admin@example.test", "incorrect"),
    ).resolves.toBeNull();
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.cookieStore.set).not.toHaveBeenCalled();
  });

  it("loads only a valid, unexpired session and exposes no password hash", async () => {
    mocks.cookieStore.get.mockReturnValue({ value: sessionToken });
    mocks.execute.mockResolvedValueOnce([[viewer], []]);

    await expect(getCurrentUser()).resolves.toEqual({
      userId: viewer.user_id,
      username: viewer.username,
      email: viewer.email,
      role: "Viewer",
    });
    expect(mocks.execute.mock.calls[0][0]).toContain(
      "s.expires_at > CURRENT_TIMESTAMP",
    );
    expect(mocks.execute.mock.calls[0][0]).not.toContain("password_hash");
  });

  it("treats missing or expired sessions as unauthenticated", async () => {
    await expect(getCurrentUser()).resolves.toBeNull();
    mocks.cookieStore.get.mockReturnValue({ value: sessionToken });
    mocks.execute.mockResolvedValueOnce([[], []]);

    await expect(getCurrentUser()).resolves.toBeNull();
    mocks.execute.mockResolvedValueOnce([[], []]);
    await expect(requireAuthenticatedUser()).rejects.toThrow("REDIRECT:/login");
  });

  it("permits matching roles and denies a viewer Admin access", async () => {
    mocks.cookieStore.get.mockReturnValue({ value: sessionToken });
    mocks.execute.mockResolvedValueOnce([[viewer], []]);

    await expect(requireRole("Viewer")).resolves.toMatchObject({
      role: "Viewer",
    });

    mocks.execute.mockResolvedValueOnce([[viewer], []]);
    await expect(requireRole("Admin")).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it("revokes the server session and clears its cookie on logout", async () => {
    mocks.cookieStore.get.mockReturnValue({ value: sessionToken });
    mocks.execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);

    await logout();

    expect(mocks.execute.mock.calls[0][0]).toBe(
      "DELETE FROM APP_SESSION WHERE token_hash = ?",
    );
    expect(mocks.execute.mock.calls[0][1][0]).toMatch(/^[a-f0-9]{64}$/);
    expect(mocks.cookieStore.delete).toHaveBeenCalledWith(
      "sbom_sentinel_session",
    );
  });
});
