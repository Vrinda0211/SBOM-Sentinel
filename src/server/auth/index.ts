import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import type { RowDataPacket } from "mysql2/promise";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getMySqlPool } from "@/lib/mysql";

export type UserRole = "Admin" | "Viewer";

export interface AuthenticatedUser {
  userId: string;
  username: string;
  email: string;
  role: UserRole;
}

interface LoginRow extends RowDataPacket {
  user_id: string;
  username: string;
  email: string;
  password_hash: string;
  role: UserRole;
}

interface SessionUserRow extends RowDataPacket {
  user_id: string;
  username: string;
  email: string;
  role: UserRole;
}

export class AuthorizationError extends Error {
  constructor() {
    super("You do not have permission to perform this action.");
    this.name = "AuthorizationError";
  }
}

const SESSION_COOKIE = "sbom_sentinel_session";
const SESSION_LIFETIME_SECONDS = 8 * 60 * 60;
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function isSessionToken(value: string | undefined): value is string {
  return (
    value !== undefined &&
    SESSION_TOKEN_PATTERN.test(value) &&
    Buffer.from(value, "base64url").length === 32
  );
}

export async function loginWithPassword(
  identity: string,
  password: string,
): Promise<AuthenticatedUser | null> {
  const normalizedIdentity = identity.trim().toLowerCase();
  const [rows] = await getMySqlPool().execute<LoginRow[]>(
    `SELECT user_id, username, email, password_hash, role
     FROM APP_USER
     WHERE LOWER(username) = ? OR LOWER(email) = ?
     LIMIT 1`,
    [normalizedIdentity, normalizedIdentity],
  );
  const account = rows[0];
  if (!account || !(await bcrypt.compare(password, account.password_hash))) {
    return null;
  }
  if (account.role !== "Admin" && account.role !== "Viewer") {
    return null;
  }

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(
    Date.now() + SESSION_LIFETIME_SECONDS * 1000,
  );
  await getMySqlPool().execute(
    `INSERT INTO APP_SESSION (session_id, user_id, token_hash, expires_at)
     VALUES (?, ?, ?, ?)`,
    [randomUUID(), account.user_id, hashSessionToken(token), expiresAt],
  );

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });

  return {
    userId: account.user_id,
    username: account.username,
    email: account.email,
    role: account.role,
  };
}

export async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!isSessionToken(token)) {
    return null;
  }

  const [rows] = await getMySqlPool().execute<SessionUserRow[]>(
    `SELECT u.user_id, u.username, u.email, u.role
     FROM APP_SESSION AS s
     INNER JOIN APP_USER AS u ON u.user_id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > CURRENT_TIMESTAMP
     LIMIT 1`,
    [hashSessionToken(token)],
  );
  const user = rows[0];
  if (!user || (user.role !== "Admin" && user.role !== "Viewer")) {
    return null;
  }

  return {
    userId: user.user_id,
    username: user.username,
    email: user.email,
    role: user.role,
  };
}

export async function logout(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  try {
    if (isSessionToken(token)) {
      await getMySqlPool().execute(
        "DELETE FROM APP_SESSION WHERE token_hash = ?",
        [hashSessionToken(token)],
      );
    }
  } finally {
    cookieStore.delete(SESSION_COOKIE);
  }
}

export async function requireAuthenticatedUser(): Promise<AuthenticatedUser> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  return user;
}

export async function requireRole(
  role: UserRole,
): Promise<AuthenticatedUser> {
  const user = await requireAuthenticatedUser();
  if (user.role !== role) {
    throw new AuthorizationError();
  }
  return user;
}
