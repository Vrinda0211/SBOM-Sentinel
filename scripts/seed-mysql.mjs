import "dotenv/config";

import { createPool } from "mysql2/promise";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

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

const seed = await readFile(
  fileURLToPath(new URL("../database/mysql/seed.sql", import.meta.url)),
  "utf8",
);
const statements = seed
  .split(";")
  .map((statement) => statement.trim())
  .filter(Boolean);
const pool = createPool(config);
try {
  for (const statement of statements) {
    await pool.query(statement);
  }
} finally {
  await pool.end();
}

console.info(`MySQL seed data applied to database "${database}".`);
