"use server";

import { redirect } from "next/navigation";
import { loginWithPassword, logout } from "@/server/auth";

export interface LoginFormState {
  error?: string;
}

export async function loginAction(
  _previousState: LoginFormState,
  formData: FormData,
): Promise<LoginFormState> {
  const identityValue = formData.get("identity");
  const passwordValue = formData.get("password");
  const identity =
    typeof identityValue === "string" ? identityValue.trim() : "";
  const password = typeof passwordValue === "string" ? passwordValue : "";

  if (
    identity.length === 0 ||
    identity.length > 254 ||
    password.length === 0 ||
    Buffer.byteLength(password, "utf8") > 72
  ) {
    return { error: "Enter a valid username or email and password." };
  }

  const user = await loginWithPassword(identity, password);
  if (!user) {
    return { error: "The username/email or password is incorrect." };
  }
  redirect("/");
}

export async function logoutAction(): Promise<void> {
  await logout();
  redirect("/login");
}
