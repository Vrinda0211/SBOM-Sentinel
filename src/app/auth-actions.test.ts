import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loginWithPassword: vi.fn(),
  logout: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/server/auth", () => ({
  loginWithPassword: mocks.loginWithPassword,
  logout: mocks.logout,
}));

import { loginAction, logoutAction } from "./auth-actions";

function formData(identity = "demo-admin", password = "correct horse battery") {
  const form = new FormData();
  form.set("identity", identity);
  form.set("password", password);
  return form;
}

describe("login and logout server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("validates credentials before calling the authentication service", async () => {
    await expect(loginAction({}, formData("", "password"))).resolves.toEqual({
      error: "Enter a valid username or email and password.",
    });
    expect(mocks.loginWithPassword).not.toHaveBeenCalled();
  });

  it("returns a generic error for incorrect credentials", async () => {
    mocks.loginWithPassword.mockResolvedValueOnce(null);

    await expect(loginAction({}, formData())).resolves.toEqual({
      error: "The username/email or password is incorrect.",
    });
  });

  it("redirects to the dashboard after successful authentication", async () => {
    mocks.loginWithPassword.mockResolvedValueOnce({
      userId: "user-id",
      username: "demo-admin",
      email: "admin@example.test",
      role: "Admin",
    });

    await expect(loginAction({}, formData())).rejects.toThrow("REDIRECT:/");
    expect(mocks.loginWithPassword).toHaveBeenCalledWith(
      "demo-admin",
      "correct horse battery",
    );
  });

  it("revokes the current session before redirecting on logout", async () => {
    mocks.logout.mockResolvedValueOnce(undefined);

    await expect(logoutAction()).rejects.toThrow("REDIRECT:/login");
    expect(mocks.logout).toHaveBeenCalledOnce();
  });
});
