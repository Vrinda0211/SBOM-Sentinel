import "dotenv/config";

import bcrypt from "bcryptjs";
import { createPool } from "mysql2/promise";
import { randomUUID } from "node:crypto";

const database = process.env.MYSQL_DATABASE;
if (!database || !/^[A-Za-z0-9_]+$/.test(database)) {
  throw new Error("MYSQL_DATABASE must contain only letters, numbers, and underscores.");
}

const config = {
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT ?? 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database,
};
for (const name of ["MYSQL_HOST", "MYSQL_USER", "MYSQL_PASSWORD"]) {
  if (!process.env[name]) {
    throw new Error(`${name} must be configured.`);
  }
}
if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
  throw new Error("MYSQL_PORT must be an integer between 1 and 65535.");
}

function requiredCredential(name, trim = true) {
  const rawValue = process.env[name];
  const value = trim ? rawValue?.trim() : rawValue;
  if (!value || value.trim().length === 0) {
    throw new Error(`${name} must be configured in the local environment.`);
  }
  return value;
}

const accounts = [
  {
    username: requiredCredential("AUTH_ADMIN_USERNAME"),
    email: requiredCredential("AUTH_ADMIN_EMAIL").toLowerCase(),
    password: requiredCredential("AUTH_ADMIN_PASSWORD", false),
    role: "Admin",
  },
  {
    username: requiredCredential("AUTH_VIEWER_USERNAME"),
    email: requiredCredential("AUTH_VIEWER_EMAIL").toLowerCase(),
    password: requiredCredential("AUTH_VIEWER_PASSWORD", false),
    role: "Viewer",
  },
];

for (const account of accounts) {
  if (
    account.username.length < 3 ||
    account.username.length > 100 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account.email) ||
    account.email.length > 254 ||
    Buffer.byteLength(account.password, "utf8") < 12 ||
    Buffer.byteLength(account.password, "utf8") > 72
  ) {
    throw new Error(
      `${account.role} account values are invalid; usernames must be 3-100 characters, emails valid, and passwords 12-72 UTF-8 bytes.`,
    );
  }
}
if (
  accounts[0].username.toLowerCase() === accounts[1].username.toLowerCase() ||
  accounts[0].email === accounts[1].email
) {
  throw new Error("Admin and Viewer accounts must have different usernames and emails.");
}

const pool = createPool(config);
try {
  for (const account of accounts) {
    const passwordHash = await bcrypt.hash(account.password, 12);
    const [existingUsers] = await pool.execute(
      "SELECT user_id FROM APP_USER WHERE username = ? LIMIT 1",
      [account.username],
    );
    if (existingUsers.length > 0) {
      await pool.execute(
        `UPDATE APP_USER
         SET email = ?, password_hash = ?, role = ?
         WHERE user_id = ?`,
        [
          account.email,
          passwordHash,
          account.role,
          existingUsers[0].user_id,
        ],
      );
    } else {
      await pool.execute(
        `INSERT INTO APP_USER (user_id, username, email, password_hash, role)
         VALUES (?, ?, ?, ?, ?)`,
        [
          randomUUID(),
          account.username,
          account.email,
          passwordHash,
          account.role,
        ],
      );
    }
  }
} finally {
  await pool.end();
}

console.info("Admin and Viewer accounts were seeded with bcrypt password hashes.");
